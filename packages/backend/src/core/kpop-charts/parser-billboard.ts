/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as html from './parser-html.js';
import { finishSnapshot, sha256, type ExternalEntry, type ExternalSnapshot } from './parser-external-types.js';

export const BILLBOARD_CHART_KEY = 'billboard-korea-global-k-songs';
export const BILLBOARD_SOURCE_URL = `https://billboard.co.kr/charts/${BILLBOARD_CHART_KEY}/`;
const TITLE = 'BILLBOARD KOREA GLOBAL K-SONGS';
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const DAY = 86400000;
const clean = (value: string) => value.replace(/\s+/gu, ' ').trim();
const identity = (value: string) => clean(value.normalize('NFKC')).toLowerCase();

function valid(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`Billboard Korea validation: ${message}`);
}

/** The forward-dated weekly issue is not a publication/update timestamp. */
export function validBillboardIssueDate(date: string | null, observedAt: string): boolean {
	if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(observedAt))) return false;
	const time = Date.parse(`${date}T00:00:00Z`);
	if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) return false;
	const koreaDay = Math.floor((Date.parse(observedAt) + 9 * 3600000) / DAY) * DAY;
	return time <= koreaDay + 7 * DAY && time >= koreaDay - 21 * DAY;
}

function coverUrl(value: string | undefined): string | null {
	if (!value || /[\u0000-\u0020\u007f\\]/u.test(value)) return null;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' && url.hostname === 'contents.billboard.co.kr' && !url.username && !url.password && !url.port && !url.hash && !url.search
			&& url.pathname.startsWith('/media/album/') && /\.(?:jpe?g|png|webp)$/i.test(url.pathname) ? url.href : null;
	} catch { return null; }
}

/** Only the public server-rendered chart is read. No script, API, session,
 * artist page or hidden form field is used. The full 100 rows are validated
 * before the shared exact-artist filter is applied; ranks remain global. */
export function parseBillboard(body: string, fetchedAt: string): ExternalSnapshot {
	valid(Number.isFinite(Date.parse(fetchedAt)) && /(?:Z|[+-]\d{2}:\d{2})$/i.test(fetchedAt), 'observation needs a timezone');
	const $ = html.load(body);
	const canonical = $('link[rel="canonical"]'), heading = $('h1.chart-title'), weeks = $('.week-date');
	valid(canonical.length === 1 && canonical.attr('href') === BILLBOARD_SOURCE_URL, 'wrong canonical chart');
	valid(heading.length === 1 && clean(heading.text()) === TITLE, 'wrong or ambiguous chart heading');
	valid(weeks.length === 1, 'missing or ambiguous weekly issue');
	const label = /^WEEK OF ([A-Z]+) ([1-9]|[12]\d|3[01]), (20\d{2})$/.exec(clean(weeks.text()));
	valid(label && MONTHS.includes(label[1]), 'unrecognized weekly issue');
	const chartDate = `${label[3]}-${String(MONTHS.indexOf(label[1]) + 1).padStart(2, '0')}-${label[2].padStart(2, '0')}`;
	valid(validBillboardIssueDate(chartDate, fetchedAt), 'invalid or implausible weekly issue');
	const list = $('.chartdet-div02-ul');
	valid(list.length === 1, 'missing or ambiguous chart list');
	const rows = list.children();
	valid(rows.length === 100 && rows.toArray().every(row => $(row).hasClass('chart-item')), 'expected 100 official rows');
	const seen = new Set<string>();
	const entries: ExternalEntry[] = rows.toArray().map((row, index) => {
		const basic = $(row).find('.basic');
		valid(basic.length === 1, 'ambiguous chart row');
		const field = (selector: string) => {
			const item = basic.find(selector);
			valid(item.length === 1, `missing or ambiguous ${selector}`);
			return clean(item.text());
		};
		const rank = index + 1;
		valid(field('.album-rank') === String(rank), 'non-contiguous, duplicate or tied rank');
		const title = field('.album-title'), credit = field('.album-artist');
		valid(title && title.length <= 500 && credit, 'empty title or artist');
		// Public artist-link spans are the official comma-separated contributors.
		// Preserve their names verbatim, including Korean parenthetical aliases.
		const artists = basic.find('.album-artist .artist-link').toArray().map(node => ({ id: null, name: clean($(node).text()) }));
		valid(artists.length > 0 && artists.length <= 100 && artists.every(artist => artist.name && artist.name.length <= 1000), 'missing artist credits');
		valid(credit.replace(/\s*,\s*/gu, ',') === artists.map(artist => artist.name).join(','), 'artist text and structured credits disagree');
		valid(new Set(artists.map(artist => identity(artist.name))).size === artists.length, 'duplicate artist credit');
		// There is no stable song ID in this public markup. Do not derive it from
		// rank, issue, artwork or a fabricated service identifier.
		const songId = `bb-${sha256(JSON.stringify([identity(title), artists.map(artist => identity(artist.name)).sort()]))}`;
		valid(!seen.has(songId), 'duplicate song identity'); seen.add(songId);
		const lastWeek = field('.last-week-content'), peakText = field('.best-rank-content'), weeksText = field('.weeks-in-chart-content');
		valid(lastWeek === '-' || /^(?:[1-9]\d?|100)$/.test(lastWeek), 'invalid last-week rank');
		valid(/^(?:[1-9]\d?|100)$/.test(peakText) && Number(peakText) <= rank, 'invalid peak rank');
		valid(/^[1-9]\d{0,3}$/.test(weeksText), 'invalid weeks-on-chart count');
		const previous = lastWeek === '-' ? null : Number(lastWeek);
		valid(previous === null || Number(peakText) <= previous, 'peak contradicts last-week rank');
		const sourceMovement: ExternalEntry['sourceMovement'] = previous === null
			? { type: Number(weeksText) === 1 ? 'new' : 'unknown', amount: null }
			: { type: previous === rank ? 'same' : previous > rank ? 'up' : 'down', amount: Math.abs(previous - rank) };
		const covers = basic.find('img.album-cover');
		valid(covers.length <= 1, 'ambiguous artwork');
		return { songId, rank, title, artists, album: null, albumId: null, albumCoverUrl: coverUrl(covers.attr('src')), sourceMovement };
	});
	return finishSnapshot({ provider: 'billboard', chartKey: BILLBOARD_CHART_KEY, sourceUrl: BILLBOARD_SOURCE_URL,
		sourceUpdatedAt: null, chartDate, fetchedAt, expectedCount: 100, entries }, body);
}
