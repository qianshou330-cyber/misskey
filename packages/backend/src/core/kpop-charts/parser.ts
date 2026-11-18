/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { parse } from 'node-html-parser';
import { KPOP_CHARTS, matchKpopGroups } from './catalog.js';
import { KpopSourceError } from './types.js';
import { parseChart } from './parser-melon.js';
import { parseBugs } from './parser-bugs.js';
import { collectGenie } from './parser-genie.js';
import { parseFlo, FLO_CHART_API_URL } from './parser-flo.js';
import { parseApple } from './parser-apple.js';
import { parseSpotify } from './parser-spotify.js';
import { parseTencent } from './parser-tencent.js';
import { parseBillboard, validBillboardIssueDate } from './parser-billboard.js';
import type { KpopChartKey, KpopReader, KpopSnapshot, KpopEntry } from './types.js';
import type { ExternalSnapshot } from './parser-external-types.js';

export function kpopParseError(reason: 'invalid_payload' | 'access_challenge' = 'invalid_payload'): KpopSourceError {
	return new KpopSourceError({ phase: 'parse', reason, httpStatus: null, retryAfterAt: null, elapsedMs: 0 });
}
export function assertKpopBody(body: string): void {
	if (Buffer.byteLength(body, 'utf8') > 3 * 1024 * 1024) throw kpopParseError();
	if (/^\s*[{[]/.test(body)) return;
	const title = parse(body).querySelector('title')?.text ?? '';
	if (/captcha|access denied|forbidden|verify (?:you|your)|unusual traffic|just a moment|\blog ?in\b|登入|登录|로그인|접근\s*(?:제한|차단)|驗證碼|验证码/i.test(title)
		|| /(?:id|class)=["'][^"']*(?:captcha|challenge-form|cf-challenge)|cf-chl-|g-recaptcha/i.test(body)) throw kpopParseError('access_challenge');
}
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
export function kpopContentHash(value: Omit<KpopSnapshot, 'contentHash'>): string {
	return sha(JSON.stringify({
		schemaVersion: value.schemaVersion, chartKey: value.chartKey, source: value.source, sourceUrl: value.sourceUrl,
		sourcePeriod: value.sourcePeriod, sourceUpdatedAt: value.sourceUpdatedAt, sourceDate: value.sourceDate,
		coverage: value.coverage, sourceTotal: value.sourceTotal, expectedCount: value.expectedCount, rankBasis: value.rankBasis,
		entries: value.entries.map(entry => ({ songId: entry.songId, rank: entry.rank, title: entry.title,
																																									artists: entry.artists.map(artist => ({ id: artist.id, name: artist.name })),
																																									sourceMovement: { type: entry.sourceMovement.type, amount: entry.sourceMovement.amount }, groupIds: entry.groupIds })),
	}));
}

function normalize(key: KpopChartKey, value: ExternalSnapshot, period: string | null = value.sourceUpdatedAt): KpopSnapshot {
	const definition = KPOP_CHARTS[key];
	const entries: KpopEntry[] = value.entries.map(entry => ({ ...entry, albumCoverUrl: entry.albumCoverUrl ?? null, groupIds: matchKpopGroups(definition.source, entry.artists) }));
	if (entries.length !== definition.expectedCount || new Set(entries.map(entry => entry.songId)).size !== entries.length
		|| entries.some((entry, index) => entry.rank !== index + 1 || !entry.title || entry.title.length > 500 || !entry.artists.length || entry.artists.length > 100
			|| entry.artists.some(artist => !artist.name || artist.name.length > 1000))) throw kpopParseError();
	const snapshot: Omit<KpopSnapshot, 'contentHash'> = {
		schemaVersion: 1, chartKey: key, source: definition.source, sourceUrl: definition.url,
		sourcePeriod: period && period === value.sourceUpdatedAt ? new Date(period).toISOString() : period, sourceUpdatedAt: value.sourceUpdatedAt ? new Date(value.sourceUpdatedAt).toISOString() : null,
		sourceDate: value.chartDate, observedAt: new Date(value.fetchedAt).toISOString(), coverage: definition.coverage,
		sourceTotal: definition.sourceTotal, expectedCount: definition.expectedCount, rankBasis: definition.rankBasis,
		entries, rawHash: value.rawHash,
	};
	// Exclude receipt time and raw markup from semantic identity.
	const result = { ...snapshot, contentHash: kpopContentHash(snapshot) };
	assertKpopSnapshot(result);
	return result;
}

/** Revalidate the exact normalized contract at the persistence boundary. */
export function assertKpopSnapshot(input: unknown): asserts input is KpopSnapshot {
	try {
		if (!input || typeof input !== 'object' || Array.isArray(input)) throw kpopParseError();
		const value = input as KpopSnapshot;
		const definition = KPOP_CHARTS[value.chartKey];
		const fields = ['schemaVersion', 'chartKey', 'source', 'sourceUrl', 'sourcePeriod', 'sourceUpdatedAt', 'sourceDate', 'observedAt', 'coverage', 'sourceTotal', 'expectedCount', 'rankBasis', 'entries', 'rawHash', 'contentHash'];
		if (Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key)) || !definition || value.schemaVersion !== 1
			|| value.source !== definition.source || value.sourceUrl !== definition.url || value.coverage !== definition.coverage
			|| value.sourceTotal !== definition.sourceTotal || value.expectedCount !== definition.expectedCount || value.rankBasis !== definition.rankBasis
			|| !Array.isArray(value.entries) || value.entries.length !== definition.expectedCount || !/^[a-f0-9]{64}$/.test(value.rawHash)) throw kpopParseError();
		const instant = (time: unknown): time is string => typeof time === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(time) && Number.isFinite(Date.parse(time)) && new Date(time).toISOString() === time;
		if (!instant(value.observedAt) || (value.sourceUpdatedAt !== null && (!instant(value.sourceUpdatedAt) || Date.parse(value.sourceUpdatedAt) > Date.parse(value.observedAt) + 300000))) throw kpopParseError();
		if (value.sourceDate !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(value.sourceDate) || new Date(`${value.sourceDate}T00:00:00Z`).toISOString().slice(0, 10) !== value.sourceDate)) throw kpopParseError();
		if (value.sourcePeriod !== (value.chartKey === 'melon-daily' ? value.sourceDate : value.sourceUpdatedAt)) throw kpopParseError();
		if (value.source === 'billboard' && (value.sourceUpdatedAt !== null || !validBillboardIssueDate(value.sourceDate, value.observedAt))) throw kpopParseError();
		const seen = new Set<string>();
		for (const [index, entry] of value.entries.entries()) {
			if (!entry || Object.keys(entry).length !== 9 || typeof entry.songId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(entry.songId) || seen.has(entry.songId) || entry.rank !== index + 1
				|| typeof entry.title !== 'string' || !entry.title.trim() || entry.title.length > 500 || !Array.isArray(entry.artists) || entry.artists.length === 0 || entry.artists.length > 100
				|| entry.artists.some(artist => !artist || Object.keys(artist).length !== 2 || typeof artist.name !== 'string' || !artist.name.trim() || artist.name.length > 1000 || (artist.id !== null && (typeof artist.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(artist.id))))) throw kpopParseError();
			seen.add(entry.songId);
			for (const field of ['album', 'albumId'] as const) if (entry[field] !== null && (typeof entry[field] !== 'string' || entry[field]!.length > (field === 'album' ? 500 : 200))) throw kpopParseError();
			if (entry.albumCoverUrl !== null) {
				if (typeof entry.albumCoverUrl !== 'string' || entry.albumCoverUrl.length > 2048) throw kpopParseError();
				const url = new URL(entry.albumCoverUrl);
				if (url.protocol !== 'https:' || url.username || url.password || url.port || !definition.coverHosts.includes(url.hostname)) throw kpopParseError();
			}
			const movement = entry.sourceMovement;
			if (!movement || Object.keys(movement).length !== 2 || !['up', 'down', 'same', 'new', 'unknown'].includes(movement.type)
				|| (['up', 'down'].includes(movement.type) ? !Number.isSafeInteger(movement.amount) || movement.amount! <= 0 || movement.amount! > 10000 : movement.amount !== (movement.type === 'same' ? 0 : null))) throw kpopParseError();
			if (JSON.stringify(entry.groupIds) !== JSON.stringify(matchKpopGroups(value.source, entry.artists))) throw kpopParseError();
		}
		if (!/^[a-f0-9]{64}$/.test(value.contentHash) || value.contentHash !== kpopContentHash(value)) throw kpopParseError();
	} catch (error) { throw error instanceof KpopSourceError ? error : kpopParseError(); }
}

/** Pure source collector: injected reader owns all HTTP and robots policy. */
export async function collectKpopChart(key: KpopChartKey, reader: KpopReader): Promise<KpopSnapshot> {
	if (!Object.hasOwn(KPOP_CHARTS, key)) throw kpopParseError();
	const definition = KPOP_CHARTS[key];
	const read = async (url: string) => {
		const result = await reader(url);
		if (!Number.isFinite(Date.parse(result.observedAt)) || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(result.observedAt)) throw kpopParseError();
		assertKpopBody(result.body);
		return { body: result.body, fetchedAt: result.observedAt };
	};
	try {
		if (definition.source === 'genie') return normalize(key, (await collectGenie(read)).snapshot);
		const response = await read(key === 'flo' ? FLO_CHART_API_URL : definition.url);
		if (definition.source === 'melon') {
			const chartType = key === 'melon-daily' ? 'DAILY' : key === 'melon-top100' ? 'TOP100' : 'HOT100';
			const window = chartType === 'HOT100' ? key === 'melon-hot100-d30' ? 'D30' : 'D100' : null;
			const parsed = parseChart(response.body, { chartType, window, url: definition.url, key }, response.fetchedAt);
			const updated = chartType === 'DAILY' ? null : new Date(parsed.sourceTimestamp).toISOString();
			return normalize(key, { provider: 'melon', chartKey: key, sourceUrl: definition.url, sourceUpdatedAt: updated,
																											chartDate: parsed.chartDate, fetchedAt: parsed.fetchedAt, expectedCount: 100,
																											entries: parsed.entries.map(entry => ({ ...entry, albumCoverUrl: entry.albumCoverUrl ?? null })),
																											contentHash: parsed.contentHash, rawHash: parsed.rawHtmlHash }, chartType === 'DAILY' ? parsed.chartDate : updated);
		}
		const parsers = { bugs: parseBugs, flo: parseFlo, apple: parseApple, spotify: parseSpotify, tencent: parseTencent, billboard: parseBillboard };
		return normalize(key, parsers[definition.source as keyof typeof parsers](response.body, response.fetchedAt));
	} catch (error) {
		throw error instanceof KpopSourceError ? error : kpopParseError();
	}
}
