/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from 'node:assert/strict';
import { test } from 'vitest';
import { parseSpotify, SPOTIFY_PLAYLIST_ID, SPOTIFY_SOURCE_URL } from '../../src/core/kpop-charts/parser-spotify.js';

const FETCHED_AT = '2026-10-17T14:16:39Z';
const COVER = 'https://i.scdn.co/image/ab67616d00004851b530cdeee0fc5d2d2888e3c2';
const songId = (index: number): string => `syntheticSong${String(index + 1).padStart(9, '0')}`;
const ARTIST_ID = 'syntheticArtist0000001';
const ALBUM_ID = 'syntheticAlbum00000001';

function fixture(options: { count?: number; total?: number; nextOffset?: number; mutate?: (items: any[]) => void; extraArtist?: boolean } = {}): string {
	const count = options.count ?? 30;
	const items = Array.from({ length: count }, (_, index) => ({ itemV2: { data: {
		uri: `spotify:track:${songId(index)}`, name: `Synthetic song ${index + 1}`,
		albumOfTrack: { name: 'Synthetic album', uri: `spotify:album:${ALBUM_ID}` },
		artists: { items: [{ uri: `spotify:artist:${ARTIST_ID}`, profile: { name: 'Example Group' } },
																					...(options.extraArtist ? [{ uri: 'spotify:artist:0Vkn28k7P4K95Ce3knN0hQ', profile: { name: 'A2O LITE' } }] : [])] },
	} } }));
	const rows = items.map((item, index) => `<div data-testid="track-row" aria-labelledby="listrow-title-track-spotify:track:${songId(index)}-${index}">
    <img data-encore-id="image" src="${COVER}"><a href="/track/${songId(index)}">${item.itemV2.data.name}</a>
    <span data-testid="internal-artist-link"><a href="/artist/${ARTIST_ID}">Example Group</a></span>
    ${options.extraArtist ? '<span data-testid="internal-artist-link"><a href="/artist/0Vkn28k7P4K95Ce3knN0hQ">A2O LITE</a></span>' : ''}</div>`).join('');
	options.mutate?.(items);
	const state = { entities: { items: { [`spotify:playlist:${SPOTIFY_PLAYLIST_ID}`]: {
		name: 'Top 50 - South Korea', id: SPOTIFY_PLAYLIST_ID, uri: `spotify:playlist:${SPOTIFY_PLAYLIST_ID}`,
		content: { items, totalCount: options.total ?? 50, pagingInfo: { nextOffset: options.nextOffset ?? 30 } },
	} } } };
	return `<html><head><title>Top 50 - South Korea | Spotify Playlist</title>
    <meta property="og:url" content="${SPOTIFY_SOURCE_URL}"><meta property="og:title" content="Top 50 - South Korea"></head>
    <body><h1>Top 50 - South Korea</h1><img src="https://i.scdn.co/image/playlist-logo">
    <div data-testid="infinite-scroll-list">${rows}</div>
    <script id="initialState" type="text/plain">${Buffer.from(JSON.stringify(state)).toString('base64')}</script></body></html>`;
}

const parse = (html = fixture()) => parseSpotify(html, FETCHED_AT);

test('Spotify stores exactly 30 publicly ordered items as a 30/50 preview', () => {
	const result = parse();
	assert.equal(result.provider, 'spotify');
	assert.equal(result.chartKey, 'daily-kr');
	assert.equal(result.coverage, 'preview');
	assert.equal(result.sourceTotal, 50);
	assert.equal(result.expectedCount, 30);
	assert.equal(result.entries.length, 30);
	assert.deepEqual(result.entries.map(entry => entry.rank), Array.from({ length: 30 }, (_, index) => index + 1));
	assert.equal(result.entries[0].album, 'Synthetic album');
	assert.equal(result.entries[0].albumCoverUrl, COVER);
	assert.equal(result.entries[29].songId, songId(29));
});

test('Spotify rejects short/oversized previews and unconfirmed total or preview boundaries', () => {
	assert.throws(() => parse(fixture({ count: 29 })), /exactly 30 preview items/);
	assert.throws(() => parse(fixture({ count: 31 })), /exactly 30 preview items/);
	assert.throws(() => parse(fixture({ total: 100 })), /confirm 50/);
	assert.throws(() => parse(fixture({ nextOffset: 20 })), /boundary/);
	assert.throws(() => parse(fixture().replace('data-testid="track-row"', 'data-testid="removed"')), /received 29/);
});

test('Spotify rejects duplicates, reordered state and conflicting public row indices', () => {
	assert.throws(() => parse(fixture({ mutate: items => { items.reverse(); } })), /order disagree/);
	assert.throws(() => parse(fixture().replaceAll(songId(1), songId(0))), /duplicate song ID/);
	assert.throws(() => parse(fixture().replace(`${songId(0)}-0`, `${songId(0)}-5`)), /row index/);
	assert.throws(() => parse(fixture({ mutate: items => { items[0].itemV2.data.name = 'Different'; } })), /title mismatch/);
});

test('Spotify preserves all public artist credits, nullable album metadata and same-row artwork', () => {
	assert.equal(parse(fixture({ extraArtist: true })).entries[0].artists[1].name, 'A2O LITE');
	assert.throws(() => parse(fixture({ extraArtist: true }).replace('<a href="/artist/0Vkn28k7P4K95Ce3knN0hQ">A2O LITE</a>', '')), /credits disagree/);
	const missingAlbum = parse(fixture({ mutate: items => { delete items[0].itemV2.data.albumOfTrack; } }));
	assert.equal(missingAlbum.entries[0].album, null);
	assert.equal(missingAlbum.entries[0].albumId, null);
	for (const unsafe of ['javascript:alert(1)', 'https://i.scdn.co.evil.example/image/a', 'https://user@i.scdn.co/image/a']) {
		assert.equal(parse(fixture().replace(COVER, unsafe)).entries[0].albumCoverUrl, null);
	}
	const missingImage = parse(fixture().replace(`<img data-encore-id="image" src="${COVER}">`, ''));
	assert.equal(missingImage.entries[0].albumCoverUrl, null);
	assert.equal(missingImage.entries[1].albumCoverUrl, COVER);
});

test('Spotify rejects other playlist identities, challenges and malformed embedded state', () => {
	assert.throws(() => parse(fixture().replaceAll('South Korea', 'Japan')), /confirm Top 50/);
	assert.throws(() => parse(fixture().replace(`content="${SPOTIFY_SOURCE_URL}"`, 'content="https://open.spotify.com/playlist/other"')), /identity mismatch/);
	assert.throws(() => parse('<title>Access denied</title>'), /access challenge/);
	assert.throws(() => parse(fixture().replace(/(<script id="initialState"[^>]*>)[^<]+/, '$1not-valid-json')), /invalid public playlist JSON/);
	assert.throws(() => parseSpotify(fixture(), '2026-10-17T14:16:39'), /timezone/);
});

test('Spotify does not invent chart dates or movement and hashes ignore fetch time', () => {
	const first = parse();
	const second = parseSpotify(fixture().replace('<body>', '<body><!-- extra markup -->'), '2026-10-18T14:16:39Z');
	assert.equal(first.sourceUpdatedAt, null);
	assert.equal(first.chartDate, null);
	assert.deepEqual(first.entries[0].sourceMovement, { type: 'unknown', amount: null });
	assert.equal(first.contentHash, second.contentHash);
	assert.notEqual(first.rawHash, second.rawHash);
});
