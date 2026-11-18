/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as cheerio from './parser-html.js';
import { finishSnapshot, type ExternalEntry, type ExternalSnapshot } from './parser-external-types.js';

export const BUGS_SOURCE_URL = 'https://music.bugs.co.kr/chart/track/realtime/total';
export const BUGS_CHART_KEY = 'BUGS_REALTIME';
const clean = (value: string): string => value.replace(/\s+/gu, ' ').trim();

function requireValid(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`Bugs validation: ${message}`);
}

function numericId(value: string | undefined): string | null {
	return value && /^[1-9]\d*$/.test(value) ? value : null;
}

function coverUrl(value: string | undefined): string | null {
	if (!value || /[\u0000-\u0020\u007f\\]/u.test(value)) return null;
	try {
		const normalized = value.startsWith('//') ? `https:${value}` : value;
		const url = new URL(normalized);
		return url.protocol === 'https:' && url.hostname === 'image.bugsm.co.kr' && !url.username && !url.password && !url.port ? normalized : null;
	} catch { return null; }
}

function timestamp(value: string): { date: string; at: string } | null {
	const match = /^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):00$/.exec(clean(value));
	if (!match) return null;
	const [, year, month, day, hour] = match;
	const date = `${year}-${month}-${day}`;
	const at = `${date}T${hour}:00:00+09:00`;
	const dayCheck = new Date(`${date}T00:00:00Z`);
	if (Number(year) < 2000 || Number(hour) > 23 || !Number.isFinite(dayCheck.getTime()) || dayCheck.toISOString().slice(0, 10) !== date) return null;
	return { date, at };
}

/** Complete public realtime/all-genres HTML only; never executes page scripts. */
export function parseBugs(body: string, fetchedAt: string): ExternalSnapshot {
	const fetchedMs = Date.parse(fetchedAt);
	requireValid(Number.isFinite(fetchedMs) && /(?:Z|[+-]\d{2}:\d{2})$/i.test(fetchedAt), 'fetchedAt needs an explicit timezone');
	const $ = cheerio.load(body);
	const title = clean($('title').text());
	requireValid(!/captcha|access denied|forbidden|verify (?:you|your)|로그인|접근\s*제한/i.test(title), 'access challenge; stop collection');
	requireValid(/벅스차트/.test(title) && /곡 차트/.test(title) && /실시간/.test(title) && /전체 장르/.test(title), 'page does not confirm realtime all-genres chart');
	requireValid($('meta[property="og:url"]').attr('content') === BUGS_SOURCE_URL, 'canonical source differs from realtime chart');
	requireValid($('.filterChart .selected').attr('href') === BUGS_SOURCE_URL, 'selected chart differs from realtime chart');
	const sourceTime = $('.filterChart time');
	requireValid(sourceTime.length === 1, 'missing or ambiguous chart time');
	const visibleTime = sourceTime.clone();
	visibleTime.find('a').remove();
	const visible = timestamp(visibleTime.text());
	requireValid(visible, 'invalid visible chart date/time');
	requireValid(Date.parse(visible.at) <= fetchedMs + 5 * 60_000, 'future chart date/time');
	const attribute = timestamp(sourceTime.attr('datetime') ?? '');
	// The captured page disagrees: visible 23:00, datetime 22:00. Keep the
	// agreed date but do not invent an authoritative publication timestamp.
	const sourceUpdatedAt = attribute?.at === visible.at ? visible.at : null;
	const chartDate = !attribute || attribute.date === visible.date ? visible.date : null;
	const rows = $('#CHARTrealtime table.trackList.byChart tbody tr[rowtype="track"]');
	requireValid(rows.length === 100, `expected complete top 100; received ${rows.length}`);
	const ids = new Set<string>();
	const ranks = new Set<number>();
	const entries: ExternalEntry[] = [];
	rows.each((_, element) => {
		const row = $(element);
		const songId = numericId(row.attr('trackid'));
		requireValid(songId && !ids.has(songId), 'missing or duplicate song ID');
		ids.add(songId);
		const rankText = clean(row.find('.ranking > strong').text());
		const rank = Number(rankText);
		requireValid(/^\d+$/.test(rankText) && rank >= 1 && rank <= 100 && !ranks.has(rank), 'invalid or duplicate rank');
		ranks.add(rank);
		const songTitle = clean(row.find('p.title > a').first().text());
		requireValid(songTitle, `missing title for ${songId}`);
		const artists: ExternalEntry['artists'] = [];
		const artistIds = new Set<string>();
		row.find('p.artist > a[href]').each((_, anchor) => {
			const link = $(anchor);
			const id = link.attr('href')?.match(/^https:\/\/music\.bugs\.co\.kr\/artist\/([1-9]\d*)(?:[?#]|$)/)?.[1];
			const name = clean(link.text());
			if (id && name && !artistIds.has(id)) { artists.push({ id, name }); artistIds.add(id); }
		});
		if (row.attr('multiartist') === 'Y') {
			// The public HTML stores collaborators in a literal delimited string.
			// Read that string without eval, executing handlers or calling APIs.
			const handler = row.find('p.artist [name="atag_martist_list"]').attr('onclick') ?? '';
			const literal = /openMultiArtistSearchResultPopLayer\(\s*this,\s*'((?:\\.|[^'\\])*)'\s*,/.exec(handler)?.[1];
			requireValid(literal, `missing collaborator metadata for ${songId}`);
			for (const item of literal.split(/\\+n/)) {
				const fields = item.replace(/\\(['\\])/g, '$1').split('||');
				const id = numericId(fields[2]);
				const name = clean(fields[1] ?? '');
				requireValid(fields.length === 4 && id && name, `malformed collaborator metadata for ${songId}`);
				if (!artistIds.has(id)) { artists.push({ id, name }); artistIds.add(id); }
			}
		}
		requireValid(artists.length > 0, `missing artists for ${songId}`);
		let sourceMovement: ExternalEntry['sourceMovement'] = { type: 'unknown', amount: null };
		const change = row.find('.ranking > .change');
		const kinds = ['up', 'down', 'none', 'new'].filter(kind => change.hasClass(kind));
		requireValid(kinds.length <= 1, `conflicting rank movement for ${songId}`);
		const kind = kinds[0];
		if (kind === 'up' || kind === 'down') {
			const amountText = clean(change.find('em').text());
			const amount = Number(amountText);
			requireValid(/^\d+$/.test(amountText) && amount > 0 && amount < 100, `invalid rank movement for ${songId}`);
			sourceMovement = { type: kind, amount };
		} else if (kind === 'none') sourceMovement = { type: 'same', amount: 0 };
		else if (kind === 'new') sourceMovement = { type: 'new', amount: null };
		entries.push({ songId, rank, title: songTitle, artists,
																	album: clean(row.find('a.album').first().text()) || null,
																	albumId: numericId(row.attr('albumid')),
																	albumCoverUrl: coverUrl(row.find('a.thumbnail > img').first().attr('src')),
																	sourceMovement });
	});
	entries.sort((a, b) => a.rank - b.rank);
	requireValid(entries.every((entry, index) => entry.rank === index + 1), 'ranks must be contiguous');
	return finishSnapshot({ provider: 'bugs', chartKey: BUGS_CHART_KEY, sourceUrl: BUGS_SOURCE_URL,
																									sourceUpdatedAt, chartDate, fetchedAt, expectedCount: 100, entries }, body);
}
