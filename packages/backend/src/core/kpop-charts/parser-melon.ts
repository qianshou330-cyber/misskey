/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from 'node:crypto';
import * as cheerio from './parser-html.js';
import { normalizeAlbumCoverUrl } from './parser-cover.js';
import type { Artist, ChartEntry, ChartTarget, HotWindow, ParsedSnapshot } from './parser-types.js';

export class ParseValidationError extends Error {
	readonly code = 'PARSE_VALIDATION';
	constructor(message: string) { super(message); this.name = 'ParseValidationError'; }
}

function requireValid(condition: unknown, message: string): asserts condition {
	if (!condition) throw new ParseValidationError(message);
}

function clean(value: string): string { return value.replace(/\s+/gu, ' ').trim(); }

function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }

function entityId(href: string | undefined, parameter: 'artistId' | 'albumId'): string | null {
	if (!href) return null;
	const queryId = href.match(new RegExp(`(?:[?&])${parameter}=(\\d+)(?:[&#]|$)`))?.[1];
	if (queryId) return queryId;
	const functionName = parameter === 'artistId' ? 'goArtistDetail' : 'goAlbumDetail';
	return href.match(new RegExp(`\\b${functionName}\\(\\s*['\"]?(\\d+)['\"]?\\s*\\)`))?.[1] ?? null;
}

/** Parse complete server-rendered HTML. Never executes scripts or follows page links. */
export function parseChart(html: string, target: ChartTarget, fetchedAt = new Date().toISOString()): ParsedSnapshot {
	const fetchedMs = Date.parse(fetchedAt);
	requireValid(Number.isFinite(fetchedMs) && /(?:Z|[+-]\d{2}:\d{2})$/i.test(fetchedAt), 'fetchedAt must be a valid timestamp with an explicit timezone');
	const $ = cheerio.load(html);
	const title = clean($('title').text());
	requireValid(!/captcha|access denied|forbidden|verify (?:you|your)|unusual traffic|로그인|접근\s*제한/i.test(title), 'Access challenge or login page; collection must stop');
	const chartTitle = { DAILY: /일간/, TOP100: /TOP\s*100/i, HOT100: /HOT\s*100/i }[target.chartType];
	requireValid(chartTitle && /멜론|melon/i.test(title) && chartTitle.test(title), `Page title does not confirm ${target.chartType}`);
	requireValid(target.chartType === 'HOT100' || target.window === null, 'Only HOT100 may specify a window');

	let window: HotWindow | null = null;
	if (target.chartType === 'HOT100') {
		// Tab availability and the requested URL do not prove which window is active.
		// Read only literal source assignments (without evaluating JavaScript).
		const declared = new Set<string>();
		$('script:not([src])').each((_, script) => {
			const source = $(script).html() ?? '';
			for (const match of source.matchAll(/(?:^|[;\n\r])\s*(?:var|let|const)\s+chartType\s*=\s*["'](D\d+)["']\s*;/g)) declared.add(match[1]);
		});
		$('[data-chart-type].on, [data-chart-type].active, [data-chart-type][aria-selected="true"]').each((_, tab) => {
			declared.add($(tab).attr('data-chart-type') ?? '');
		});
		requireValid(declared.size === 1, 'HOT100 active window is absent or ambiguous in the source');
		const confirmed = [...declared][0];
		requireValid(confirmed === 'D30' || confirmed === 'D100', 'HOT100 source has an unsupported window');
		requireValid(target.window === null || target.window === confirmed, `HOT100 source window ${confirmed} differs from requested ${target.window}`);
		window = confirmed;
	}

	const calendar = $('.calendar_prid');
	requireValid(calendar.length === 1, 'Expected exactly one visible chart date container');
	const dateText = clean(calendar.find('.year').text());
	const parts = /^(\d{4})[.\-/](\d{2})[.\-/](\d{2})$/.exec(dateText);
	requireValid(parts, 'Missing or malformed source chart date');
	const [, year, month, day] = parts;
	const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
	requireValid(Number(year) >= 2000 && date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day), 'Source chart date is not a real calendar date');
	const chartDate = `${year}-${month}-${day}`;
	let chartHour: number | null = null;
	if (target.chartType !== 'DAILY') {
		const hour = /^(\d{2}):00$/.exec(clean(calendar.find('.hour').text()));
		requireValid(hour && Number(hour[1]) <= 23, 'Missing or malformed hourly chart time');
		chartHour = Number(hour[1]);
	}
	// Daily midnight is a date anchor, not a claim about the publisher's update time.
	const sourceTimestamp = `${chartDate}T${String(chartHour ?? 0).padStart(2, '0')}:00:00+09:00`;
	requireValid(Date.parse(sourceTimestamp) <= fetchedMs + 5 * 60_000, 'Source chart timestamp is in the future (allowing five minutes clock tolerance)');

	const rows = $('tr[data-song-no]');
	requireValid(rows.length === 100, `Expected complete chart of 100 songs; received ${rows.length}`);
	const entries: ChartEntry[] = [];
	const songIds = new Set<string>();
	const ranks = new Set<number>();
	rows.each((_, element) => {
		const row = $(element);
		const songId = row.attr('data-song-no') ?? '';
		requireValid(/^[1-9]\d*$/.test(songId), 'Missing or malformed song ID');
		requireValid(!songIds.has(songId), `Duplicate song ID ${songId}`);
		songIds.add(songId);
		const rankText = clean(row.find('.rank').text());
		const rank = Number(rankText);
		requireValid(/^\d+$/.test(rankText) && Number.isInteger(rank) && rank >= 1 && rank <= 100, `Invalid rank for song ${songId}`);
		requireValid(!ranks.has(rank), `Duplicate chart rank ${rank}`);
		ranks.add(rank);
		const title = clean(row.find('.rank01 a').first().text());
		const albumLink = row.find('.rank03 a').first();
		const album = clean(albumLink.text());
		requireValid(title && album, `Missing title or album for song ${songId}`);
		const artists: Artist[] = [];
		const artistKeys = new Set<string>();
		// Melon repeats artists in a hidden ellipsis span; direct children avoid it.
		row.find('.rank02 > a').each((_, anchor) => {
			const link = $(anchor);
			const name = clean(link.text());
			requireValid(name, `Empty artist name for song ${songId}`);
			const id = entityId(link.attr('href'), 'artistId');
			const key = id ? `id:${id}` : `name:${name.toLocaleLowerCase()}`;
			if (!artistKeys.has(key)) { artists.push({ id, name }); artistKeys.add(key); }
		});
		requireValid(artists.length > 0, `Missing artists for song ${songId}`);
		let sourceMovement: ChartEntry['sourceMovement'] = { type: 'unknown', amount: null };
		const movement = ['up', 'down', 'static', 'new'].filter(kind => row.find(`.rank_${kind}`).length > 0);
		requireValid(movement.length <= 1, `Conflicting source movement for song ${songId}`);
		if (movement[0] === 'up' || movement[0] === 'down') {
			const type = movement[0];
			const amountText = clean(row.find(`.rank_wrap .${type}`).text());
			const amount = Number(amountText);
			requireValid(/^\d+$/.test(amountText) && amount > 0 && amount <= 99, `Invalid source movement for song ${songId}`);
			sourceMovement = { type, amount };
		} else if (movement[0] === 'static') sourceMovement = { type: 'same', amount: 0 };
		else if (movement[0] === 'new') sourceMovement = { type: 'new', amount: null };
		// Only the album thumbnail inside this song's row is artwork; page logos,
		// unrelated row images and executable onerror attributes are ignored.
		const albumCoverUrl = normalizeAlbumCoverUrl(row.find('a.image_typeAll > img').first().attr('src'));
		entries.push({ songId, rank, title, artists, album, albumId: entityId(albumLink.attr('href'), 'albumId'), sourceMovement, albumCoverUrl });
	});
	entries.sort((a, b) => a.rank - b.rank);
	requireValid(entries.every((entry, index) => entry.rank === index + 1), 'Chart ranks must be contiguous from 1 to 100');
	// Artwork is supplementary metadata. Preserve hashes of existing ranking
	// snapshots so enriching an archived response does not change its identity.
	const semantic = { chartType: target.chartType, window, chartDate, chartHour, entries: entries.map(({ albumCoverUrl: _cover, ...entry }) => entry) };
	return {
		...semantic, entries, sourceTimestamp, sourceUrl: target.url, fetchedAt,
		contentHash: hash(JSON.stringify(semantic)), rawHtmlHash: hash(html),
	};
}
