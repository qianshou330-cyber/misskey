/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as cheerio from './parser-html.js';
import { finishSnapshot, type ExternalEntry, type ExternalSnapshot } from './parser-external-types.js';

export const SPOTIFY_PLAYLIST_ID = '37i9dQZEVXbNxXF4SkHj9F';
export const SPOTIFY_SOURCE_URL = `https://open.spotify.com/playlist/${SPOTIFY_PLAYLIST_ID}`;
export const SPOTIFY_CHART_KEY = 'daily-kr';
const PLAYLIST_URI = `spotify:playlist:${SPOTIFY_PLAYLIST_ID}`;
const PLAYLIST_TITLE = 'Top 50 - South Korea';
const clean = (value: string): string => value.replace(/\s+/gu, ' ').trim();

function requireValid(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`Spotify validation: ${message}`);
}

function object(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function uriId(value: unknown, kind: 'track' | 'artist' | 'album'): string | null {
	return typeof value === 'string' ? value.match(new RegExp(`^spotify:${kind}:([A-Za-z0-9]{22})$`))?.[1] ?? null : null;
}

function linkId(value: string | undefined, kind: 'track' | 'artist'): string | null {
	if (!value) return null;
	return value.match(new RegExp(`^(?:https://open\\.spotify\\.com)?/${kind}/([A-Za-z0-9]{22})(?:[?#].*)?$`))?.[1] ?? null;
}

function coverUrl(value: string | undefined): string | null {
	if (!value || /[\u0000-\u0020\u007f\\]/u.test(value)) return null;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' && url.hostname === 'i.scdn.co' && !url.username && !url.password && !url.port ? value : null;
	} catch { return null; }
}

/** Parse only the 30 publicly rendered rows, preserving their official list order.
 * The HTML's public playlist entity confirms 50 total; no next page is requested.
 * Session/authentication state and page scripts are never used or executed.
 */
export function parseSpotify(body: string, fetchedAt: string): ExternalSnapshot {
	requireValid(Number.isFinite(Date.parse(fetchedAt)) && /(?:Z|[+-]\d{2}:\d{2})$/i.test(fetchedAt), 'fetchedAt needs an explicit timezone');
	const $ = cheerio.load(body);
	const title = clean($('title').text());
	requireValid(!/captcha|access denied|forbidden|verify (?:you|your)|login|log in/i.test(title), 'access challenge; stop collection');
	requireValid(title === `${PLAYLIST_TITLE} | Spotify Playlist` && clean($('h1').text()) === PLAYLIST_TITLE, 'page does not confirm Top 50 - South Korea');
	requireValid($('meta[property="og:url"]').attr('content') === SPOTIFY_SOURCE_URL && $('meta[property="og:title"]').attr('content') === PLAYLIST_TITLE, 'playlist identity mismatch');
	const stateElements = $('script#initialState[type="text/plain"]');
	requireValid(stateElements.length === 1, 'missing or ambiguous public playlist state');
	const encoded = stateElements.text().trim();
	requireValid(encoded.length > 0 && encoded.length <= 3_000_000, 'invalid public state size');
	let state: unknown;
	try {
		// Spotify embeds plain JSON as base64 text. This is data decoding, not eval.
		requireValid(/^[A-Za-z0-9+/]+={0,2}$/.test(encoded), 'malformed public state encoding');
		state = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
	} catch { throw new Error('Spotify validation: invalid public playlist JSON'); }
	// Deliberately access only the public playlist entity, never session/auth state.
	const playlist = object(object(object(object(state).entities).items)[PLAYLIST_URI]);
	requireValid(playlist.name === PLAYLIST_TITLE && playlist.uri === PLAYLIST_URI && playlist.id === SPOTIFY_PLAYLIST_ID, 'embedded playlist identity mismatch');
	const content = object(playlist.content);
	requireValid(content.totalCount === 50, 'source does not confirm 50 total songs');
	requireValid(Array.isArray(content.items) && content.items.length === 30, 'public playlist state must contain exactly 30 preview items');
	const items = content.items;
	requireValid(object(content.pagingInfo).nextOffset === 30, 'public preview boundary is not confirmed');
	const lists = $('[data-testid="infinite-scroll-list"]');
	requireValid(lists.length === 1, 'missing or ambiguous public song list');
	const rows = lists.find('[data-testid="track-row"]');
	requireValid(rows.length === 30, `expected exactly 30 public preview rows; received ${rows.length}`);
	const ids = new Set<string>();
	const entries: ExternalEntry[] = [];
	rows.each((index, element) => {
		const row = $(element);
		const trackLinks = row.find('a[href]').filter((_, anchor) => linkId($(anchor).attr('href'), 'track') !== null);
		requireValid(trackLinks.length === 1, `missing or ambiguous track link at list position ${index + 1}`);
		const songId = linkId(trackLinks.attr('href'), 'track')!;
		requireValid(!ids.has(songId), 'duplicate song ID');
		ids.add(songId);
		const data = object(object(object(items[index]).itemV2).data);
		requireValid(uriId(data.uri, 'track') === songId, `DOM and embedded song order disagree at position ${index + 1}`);
		const labelId = row.attr('aria-labelledby');
		requireValid(labelId === `listrow-title-track-spotify:track:${songId}-${index}`, 'public row index disagrees with list order');
		const songTitle = clean(trackLinks.text());
		requireValid(songTitle && typeof data.name === 'string' && songTitle === clean(data.name), `song title mismatch for ${songId}`);
		const artists: ExternalEntry['artists'] = [];
		const artistIds = new Set<string>();
		row.find('[data-testid="internal-artist-link"] a').each((_, anchor) => {
			const link = $(anchor);
			const id = linkId(link.attr('href'), 'artist');
			const name = clean(link.text());
			requireValid(id && name, `missing artist metadata for ${songId}`);
			if (!artistIds.has(id)) { artists.push({ id, name }); artistIds.add(id); }
		});
		const sourceArtists = object(data.artists).items;
		requireValid(artists.length > 0 && Array.isArray(sourceArtists), `missing artists for ${songId}`);
		requireValid(sourceArtists.length === artists.length && sourceArtists.every((value, artistIndex) => {
			const artist = object(value);
			return uriId(artist.uri, 'artist') === artists[artistIndex].id && object(artist.profile).name === artists[artistIndex].name;
		}), `DOM and embedded artist credits disagree for ${songId}`);
		const album = object(data.albumOfTrack);
		entries.push({ songId, rank: index + 1, title: songTitle, artists,
																	album: typeof album.name === 'string' ? clean(album.name) || null : null,
																	albumId: uriId(album.uri, 'album'),
																	albumCoverUrl: coverUrl(row.find('img[data-encore-id="image"]').first().attr('src')),
																	sourceMovement: { type: 'unknown', amount: null } });
	});
	requireValid(entries.length === 30 && entries.every((entry, index) => entry.rank === index + 1), 'preview positions must be unique and contiguous 1–30');
	return finishSnapshot({ provider: 'spotify', chartKey: SPOTIFY_CHART_KEY, sourceUrl: SPOTIFY_SOURCE_URL,
																									sourceUpdatedAt: null, chartDate: null, fetchedAt, coverage: 'preview', sourceTotal: 50,
																									expectedCount: 30, entries }, body);
}
