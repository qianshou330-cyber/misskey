/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from 'node:assert/strict';
import { test } from 'vitest';
import { parseApple, APPLE_PLAYLIST_ID, APPLE_SOURCE_URL } from '../../src/core/kpop-charts/parser-apple.js';

const fetchedAt = '2026-10-17T14:16:41Z';
const songId = (index: number) => String(1000000000 + index);
const COVER = 'https://is1-ssl.mzstatic.com/image/thumb/Music/fixture/Cover.jpg/1200x630bb.jpg';
const TEMPLATE = 'https://is1-ssl.mzstatic.com/image/thumb/Music/fixture/Cover.jpg/{w}x{h}bb.{f}';
const title = 'Top 100: South Korea';

function link(kind: string, id: string, name: string) {
	return { title: name, segue: { destination: { contentDescriptor: {
		kind, identifiers: { storeAdamID: id }, url: `https://music.apple.com/ee/${kind}/synthetic/${id}`,
	} } } };
}

function fixture(options: { count?: number; mutate?: (data: { ld: any; rows: any[]; page: any }) => void } = {}): string {
	const count = options.count ?? 100;
	const rows = Array.from({ length: count }, (_, index) => ({
		id: `track-lockup - ${APPLE_PLAYLIST_ID} - ${songId(index)}`, title: `Synthetic song ${index + 1}`,
		rankingText: String(index + 1), trackNumber: null,
		contentDescriptor: { kind: 'song', identifiers: { storeAdamID: songId(index) },
																							url: `https://music.apple.com/ee/album/synthetic/3000000000?i=${songId(index)}` },
		artistName: 'Example Group', subtitleLinks: [link('artist', '2000000000', 'Example Group')],
		tertiaryLinks: [link('album', '3000000000', 'Synthetic album')], artwork: { dictionary: { url: TEMPLATE } },
	}));
	const ld = { '@type': 'MusicPlaylist', name: title, url: APPLE_SOURCE_URL, numTracks: count,
														datePublished: '2026-10-16T07:00:00Z', track: rows.map((row, index) => ({
															'@type': 'MusicRecording', name: row.title, url: `https://music.apple.com/ee/song/synthetic/${songId(index)}`,
															audio: { name: row.title, thumbnailUrl: COVER },
														})) };
	const page = { intent: { $kind: 'PlaylistDetailPageIntent', contentDescriptor: {
		kind: 'playlist', identifiers: { storeAdamID: APPLE_PLAYLIST_ID }, locale: { storefront: 'ee' },
	} }, data: { canonicalURL: APPLE_SOURCE_URL, sections: [
		{ id: `playlist-detail-header-section - ${APPLE_PLAYLIST_ID}`, items: [{ title, trackCount: count }] },
		{ id: `track-list - ${APPLE_PLAYLIST_ID}`, itemKind: 'trackLockup', items: rows,
				containerContentDescriptor: { kind: 'playlist', identifiers: { storeAdamID: APPLE_PLAYLIST_ID }, url: APPLE_SOURCE_URL } },
	] } };
	options.mutate?.({ ld, rows, page });
	return `<html><head><title>Top 100: South Korea - Apple Music</title><link rel="canonical" href="${APPLE_SOURCE_URL}"></head>
    <body><h1 data-testid="non-editable-product-title">${title}</h1>
    <script id="schema:music-playlist" type="application/ld+json">${JSON.stringify(ld)}</script>
    <script id="serialized-server-data" type="application/json">${JSON.stringify({ data: [page], unrelatedEnvelopeField: 'not-used' })}</script>
    <script>throw new Error('Page scripts must never execute');</script></body></html>`;
}

const parse = (html = fixture()) => parseApple(html, fetchedAt);

test('Apple confirms all 100 positions against public JSON-LD and page data', () => {
	const result = parse();
	assert.equal(result.provider, 'apple');
	assert.equal(result.chartKey, 'top100-kr');
	assert.equal(result.sourceUrl, APPLE_SOURCE_URL);
	assert.equal(result.expectedCount, 100);
	assert.equal(result.entries.length, 100);
	assert.deepEqual(result.entries.map(entry => entry.rank), Array.from({ length: 100 }, (_, i) => i + 1));
	for (const index of [0, 49, 99]) {
		assert.equal(result.entries[index].songId, songId(index));
		assert.equal(result.entries[index].title, `Synthetic song ${index + 1}`);
		assert.deepEqual(result.entries[index].artists, [{ id: '2000000000', name: 'Example Group' }]);
		assert.equal(result.entries[index].album, 'Synthetic album');
		assert.equal(result.entries[index].albumId, '3000000000');
		assert.equal(result.entries[index].albumCoverUrl, COVER);
	}
});

test('Apple rejects incomplete lists even when other count metadata says 100', () => {
	assert.throws(() => parse(fixture({ count: 99 })), /exactly 100/);
	assert.throws(() => parse(fixture({ count: 101 })), /exactly 100/);
	assert.throws(() => parse(fixture({ mutate: ({ rows }) => { rows.pop(); } })), /exactly 100 songs/);
	assert.throws(() => parse(fixture({ mutate: ({ ld }) => { ld.track.pop(); } })), /exactly 100/);
	assert.throws(() => parse(fixture({ mutate: ({ page }) => { page.data.sections[0].items[0].trackCount = 30; } })), /confirm 100/);
});

test('Apple rejects reordered JSON-LD, conflicting numeric positions and repeated IDs', () => {
	assert.throws(() => parse(fixture({ mutate: ({ ld }) => { ld.track.reverse(); } })), /order disagree/);
	assert.throws(() => parse(fixture({ mutate: ({ rows }) => { rows[0].rankingText = '2'; } })), /position disagrees/);
	assert.throws(() => parse(fixture().replaceAll(songId(1), songId(0))), /duplicate song identity/);
	assert.throws(() => parse(fixture({ mutate: ({ rows }) => { rows[0].title = 'Different title'; } })), /title mismatch/);
	assert.throws(() => parse(fixture({ mutate: ({ rows }) => { rows[0].contentDescriptor.identifiers.storeAdamID = '999'; } })), /link and identifier disagree/);
});

test('Apple preserves multiple explicit artist credits and rejects missing or conflicting credits', () => {
	const multiple = fixture({ mutate: ({ rows }) => {
		rows[0].subtitleLinks = [link('artist', '2000000000', 'A2O'), link('artist', '2000000001', 'A2O LITE')];
		rows[0].artistName = 'A2O & A2O LITE';
		rows[1].subtitleLinks = [link('artist', '2000000000', 'Artist A'), link('artist', '2000000001', 'Artist B'), link('artist', '2000000002', 'Artist C')];
		rows[1].artistName = 'Artist A, Artist B & Artist C';
	} });
	assert.deepEqual(parse(multiple).entries[0].artists.map(artist => artist.name), ['A2O', 'A2O LITE']);
	assert.equal(parse(multiple).entries[1].artists.length, 3);
	assert.throws(() => parse(fixture({ mutate: ({ rows }) => { rows[0].subtitleLinks = []; } })), /missing artist credits/);
	assert.throws(() => parse(fixture({ mutate: ({ rows }) => { rows[0].artistName = 'Unlinked artist'; } })), /artist display/);
	assert.throws(() => parse(fixture({ mutate: ({ rows }) => { rows[0].subtitleLinks.push(rows[0].subtitleLinks[0]); } })), /duplicate artist/);
});

test('Apple keeps missing albums null and rejects conflicting album links', () => {
	const result = parse(fixture({ mutate: ({ rows }) => { rows[0].tertiaryLinks = []; } }));
	assert.equal(result.entries[0].album, null);
	assert.equal(result.entries[0].albumId, null);
	assert.throws(() => parse(fixture({ mutate: ({ rows }) => { rows[0].tertiaryLinks[0].segue.destination.contentDescriptor.url = 'https://example.invalid/album'; } })), /album link/);
});

test('Apple uses exact public artwork URLs and cross-checks the corresponding asset', () => {
	for (const unsafe of ['http://is1-ssl.mzstatic.com/image/thumb/Music/fixture.jpg',
																							'https://is1-ssl.mzstatic.com.evil.example/image/thumb/a.jpg', 'https://user@is1-ssl.mzstatic.com/image/thumb/a.jpg',
																							'https://is1-ssl.mzstatic.com:8443/image/thumb/a.jpg', 'javascript:alert(1)']) {
		const result = parse(fixture({ mutate: ({ ld }) => { ld.track[0].audio.thumbnailUrl = unsafe; } }));
		assert.equal(result.entries[0].albumCoverUrl, null);
		assert.equal(result.entries[1].albumCoverUrl, COVER);
	}
	assert.equal(parse(fixture({ mutate: ({ ld }) => { delete ld.track[0].audio.thumbnailUrl; } })).entries[0].albumCoverUrl, null);
	assert.throws(() => parse(fixture({ mutate: ({ rows }) => { rows[0].artwork.dictionary.url = TEMPLATE.replace('fixture', 'other-asset'); } })), /artwork assets disagree/);
});

test('Apple rejects a different playlist/storefront, challenges and malformed data', () => {
	assert.throws(() => parse(fixture().replaceAll('South Korea', 'Japan')), /playlist title mismatch/);
	assert.throws(() => parse(fixture().replace(`href="${APPLE_SOURCE_URL}"`, 'href="https://music.apple.com/ee/playlist/other"')), /canonical playlist/);
	assert.throws(() => parse(fixture({ mutate: ({ page }) => { page.intent.contentDescriptor.locale.storefront = 'us'; } })), /matching playlist page/);
	assert.throws(() => parse(fixture({ mutate: ({ page }) => { page.data.sections[1].containerContentDescriptor.identifiers.storeAdamID = 'other'; } })), /different playlist/);
	assert.throws(() => parse('<title>Access denied</title>'), /access challenge/);
	assert.throws(() => parse(fixture().replace('<script id="schema:music-playlist"', '<script id="missing"')), /missing or ambiguous/);
	assert.throws(() => parse(fixture().replace(/(<script id="schema:music-playlist"[^>]*>)[^<]+/, '$1not JSON')), /malformed public JSON/);
});

test('Apple does not turn publication metadata into a chart timestamp or invent movement', () => {
	const first = parse();
	const second = parseApple(fixture().replace('<body>', '<body><!-- extra markup -->'), '2026-10-18T14:16:41Z');
	assert.equal(first.sourceUpdatedAt, null);
	assert.equal(first.chartDate, null);
	assert.deepEqual(first.entries[0].sourceMovement, { type: 'unknown', amount: null });
	assert.equal(first.contentHash, second.contentHash);
	assert.notEqual(first.rawHash, second.rawHash);
	assert.throws(() => parseApple(fixture(), '2026-10-17T14:16:41'), /explicit timezone/);
});
