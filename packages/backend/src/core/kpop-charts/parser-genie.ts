/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { load, type CheerioAPI } from './parser-html.js';
import { finishSnapshot, type ExternalEntry, type ExternalSnapshot } from './parser-external-types.js';

export const GENIE_URL = 'https://genie.co.kr/chart/top200';
export const GENIE_CHART_KEY = 'TOP200';
type Read = (url: string) => Promise<{ body: string; fetchedAt: string }>;
const fail = (message: string): never => { throw new Error(`INVALID_GENIE_CHART: ${message}`); };
const clean = (value: string): string => value.replace(/\s+/gu, ' ').trim();
const numberId = (value: string | undefined): string | null => value?.match(/\('(\d+)'\)/u)?.[1] ?? null;

function pageMetadata($: CheerioAPI) {
	const input = (name: string): string => String($(`input[name="${name}"]`).val() ?? '');
	const year = input('strYYYY'), month = input('strMM'), day = input('strDD'), hour = input('strHH');
	if (!/^\d{4}$/u.test(year) || !/^\d{2}$/u.test(month) || !/^\d{2}$/u.test(day) || !/^\d{2}$/u.test(hour)) fail('Missing official chart date/hour.');
	const chartDate = `${year}-${month}-${day}`;
	const instant = new Date(`${chartDate}T${hour}:00:00+09:00`);
	if (!Number.isFinite(instant.getTime()) || Number(hour) > 23 ||
    new Date(instant.getTime() + 9 * 3600_000).toISOString().slice(0, 13) !== `${chartDate}T${hour}` ||
    input('curDateComma') !== `${year}.${month}.${day}`) fail('Inconsistent official calendar fields.');
	const ids = input('sAllSongID').split(';').filter(Boolean);
	if (ids.length !== 200 || new Set(ids).size !== 200 || ids.some(id => !/^\d+$/u.test(id))) fail('The source does not declare all 200 unique song IDs.');
	const pageLinks = $('div.page-nav a[href]').toArray().map(element => {
		const url = new URL($(element).attr('href')!, GENIE_URL);
		if (url.origin !== 'https://genie.co.kr' || url.pathname !== '/chart/top200' || url.hash ||
      url.username || url.password || [...url.searchParams.keys()].sort().join(',') !== 'ditc,hh,pg,rtm,ymd' ||
      url.searchParams.get('ditc') !== 'D' || url.searchParams.get('rtm') !== 'Y' ||
      url.searchParams.get('ymd') !== `${year}${month}${day}` || url.searchParams.get('hh') !== hour ||
      !/^[1-4]$/u.test(url.searchParams.get('pg') ?? '')) fail('Unexpected source pagination link.');
		return { url: url.href, page: Number(url.searchParams.get('pg')), current: $(element).hasClass('current') };
	});
	if (pageLinks.length !== 4 || new Set(pageLinks.map(item => item.page)).size !== 4 || pageLinks.filter(item => item.current).length !== 1) fail('Missing or ambiguous four-page chart navigation.');
	return { chartDate, sourceUpdatedAt: instant.toISOString(), ids, pageLinks,
										page: pageLinks.find(item => item.current)!.page };
}

function parsePage(body: string) {
	const $ = load(body);
	const metadata = pageMetadata($);
	if ($('tr.list[songid]').length !== 50) fail('Each chart page must contain exactly 50 songs.');
	const entries = $('tr.list[songid]').toArray().map((element): ExternalEntry => {
		const row = $(element);
		const songId = row.attr('songid')!;
		const rankText = clean(row.find('td.number').clone().children().remove().end().text());
		const rank = Number(rankText);
		const title = clean(row.find('a.title').clone().find('.icon,.hide').remove().end().text());
		const artist = row.find('a.artist').first();
		const artistName = clean(artist.text());
		const albumLink = row.find('a.albumtitle').first();
		const album = clean(albumLink.text());
		if (!/^\d+$/u.test(songId) || !/^\d+$/u.test(rankText) || !Number.isInteger(rank) ||
      rank < (metadata.page - 1) * 50 + 1 || rank > metadata.page * 50 || !title || !artistName || !album) fail('Incomplete or out-of-page song metadata.');
		const sourceImage = row.find('a.cover img').attr('src');
		let albumCoverUrl: string | null = null;
		if (sourceImage) {
			try {
				const url = new URL(sourceImage.startsWith('//') ? `https:${sourceImage}` : sourceImage);
				if (url.protocol === 'https:' && url.hostname === 'image.genie.co.kr' && !url.username && !url.password && !url.port) albumCoverUrl = url.href;
			} catch { /* Missing artwork does not invent or invalidate ranking evidence. */ }
		}
		let sourceMovement: ExternalEntry['sourceMovement'] = { type: 'unknown', amount: null };
		for (const type of ['up', 'down'] as const) {
			const movement = row.find(`.rank-${type}`);
			if (movement.length) {
				const amountText = clean(movement.clone().children().remove().end().text());
				if (!/^\d+$/u.test(amountText) || Number(amountText) < 1) fail('Invalid source movement amount.');
				sourceMovement = { type, amount: Number(amountText) };
			}
		}
		if (row.find('.rank-none').length) sourceMovement = { type: 'same', amount: 0 };
		if (row.find('.rank-new').length) sourceMovement = { type: 'new', amount: null };
		// Genie sometimes displays a collaboration as one credited artist string
		// with one artist ID. Preserve that source credit instead of guessing IDs.
		return { songId, rank, title, artists: [{ id: numberId(artist.attr('onclick')), name: artistName }],
											album, albumId: numberId(albumLink.attr('onclick')), albumCoverUrl, sourceMovement };
	});
	return { ...metadata, entries };
}

/** Input is a JSON evidence envelope containing all four unmodified HTML pages. */
export function parseGenie(body: string, fetchedAt: string): ExternalSnapshot {
	if (!Number.isFinite(Date.parse(fetchedAt))) fail('Invalid fetch timestamp.');
	let envelope: { pages?: unknown };
	try { envelope = JSON.parse(body); } catch { return fail('Expected four-page JSON evidence envelope.'); }
	if (!envelope || !Array.isArray(envelope.pages) || envelope.pages.length !== 4 || envelope.pages.some(page => typeof page !== 'string')) fail('Four public HTML pages are required; a preview is not a full chart.');
	const pages = (envelope.pages as string[]).map(parsePage);
	const first = pages[0];
	if (pages.some((page, index) => page.page !== index + 1 || page.sourceUpdatedAt !== first.sourceUpdatedAt || JSON.stringify(page.ids) !== JSON.stringify(first.ids))) fail('Chart pages belong to different periods or are duplicated/out of order.');
	if (Date.parse(first.sourceUpdatedAt) > Date.parse(fetchedAt) + 5 * 60_000) fail('The official chart timestamp is in the future.');
	const entries = pages.flatMap(page => page.entries);
	if (new Set(entries.map(entry => entry.songId)).size !== 200 || entries.some((entry, index) => entry.rank !== index + 1 || entry.songId !== first.ids[index])) fail('The four pages do not match the complete source ranking.');
	return finishSnapshot({ provider: 'genie', chartKey: GENIE_CHART_KEY, sourceUrl: GENIE_URL,
																									sourceUpdatedAt: first.sourceUpdatedAt, chartDate: first.chartDate, fetchedAt,
																									expectedCount: 200, entries }, body);
}

/** The supplied reader enforces network policy; only source-published links are followed. */
export async function collectGenie(read: Read): Promise<{ snapshot: ExternalSnapshot; raw: string }> {
	const first = await read(GENIE_URL);
	const metadata = pageMetadata(load(first.body));
	if (metadata.page !== 1) fail('The public chart entry point is not page one.');
	const pages = [first.body];
	let fetchedAt = first.fetchedAt;
	for (let page = 2; page <= 4; page++) {
		const response = await read(metadata.pageLinks.find(link => link.page === page)!.url);
		pages.push(response.body);
		fetchedAt = response.fetchedAt;
	}
	const raw = JSON.stringify({ pages });
	return { snapshot: parseGenie(raw, fetchedAt), raw };
}
