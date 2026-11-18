/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { finishSnapshot, type ExternalEntry, type ExternalSnapshot } from './parser-external-types.js';

export const FLO_URL = 'https://www.music-flo.com/browse';
export const FLO_CHART_API_URL = 'https://www.music-flo.com/api/display/v1/browser/chart/1/track/list?size=100';
export const FLO_CHART_KEY = 'chart';
const fail = (message: string): never => { throw new Error(`INVALID_FLO_CHART: ${message}`); };
const text = (value: unknown): string => typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';

function id(value: unknown): string | null {
	if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
	return typeof value === 'string' && /^[1-9]\d*$/u.test(value) ? value : null;
}

function cover(value: unknown): string | null {
	if (typeof value !== 'string' || /[\u0000-\u0020\u007f\\]/u.test(value)) return null;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' && url.hostname === 'cdn.music-flo.com' && !url.port && !url.username && !url.password ? value : null;
	} catch { return null; }
}

/** Parse the anonymous JSON response actually requested by the public browse page. */
export function parseFlo(body: string, fetchedAt: string): ExternalSnapshot {
	if (!Number.isFinite(Date.parse(fetchedAt))) fail('Invalid fetch timestamp.');
	let response: any;
	try { response = JSON.parse(body); } catch { return fail('Expected public chart JSON.'); }
	const data = response?.data;
	if (response?.code !== '2000000' || data?.id !== 1 || data?.name !== 'FLO 차트' || data?.type !== 'RANK_CHART' ||
    data?.totalCount !== 100 || !Array.isArray(data.trackList) || data.trackList.length !== 100) fail('The response is not the complete 100-song FLO chart.');
	const seen = new Set<string>();
	const entries: ExternalEntry[] = data.trackList.map((track: any, index: number) => {
		const songId = id(track?.id) ?? fail('Invalid song ID.');
		const title = text(track?.name);
		const albumId = id(track?.album?.id);
		const album = text(track?.album?.title);
		if (!songId || seen.has(songId) || !title || !albumId || !album || !Array.isArray(track.artistList) || !track.artistList.length) fail('Incomplete or duplicate song metadata.');
		const artists = track.artistList.map((artist: any) => {
			const artistId = id(artist?.id); const name = text(artist?.name);
			if (!artistId || !name) fail('Incomplete artist credit.');
			return { id: artistId, name };
		});
		const images = Array.isArray(track.album.imgList) ? track.album.imgList : [];
		const preferredImage = images.find((image: any) => image?.size === 140 && cover(image.url)) ??
      images.find((image: any) => cover(image?.url));
		const albumCoverUrl = cover(preferredImage?.url);
		let sourceMovement: ExternalEntry['sourceMovement'] = { type: 'unknown', amount: null };
		if (track.rank?.newYn === 'Y') sourceMovement = { type: 'new', amount: null };
		else if (track.rank?.newYn === 'N' && Number.isSafeInteger(track.rank.rankBadge)) {
			const delta = track.rank.rankBadge;
			// Official DOM: +1 is labelled 1 상승; -2 is labelled 2 하락.
			sourceMovement = delta === 0 ? { type: 'same', amount: 0 } :
				{ type: delta > 0 ? 'up' : 'down', amount: Math.abs(delta) };
		}
		seen.add(songId);
		// The ordered list is the official chart order, independently checked
		// against the expanded public DOM's explicit positions 1 through 100.
		return { songId, rank: index + 1, title, artists, album, albumId, albumCoverUrl, sourceMovement };
	});
	// basedOnUpdate contains only a 24-hour aggregation label and hour. Track
	// metadata dates and the HTTP/capture date are not the chart's update date.
	return finishSnapshot({ provider: 'flo', chartKey: FLO_CHART_KEY, sourceUrl: FLO_URL,
																									sourceUpdatedAt: null, chartDate: null, fetchedAt, expectedCount: 100,
																									coverage: 'complete', sourceTotal: 100, entries }, body);
}
