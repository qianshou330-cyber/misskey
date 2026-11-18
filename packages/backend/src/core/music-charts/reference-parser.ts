/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Buffer } from 'node:buffer';
import { parse } from 'node-html-parser';
import type { MusicChartKey } from './types.js';

export type ReferenceSource = 'melon' | 'genie' | 'bugs';

export type ReferenceSnapshot = {
	chartKey: MusicChartKey;
	rank: number | null;
	result: 'ranked' | 'not_found';
	sourceFetchedAt: string;
	sourceTimeLabel: string;
};

const MAX_HTML_BYTES = 3 * 1024 * 1024;
const MAX_SCRIPTS = 512;
const MAX_MODEL_RECORDS = 1024;
const MAX_MODEL_NODES = 100_000;
const FIRST_REASONABLE_DATE = Date.parse('2020-01-01T00:00:00Z');

type Dictionary = Record<string, unknown>;
type Definition = { property: 'initialData' | 'initialDaily'; displayName: string; chartKey: MusicChartKey; count: number; range: number; daily?: true };

const DEFINITIONS: Record<ReferenceSource, Definition[]> = {
	melon: [
		{ property: 'initialData', displayName: 'Melon Top 100', chartKey: 'melon-top100', count: 100, range: 100 },
		{ property: 'initialDaily', displayName: 'Melon Daily Top 100', chartKey: 'melon-daily', count: 100, range: 100, daily: true },
	],
	bugs: [{ property: 'initialData', displayName: 'Bugs Top 100', chartKey: 'bugs-realtime', count: 100, range: 100 }],
	genie: [{ property: 'initialData', displayName: 'Genie Top 250', chartKey: 'genie-realtime', count: 250, range: 200 }],
};

function invalid(reason: string): never {
	// Never place third-party page contents in an error or log.
	throw new Error(`Invalid reference chart: ${reason}`);
}

function dictionary(value: unknown): Dictionary {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid('expected object');
	return value as Dictionary;
}

function boundedText(value: unknown, maximum: number): string {
	if (typeof value !== 'string' || value.length > maximum || !value.trim()) invalid('invalid text field');
	return value;
}

function normalized(value: string): string {
	return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toUpperCase();
}

function targetArtist(value: string): boolean {
	// These are the observed standalone and combined credits, including the
	// daily chart's whitespace-only separator. No substring/fuzzy matching.
	return ['A2OLITE', 'A2O,A2OLITE', 'A2O&A2OLITE', 'A2OA2OLITE'].includes(normalized(value).replace(/\s+/g, ''));
}

function modelRecords(text: string): unknown[] {
	const stream = Buffer.from(text, 'utf8');
	const models: unknown[] = [];
	let cursor = 0;
	let count = 0;
	while (cursor < stream.length) {
		if (++count > MAX_MODEL_RECORDS) invalid('too many data records');
		const newline = stream.indexOf('\n', cursor);
		const end = newline === -1 ? stream.length : newline;
		const colon = stream.indexOf(':', cursor);
		if (colon === -1 || colon > end || !/^[\da-f]+$/i.test(stream.toString('utf8', cursor, colon))) {
			cursor = end + 1;
			continue;
		}
		const start = colon + 1;
		if (stream[start] === 0x54) { // Flight's T records contain length-prefixed UTF-8 text, not model JSON.
			const comma = stream.indexOf(',', start);
			const sizeText = stream.toString('utf8', start + 1, comma < 0 ? start + 1 : comma);
			if (comma === -1 || comma > end || !/^[\da-f]{1,8}$/i.test(sizeText)) invalid('invalid text record');
			const size = Number.parseInt(sizeText, 16);
			if (size > MAX_HTML_BYTES || comma + 1 + size > stream.length) invalid('incomplete text record');
			cursor = comma + 1 + size;
			if (stream[cursor] === 0x0a) cursor++;
			continue;
		}
		// Imports and hints are not JSON model records. Looking only at complete
		// models also avoids interpreting JSON-looking content inside text values.
		if (stream[start] === 0x5b || stream[start] === 0x7b) {
			try {
				models.push(JSON.parse(stream.toString('utf8', start, end)));
			} catch {
				invalid('model record is not JSON');
			}
		}
		cursor = end + 1;
	}
	return models;
}

/** Read JSON data frames only. Scripts and imported application code are never run. */
function pageProperties(html: string): Map<string, unknown[]> {
	if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) invalid('page exceeds size limit');
	const scripts = parse(html).querySelectorAll('script');
	if (scripts.length > MAX_SCRIPTS) invalid('too many scripts');
	const chunks: string[] = [];
	for (const script of scripts) {
		if (script.hasAttribute('src')) continue;
		const code = script.rawText.trim();
		if (!code.startsWith('self.__next_f.push(')) continue;
		const match = /^self\.__next_f\.push\(([\s\S]*)\);?$/.exec(code);
		if (!match) invalid('invalid data frame');
		let frame: unknown;
		try {
			frame = JSON.parse(match[1]);
		} catch {
			invalid('data frame is not JSON');
		}
		if (!Array.isArray(frame)) invalid('invalid data frame');
		if (frame[0] !== 1) continue;
		if (frame.length !== 2 || typeof frame[1] !== 'string') invalid('invalid text frame');
		chunks.push(frame[1]);
	}
	// A JSON record can cross several script/data frames, including inside a
	// string escape. Join text frames before decoding individual model records.
	const models = modelRecords(chunks.join(''));
	const properties = new Map<string, unknown[]>();
	let nodes = 0;

	function visit(value: unknown, depth: number): void {
		if (++nodes > MAX_MODEL_NODES || depth > 64) invalid('data structure exceeds limit');
		if (value === null || typeof value !== 'object') return;
		if (Array.isArray(value)) {
			for (const child of value) visit(child, depth + 1);
			return;
		}
		for (const [key, child] of Object.entries(value)) {
			if (key === 'initialData' || key === 'initialDaily') {
				const values = properties.get(key) ?? [];
				values.push(child);
				properties.set(key, values);
			}
			visit(child, depth + 1);
		}
	}

	for (const model of models) visit(model, 0);
	return properties;
}

function sourceTimestamp(value: unknown, now: Date): string {
	const text = boundedText(value, 32);
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(text)) invalid('invalid fetched date format');
	const time = Date.parse(text);
	if (!Number.isFinite(time) || time < FIRST_REASONABLE_DATE || time > now.getTime()) invalid('invalid or future fetched date');
	const canonical = new Date(time).toISOString();
	if (canonical !== (text.length === 20 ? text.replace('Z', '.000Z') : text)) invalid('invalid fetched calendar date');
	// Old observations stay old. The state layer marks them stale; parsing
	// never replaces the provider timestamp with the local collection time.
	return canonical;
}

function timeLabel(value: unknown, daily: boolean, now: Date): string {
	const text = boundedText(value, 16);
	if (!daily) {
		if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text)) invalid('invalid hourly label');
		return text;
	}
	if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) invalid('invalid daily label');
	const date = Date.parse(`${text}T00:00:00Z`);
	if (!Number.isFinite(date) || date < FIRST_REASONABLE_DATE || new Date(date).toISOString().slice(0, 10) !== text) invalid('invalid daily calendar date');
	const koreanDate = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
	if (text > koreanDate) invalid('future daily label');
	return text;
}

function snapshot(value: unknown, definition: Definition, now: Date): ReferenceSnapshot {
	const data = dictionary(value);
	if (data.displayName !== definition.displayName || data.countryCode !== 'kr') invalid('chart identity changed');
	if (data.chartWeekLabel != null) invalid('unexpected weekly chart label');
	const sourceFetchedAt = sourceTimestamp(data.fetchedAt, now);
	const sourceTimeLabel = timeLabel(data.chartUpdatedAt, definition.daily === true, now);
	if (!Array.isArray(data.entries) || data.entries.length !== definition.count) invalid('incomplete chart');
	const targets: number[] = [];
	for (const [index, value] of data.entries.entries()) {
		const entry = dictionary(value);
		if (!Number.isInteger(entry.rank) || entry.rank !== index + 1) invalid('ranks are not unique, consecutive, and ordered');
		const title = boundedText(entry.title, 512);
		const artist = boundedText(entry.artist, 512);
		const rawArtist = entry.rawArtist == null ? null : boundedText(entry.rawArtist, 512);
		if (entry.imageUrl != null) boundedText(entry.imageUrl, 2048);
		if (normalized(title) !== 'NEON') continue;
		const matchesArtist = targetArtist(artist);
		if (rawArtist !== null && matchesArtist !== targetArtist(rawArtist)) invalid('conflicting target artist credits');
		if (matchesArtist) targets.push(index + 1);
	}
	if (targets.length > 1) invalid('multiple matching works');
	const rank = targets.length === 1 && targets[0] <= definition.range ? targets[0] : null;
	return { chartKey: definition.chartKey, rank, result: rank === null ? 'not_found' : 'ranked', sourceFetchedAt, sourceTimeLabel };
}

/** Reference-only data; no official IDs or complete official periods are inferred. */
export function parseReferencePage(source: ReferenceSource, html: string, now: Date): ReferenceSnapshot[] {
	if (!Number.isFinite(now.getTime()) || !Object.hasOwn(DEFINITIONS, source)) invalid('invalid parser input');
	const properties = pageProperties(html);
	return DEFINITIONS[source].map(definition => {
		const values = properties.get(definition.property);
		if (values?.length !== 1) invalid('missing or ambiguous chart data');
		return snapshot(values[0], definition, now);
	});
}
