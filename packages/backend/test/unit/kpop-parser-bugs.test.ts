/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from 'node:assert/strict';
import { test } from 'vitest';
import { parseBugs, BUGS_SOURCE_URL } from '../../src/core/kpop-charts/parser-bugs.js';

const FETCHED_AT = '2026-10-17T14:17:43Z';
const COVER = 'https://image.bugsm.co.kr/album/images/50/999/99901.jpg?version=20261017123456';

function fixture(count = 100): string {
	const rows = Array.from({ length: count }, (_, index) => {
		const rank = index + 1;
		return `<tr trackId="${1000 + rank}" albumId="99901" multiArtist="N" rowType="track">
      <td><div class="ranking"><strong>${rank}</strong><p class="change none"><em>0</em></p></div></td>
      <td><a class="thumbnail"><img src="${COVER}"></a></td>
      <th><p class="title"><a>Synthetic song ${rank}</a></p></th>
      <td><p class="artist"><a href="https://music.bugs.co.kr/artist/2001?ref=chart">Example Group</a></p></td>
      <td><a class="album">Example album</a></td></tr>`;
	}).join('');
	return `<html><head><title>벅스차트 &gt; 곡 차트 &gt; 실시간 &gt; 전체 장르 - 벅스</title>
    <meta property="og:url" content="${BUGS_SOURCE_URL}"></head><body>
    <fieldset class="filterChart"><a class="selected" href="${BUGS_SOURCE_URL}">실시간</a>
    <time datetime="2026.10.17 23:00">2026.10.17 <em>23:00</em><a>시간대 선택</a></time></fieldset>
    <div id="CHARTrealtime"><table class="trackList byChart"><tbody>${rows}</tbody></table></div></body></html>`;
}

const parse = (body = fixture()) => parseBugs(body, FETCHED_AT);

test('Bugs parses a complete realtime top 100 with source metadata and covers', () => {
	const snapshot = parse();
	assert.equal(snapshot.provider, 'bugs');
	assert.equal(snapshot.chartKey, 'BUGS_REALTIME');
	assert.equal(snapshot.expectedCount, 100);
	assert.equal(snapshot.entries.length, 100);
	assert.equal(snapshot.sourceUpdatedAt, '2026-10-17T23:00:00+09:00');
	assert.equal(snapshot.chartDate, '2026-10-17');
	assert.deepEqual(snapshot.entries[0], { songId: '1001', rank: 1, title: 'Synthetic song 1',
																																									artists: [{ id: '2001', name: 'Example Group' }], album: 'Example album', albumId: '99901',
																																									albumCoverUrl: COVER, sourceMovement: { type: 'same', amount: 0 } });
});

test('Bugs does not claim an official update time when visible and datetime metadata disagree', () => {
	const conflicting = parse(fixture().replace('datetime="2026.10.17 23:00"', 'datetime="2026.10.17 22:00"'));
	assert.equal(conflicting.sourceUpdatedAt, null);
	assert.equal(conflicting.chartDate, '2026-10-17');
	assert.equal(parse(fixture().replace('datetime="2026.10.17 23:00"', 'datetime="2026.10.16 23:00"')).chartDate, null);
	assert.throws(() => parse(fixture().replaceAll('2026.10.17', '2026.02.30')), /invalid visible/);
	assert.throws(() => parse(fixture().replaceAll('2026.10.17', '2026.10.18')), /future/);
	assert.throws(() => parseBugs(fixture(), '2026-10-17T14:17:43'), /timezone/);
});

test('Bugs rejects homepage previews, incomplete charts, duplicate IDs/ranks and other chart types', () => {
	assert.throws(() => parse(fixture(10)), /received 10/);
	assert.throws(() => parse(fixture(99)), /received 99/);
	assert.throws(() => parse(fixture().replace('trackId="1100"', 'trackId="1001"')), /duplicate song/);
	assert.throws(() => parse(fixture().replace('<strong>100</strong>', '<strong>1</strong>')), /duplicate rank/);
	assert.throws(() => parse(fixture().replaceAll('/realtime/', '/day/')), /canonical source/);
	assert.throws(() => parse('<title>Access denied</title>'), /access challenge/);
});

test('Bugs reads all collaborator credits from the public literal without executing handlers', () => {
	const html = fixture().replace('multiArtist="N"', 'multiArtist="Y"')
		.replace('</p></td>', '<a name="atag_martist_list" onclick="bugs.layermenu.openMultiArtistSearchResultPopLayer(this, \'Example||Example Group||2001||OK\\\\nA2O LITE||A2O LITE||2002||OK\', \'\'); return false;">More</a></p></td>');
	assert.deepEqual(parse(html).entries[0].artists, [{ id: '2001', name: 'Example Group' }, { id: '2002', name: 'A2O LITE' }]);
	assert.throws(() => parse(html.replace('||2002||', '||oops||')), /malformed collaborator/);
	assert.throws(() => parse(fixture().replace('multiArtist="N"', 'multiArtist="Y"')), /missing collaborator/);
});

test('Bugs keeps official movement and rejects unsafe artwork without losing rankings', () => {
	assert.deepEqual(parse(fixture().replace('change none"><em>0', 'change up"><em>3')).entries[0].sourceMovement, { type: 'up', amount: 3 });
	assert.deepEqual(parse(fixture().replace('change none', 'change new')).entries[0].sourceMovement, { type: 'new', amount: null });
	assert.throws(() => parse(fixture().replace('change none', 'change up down')), /conflicting rank/);
	for (const url of ['javascript:alert(1)', 'https://image.bugsm.co.kr.evil.example/a.jpg', 'https://user@image.bugsm.co.kr/a.jpg']) {
		assert.equal(parse(fixture().replace(COVER, url)).entries[0].albumCoverUrl, null);
	}
	assert.equal(parse(fixture().replace(COVER, COVER.replace('https:', ''))).entries[0].albumCoverUrl, COVER);
});

test('Bugs snapshot hashes are stable across fetch times and unrelated markup', () => {
	const first = parse();
	const second = parseBugs(fixture().replace('<body>', '<body><!-- metadata -->'), '2026-10-17T15:17:43Z');
	assert.equal(first.contentHash, second.contentHash);
	assert.notEqual(first.rawHash, second.rawHash);
	assert.notEqual(first.contentHash, parse(fixture().replace('Synthetic song 1<', 'Updated song<')).contentHash);
});
