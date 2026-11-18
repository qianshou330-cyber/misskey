/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as cheerio from './parser-html.js';
import { finishSnapshot, type ExternalEntry, type ExternalSnapshot } from './parser-external-types.js';

export const APPLE_PLAYLIST_ID = 'pl.d3d10c32fbc540b38e266367dc8cb00c';
export const APPLE_SOURCE_URL = `https://music.apple.com/ee/playlist/top-100-south-korea/${APPLE_PLAYLIST_ID}`;
export const APPLE_CHART_KEY = 'top100-kr';
export const APPLE_COVER_HOSTS = ['is1-ssl.mzstatic.com'] as const;
const TITLE = 'Top 100: South Korea';
const clean = (value: string): string => value.replace(/\s+/gu, ' ').trim();

function valid(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`Apple Music validation: ${message}`);
}

function object(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string { return typeof value === 'string' ? clean(value) : ''; }

function publicUrl(value: unknown, host: string): URL | null {
	if (typeof value !== 'string' || /[\u0000-\u0020\u007f\\]/u.test(value)) return null;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' && url.hostname === host && !url.username && !url.password && !url.port && !url.hash ? url : null;
	} catch { return null; }
}

function catalogId(value: unknown, kind: 'song' | 'artist' | 'album'): string | null {
	const url = publicUrl(value, 'music.apple.com');
	if (!url) return null;
	if (kind === 'song' && /^\/ee\/album\/[^/]+\/\d+$/.test(url.pathname)) {
		const id = url.searchParams.get('i');
		return id && /^\d+$/.test(id) ? id : null;
	}
	if (url.search) return null;
	return url.pathname.match(new RegExp(`^/ee/${kind}/[^/]+/(\\d+)$`))?.[1] ?? null;
}

function descriptor(value: unknown, kind: 'song' | 'artist' | 'album', row: number): string {
	const data = object(value);
	const id = object(data.identifiers).storeAdamID;
	valid(data.kind === kind && typeof id === 'string' && /^\d+$/.test(id), `missing ${kind} identity at position ${row}`);
	valid(catalogId(data.url, kind) === id, `${kind} link and identifier disagree at position ${row}`);
	return id;
}

function linkedDescriptor(link: unknown): unknown {
	return object(object(object(link).segue).destination).contentDescriptor;
}

function coverUrl(value: unknown): string | null {
	const url = publicUrl(value, APPLE_COVER_HOSTS[0]);
	return url && url.pathname.startsWith('/image/thumb/') && !/[{}]/.test(String(value)) ? String(value) : null;
}

/** Read only the two public JSON data blocks already included in the page.
 * The page's numeric rankingText and JSON-LD array must agree on all 100
 * positions. No session state, playback actions, tokens, scripts or APIs are used.
 */
export function parseApple(body: string, fetchedAt: string): ExternalSnapshot {
	valid(Number.isFinite(Date.parse(fetchedAt)) && /(?:Z|[+-]\d{2}:\d{2})$/i.test(fetchedAt), 'fetchedAt needs an explicit timezone');
	const $ = cheerio.load(body);
	valid(!/captcha|access denied|forbidden|just a moment|verify (?:you|your)|log ?in/i.test($('title').text()), 'access challenge; stop collection');
	valid($('link[rel="canonical"]').attr('href') === APPLE_SOURCE_URL, 'canonical playlist identity mismatch');
	valid(text($('[data-testid="non-editable-product-title"]').text()) === TITLE, 'visible playlist title mismatch');
	const ldElements = $('script[id="schema:music-playlist"][type="application/ld+json"]');
	const stateElements = $('script#serialized-server-data[type="application/json"]');
	valid(ldElements.length === 1 && stateElements.length === 1, 'missing or ambiguous public playlist data');
	let ld: Record<string, unknown>, root: Record<string, unknown>;
	try { ld = object(JSON.parse(ldElements.text())); root = object(JSON.parse(stateElements.text())); } catch { throw new Error('Apple Music validation: malformed public JSON'); }
	valid(ld['@type'] === 'MusicPlaylist' && ld.name === TITLE && ld.url === APPLE_SOURCE_URL, 'JSON-LD playlist identity mismatch');
	valid(ld.numTracks === 100 && Array.isArray(ld.track) && ld.track.length === 100, 'JSON-LD must confirm exactly 100 songs');
	const tracks = ld.track;
	// Access only data[].intent and the public page data. Authentication-related
	// siblings in the serialized envelope are deliberately never inspected.
	const pages = (Array.isArray(root.data) ? root.data : []).map(object).filter(page => {
		const intent = object(page.intent), content = object(intent.contentDescriptor);
		return intent.$kind === 'PlaylistDetailPageIntent' && content.kind === 'playlist' &&
      object(content.identifiers).storeAdamID === APPLE_PLAYLIST_ID && object(content.locale).storefront === 'ee';
	});
	valid(pages.length === 1, 'missing or ambiguous matching playlist page');
	const page = object(pages[0].data);
	valid(page.canonicalURL === APPLE_SOURCE_URL && Array.isArray(page.sections), 'public page identity mismatch');
	const sections = page.sections.map(object);
	const headers = sections.filter(section => section.id === `playlist-detail-header-section - ${APPLE_PLAYLIST_ID}`);
	const lists = sections.filter(section => section.id === `track-list - ${APPLE_PLAYLIST_ID}` && section.itemKind === 'trackLockup');
	valid(headers.length === 1 && lists.length === 1, 'missing or ambiguous public song list');
	const headerItems = headers[0].items;
	valid(Array.isArray(headerItems) && headerItems.length === 1, 'missing playlist header');
	const header = object(headerItems[0]);
	valid(header.title === TITLE && header.trackCount === 100, 'public header does not confirm 100 songs');
	const container = object(lists[0].containerContentDescriptor);
	valid(container.kind === 'playlist' && object(container.identifiers).storeAdamID === APPLE_PLAYLIST_ID && container.url === APPLE_SOURCE_URL, 'track list belongs to a different playlist');
	const rows = lists[0].items;
	valid(Array.isArray(rows) && rows.length === 100, 'public song list must contain exactly 100 songs');
	const seen = new Set<string>();
	const entries: ExternalEntry[] = rows.map((value, index) => {
		const position = index + 1, row = object(value), track = object(tracks[index]);
		valid(row.rankingText === String(position), `public numeric position disagrees with order at ${position}`);
		const songId = descriptor(row.contentDescriptor, 'song', position);
		valid(row.id === `track-lockup - ${APPLE_PLAYLIST_ID} - ${songId}`, `row identity mismatch at ${position}`);
		valid(!seen.has(songId), 'duplicate song identity'); seen.add(songId);
		valid(track['@type'] === 'MusicRecording' && catalogId(track.url, 'song') === songId, `JSON-LD and public song order disagree at ${position}`);
		const title = text(row.title);
		valid(title && title === text(track.name) && (!object(track.audio).name || title === text(object(track.audio).name)), `song title mismatch at ${position}`);
		valid(Array.isArray(row.subtitleLinks) && row.subtitleLinks.length > 0, `missing artist credits at ${position}`);
		const artistIds = new Set<string>();
		const artists = row.subtitleLinks.map(value => {
			const link = object(value), id = descriptor(linkedDescriptor(link), 'artist', position), name = text(link.title);
			valid(name && !artistIds.has(id), `missing or duplicate artist credit at ${position}`); artistIds.add(id);
			return { id, name };
		});
		const displayNames = artists.length < 3 ? artists.map(artist => artist.name).join(' & ') :
			artists.slice(0, -1).map(artist => artist.name).join(', ') + ' & ' + artists.at(-1)!.name;
		valid(text(row.artistName) === displayNames, `artist display and linked credits disagree at ${position}`);
		const albums = Array.isArray(row.tertiaryLinks) ? row.tertiaryLinks.map(object) : [];
		valid(albums.length <= 1, `ambiguous album at ${position}`);
		const album = albums.length ? text(albums[0].title) || null : null;
		const albumId = albums.length ? descriptor(linkedDescriptor(albums[0]), 'album', position) : null;
		const albumCoverUrl = coverUrl(object(track.audio).thumbnailUrl);
		if (albumCoverUrl) {
			const template = object(object(row.artwork).dictionary).url;
			const templateUrl = publicUrl(template, APPLE_COVER_HOSTS[0]);
			valid(templateUrl && typeof template === 'string' && template.endsWith('/{w}x{h}bb.{f}'), `missing corresponding artwork at ${position}`);
			valid(albumCoverUrl.slice(0, albumCoverUrl.lastIndexOf('/')) === template.slice(0, template.lastIndexOf('/')), `artwork assets disagree at ${position}`);
		}
		return { songId, rank: position, title, artists, album, albumId, albumCoverUrl,
											sourceMovement: { type: 'unknown', amount: null } };
	});
	// datePublished is playlist publication metadata, not a confirmed chart
	// measurement/update timestamp. Preserve that distinction by leaving null.
	return finishSnapshot({ provider: 'apple', chartKey: APPLE_CHART_KEY, sourceUrl: APPLE_SOURCE_URL,
																									sourceUpdatedAt: null, chartDate: null, fetchedAt, expectedCount: 100, entries }, body);
}
