/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { load } from './parser-html.js';
import { finishSnapshot, type ExternalEntry, type ExternalSnapshot } from './parser-external-types.js';

export const TENCENT_URL = 'https://yobang.tencentmusic.com/chart/korean-chart/rankList/';
export const TENCENT_CHART_KEY = 'korean';
const fail = (message: string): never => { throw new Error(`INVALID_TENCENT_CHART: ${message}`); };
const clean = (value: string): string => value.replace(/\s+/gu, ' ').trim();
const text = (value: unknown): string => typeof value === 'string' ? clean(value) : '';

function coverUrl(value: unknown): string | null {
	if (typeof value !== 'string' || /[\u0000-\u0020\u007f\\]/u.test(value)) return null;
	try {
		const url = new URL(value.startsWith('//') ? `https:${value}` : value);
		return url.protocol === 'https:' && url.hostname === 'y.gtimg.cn' && !url.port && !url.username && !url.password ? url.href : null;
	} catch { return null; }
}

/** Parse the source's first ten visible positions; this is explicitly a preview. */
export function parseTencent(body: string, fetchedAt: string): ExternalSnapshot {
	if (!Number.isFinite(Date.parse(fetchedAt))) fail('Invalid fetch timestamp.');
	const $ = load(body);
	const scripts = $('script#__NEXT_DATA__[type="application/json"]');
	if (scripts.length !== 1) fail('Missing or ambiguous public embedded chart data.');
	let data: any;
	try { data = JSON.parse(scripts.text()); } catch { return fail('Malformed embedded chart JSON.'); }
	const props = data?.props?.pageProps;
	if (data?.page !== '/korean-chart/rankList' || !Array.isArray(props?.data) || props.data.length !== 10) fail('Expected the ten-song Korean chart preview.');
	const issue = props.chartIssueVo;
	if (!issue || !/^\d{6}$/u.test(text(issue.issue)) || issue.currentIssue !== true) fail('Missing current Korean chart issue.');
	const updateText = text(issue.updateTime);
	let chartDate: string | null = null;
	if (updateText) {
		if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/u.test(updateText) ||
      (props.SSG_UPDATETIME !== undefined && props.SSG_UPDATETIME !== updateText)) fail('Inconsistent official update text.');
		const calendar = new Date(`${updateText.replace(' ', 'T')}:00Z`);
		if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 16).replace('T', ' ') !== updateText) fail('Invalid official calendar date.');
		chartDate = updateText.slice(0, 10);
	}
	const rows = $('[class*="songItem_songContainer__"]');
	if (rows.length !== 10) fail('Visible HTML must contain the same ten songs.');
	const songIds = new Set<string>();
	const entries: ExternalEntry[] = props.data.map((item: any, index: number) => {
		const row = rows.eq(index);
		const info = item?.info;
		const songId = text(item?.itemId);
		const rank = item?.rank;
		const title = text(info?.trackNameShow);
		if (item?.chartCode !== 'korean_chart' || item?.issue !== issue.issue || item?.onDynamicChart !== true ||
      !/^\d+$/u.test(songId) || songIds.has(songId) || rank !== index + 1 || !title || !info) fail('Invalid song ID, rank, or mixed chart issue.');
		const rankElement = row.find('[class*="songItem_rankIndex__"]');
		const titleElement = row.find('[class*="songItem_trackName__"]');
		const image = row.find('img[class*="songItem_coverImages__"]');
		if (rankElement.length !== 1 || titleElement.length !== 1 || clean(rankElement.text()) !== String(rank) ||
      clean(titleElement.text()) !== title) fail('Rendered rank/title disagree with the embedded data.');
		const sourceCover = coverUrl(info.coverImages);
		if (image.length > 1 || coverUrl(image.attr('src')) !== sourceCover) fail('Rendered cover disagrees with the embedded data.');
		const artistNames = text(info.singerName).split(',').map(clean);
		const artistIds = text(info.singerId).split(',').map(clean);
		if (!artistNames.length || artistNames.some(name => !name) || artistIds.length !== artistNames.length || artistIds.some(id => !/^\d+$/u.test(id))) fail('Incomplete or ambiguous source artist credits.');
		const renderedArtists = clean(row.find('[class*="songItem_singerName__"]').text());
		if (renderedArtists && renderedArtists !== artistNames.join(',')) fail('Rendered artist credits disagree with the embedded data.');
		let sourceMovement: ExternalEntry['sourceMovement'] = { type: 'unknown', amount: null };
		// incrScore is a score change, and extend.lastWeekRank is last week's
		// rank. Neither is the current rank movement represented here.
		if (Number.isInteger(item.preRank) && item.preRank > 0 && Number.isInteger(item.incrRank)) {
			const delta = item.preRank - rank;
			if (item.incrRank !== delta) fail('Source rank movement fields disagree.');
			sourceMovement = delta === 0 ? { type: 'same', amount: 0 } :
				{ type: delta > 0 ? 'up' : 'down', amount: Math.abs(delta) };
		}
		if (row.find('[class*="TrendArrow_noChange__"]').length && sourceMovement.type !== 'same' && sourceMovement.type !== 'unknown') fail('Rendered movement disagrees with the source rank fields.');
		songIds.add(songId);
		return { songId, rank, title, artists: artistNames.map((name, artistIndex) => ({ id: artistIds[artistIndex], name })),
											album: text(info.albumName) || null, albumId: text(info.qyAlbumMid) || null,
											albumCoverUrl: sourceCover, sourceMovement };
	});
	// The HTML gives an update wall-clock string but does not establish its
	// timezone. Keep its confirmed date; do not manufacture an ISO instant.
	return finishSnapshot({ provider: 'tencent', chartKey: TENCENT_CHART_KEY, sourceUrl: TENCENT_URL,
																									sourceUpdatedAt: null, chartDate, fetchedAt, expectedCount: 10, coverage: 'preview',
																									sourceTotal: null, entries }, body);
}
