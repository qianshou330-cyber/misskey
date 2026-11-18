/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'vitest';
import { parseChart, ParseValidationError } from '../../src/core/kpop-charts/parser-melon.js';
import { normalizeAlbumCoverUrl } from '../../src/core/kpop-charts/parser-cover.js';
import { TARGETS, type ChartTarget } from '../../src/core/kpop-charts/parser-types.js';

const FETCHED_AT = '2026-10-17T14:01:00Z';
const daily = TARGETS.find(t => t.chartType === 'DAILY')!;
const top = TARGETS.find(t => t.chartType === 'TOP100')!;
const hot = TARGETS.find(t => t.window === 'D100')!;

// Synthetic songs mirror the public DOM structure; no copyrighted chart is bundled.
function fixture(target: ChartTarget = top): string {
	const title = target.chartType === 'DAILY' ? '멜론차트>일간>장르종합>멜론' : `멜론차트>${target.chartType}>멜론`;
	const rows = Array.from({ length: 100 }, (_, index) => {
		const rank = index + 1;
		return `<tr data-song-no="${1000 + rank}"><td><span class="rank">${rank}</span></td>
      <td><span class="rank_wrap"><span class="rank_static"></span></span></td>
      <td><div class="rank01"><span><a href="#">Synthetic song ${rank}</a></span></div>
      <div class="rank02"><a href="/artist/detail.htm?artistId=2001">Example&nbsp; Group</a><a href="/artist/detail.htm?artistId=2001">Example Group</a>
      <span style="display:none"><a href="/artist/detail.htm?artistId=2001">Example Group</a></span></div></td>
      <td><div class="rank03"><a href="/album/detail.htm?albumId=3001">Synthetic album</a></div></td></tr>`;
	}).join('');
	return `<!doctype html><html><head><title>${title}</title></head><body>
    <div class="calendar_prid"><span class="year">2026.10.17</span><span class="hour">22:00</span></div>
    ${target.chartType === 'HOT100' ? `<ul><li data-chart-type="D30">30</li><li data-chart-type="D100">100</li></ul><script>var chartType = "${target.window}";</script>` : ''}
    <table><tbody>${rows}</tbody></table></body></html>`;
}

function parse(html = fixture(), target = top) { return parseChart(html, target, FETCHED_AT); }

test('parses all 100 entries with normalized and deduplicated artist metadata', () => {
	const result = parse();
	assert.equal(result.entries.length, 100);
	assert.deepEqual(result.entries[0], { songId: '1001', rank: 1, title: 'Synthetic song 1', artists: [{ id: '2001', name: 'Example Group' }], album: 'Synthetic album', albumId: '3001', sourceMovement: { type: 'same', amount: 0 }, albumCoverUrl: null });
	assert.equal(result.chartDate, '2026-10-17');
	assert.equal(result.chartHour, 22);
	assert.equal(result.sourceTimestamp, '2026-10-17T22:00:00+09:00');
	assert.equal(result.window, null);
});
test('daily timestamp has date granularity and no fabricated hour', () => {
	const result = parse(fixture(daily).replace('22:00', '장르종합'), daily);
	assert.equal(result.chartHour, null);
	assert.equal(result.sourceTimestamp, '2026-10-17T00:00:00+09:00');
});
test('HOT100 uses source-confirmed active window, never the available tabs alone', () => {
	assert.equal(parse(fixture(hot), hot).window, 'D100');
	assert.equal(parse(fixture(hot), { ...hot, window: null }).window, 'D100');
	assert.throws(() => parse(fixture(hot).replace('var chartType = "D100";', ''), hot), /absent or ambiguous/);
	assert.throws(() => parse(fixture(hot), { ...hot, window: 'D30' }), /differs from requested/);
	assert.throws(() => parse(fixture(hot).replace('var chartType = "D100";', 'var chartType = "D7";'), hot), /unsupported/);
	assert.throws(() => parse(fixture(hot).replace('var chartType = "D100";', 'var chartType = "D100";\nvar chartType = "D30";'), hot), /ambiguous/);
});
test('rejects partial charts, duplicate song IDs, missing IDs and duplicate ranks', () => {
	assert.throws(() => parse(fixture().replace(/<tr data-song-no="1100">[\s\S]*?<\/tr>/, '')), /received 99/);
	assert.throws(() => parse(fixture().replace('data-song-no="1100"', 'data-song-no="1001"')), /Duplicate song ID/);
	assert.throws(() => parse(fixture().replace('data-song-no="1100"', 'data-song-no=""')), /song ID/);
	assert.throws(() => parse(fixture().replace('<span class="rank">100</span>', '<span class="rank">1</span>')), /Duplicate chart rank/);
	assert.throws(() => parse(fixture().replace('<span class="rank">100</span>', '<span class="rank">101</span>')), /Invalid rank/);
});
test('rejects missing metadata and mismatched page type', () => {
	assert.throws(() => parse(fixture().replace('Synthetic song 1</a>', '</a>')), /Missing title or album/);
	assert.throws(() => parse(fixture().replaceAll('class="rank02"', 'class="other"')), /Missing artists/);
	assert.throws(() => parse(fixture(daily)), /Page title/);
	assert.throws(() => parse('<title>Access denied</title>'), /must stop/);
	assert.throws(() => parse('<title>로그인 | 멜론</title>'), ParseValidationError);
});
test('rejects impossible dates, invalid hours, future source timestamps and missing fetch timezone', () => {
	for (const invalid of ['2026.02.30', '2026.13.01', '2026.10.00', 'unknown']) assert.throws(() => parse(fixture().replace('2026.10.17', invalid)), /date/);
	for (const invalid of ['24:00', '22:30', 'unknown']) assert.throws(() => parse(fixture().replace('22:00', invalid)), /chart time/);
	assert.throws(() => parse(fixture().replace('2026.10.17', '2026.10.18')), /future/);
	assert.throws(() => parseChart(fixture(), top, '2026-10-17T14:01:00'), /explicit timezone/);
	assert.doesNotThrow(() => parse(fixture().replace('2026.10.17', '2024.02.29')));
});
test('content hash is stable across fetches and irrelevant markup, raw hash preserves differences', () => {
	const first = parse();
	const second = parseChart(fixture().replace('<body>', '<body><!-- harmless markup -->'), top, '2026-10-17T15:01:00Z');
	assert.equal(first.contentHash, second.contentHash);
	assert.notEqual(first.rawHtmlHash, second.rawHtmlHash);
	assert.notEqual(first.contentHash, parse(fixture().replace('Synthetic song 1</a>', 'Changed song</a>')).contentHash);
});
test('preserves official up/down/new/unknown source movement separately', () => {
	for (const type of ['up', 'down'] as const) {
		const result = parse(fixture().replace('<span class="rank_static"></span>', `<span class="rank_${type}"></span><span class="${type}">3</span>`));
		assert.deepEqual(result.entries[0].sourceMovement, { type, amount: 3 });
	}
	assert.deepEqual(parse(fixture().replace('class="rank_static"', 'class="rank_new"')).entries[0].sourceMovement, { type: 'new', amount: null });
	assert.deepEqual(parse(fixture().replace('class="rank_static"', 'class="nothing"')).entries[0].sourceMovement, { type: 'unknown', amount: null });
	assert.throws(() => parse(fixture().replace('<span class="rank_static"></span>', '<span class="rank_up"></span><span class="up">x</span>')), /Invalid source movement/);
});

const COVER = 'https://cdnimg.melon.co.kr/cm2/album/images/300/01/001/30001001_20261012141441_500.jpg/melon/resize/120/quality/80/optimize';

function coverRow(html: string, songId: number, src: string): string {
	return html.replace(`<tr data-song-no="${songId}">`, `<tr data-song-no="${songId}"><td><a class="image_typeAll" href="/album/detail.htm?albumId=3001"><img src="${src}" onerror="throw new Error('never execute')"></a></td>`);
}

test('album covers stay with their song rows and retain the exact source thumbnail URL', () => {
	const secondCover = COVER.replace('30001001_', '30001002_');
	const html = coverRow(coverRow(fixture(), 1001, COVER), 1002, secondCover)
		.replace('<body>', '<body><img src="https://cdnimg.melon.co.kr/resource/image/web/common/logo.png">')
		.replace('<span class="rank">3</span>', `<img src="${COVER}"><span class="rank">3</span>`);
	const result = parse(html);
	assert.equal(result.entries[0].albumCoverUrl, COVER);
	assert.equal(result.entries[1].albumCoverUrl, secondCover);
	assert.equal(result.entries[2].albumCoverUrl, null);
	assert.equal(result.entries[99].albumCoverUrl, null);
	assert.equal(result.entries.length, 100);
});

test('missing or unsafe cover URLs do not discard otherwise valid ranking snapshots', () => {
	const invalid: unknown[] = [undefined, null, 42, '', '/cover.jpg', '//evil.example/cover.jpg',
																													'http://cdnimg.melon.co.kr/cover.jpg', 'javascript:alert(1)', 'data:image/png;base64,aGVsbG8=',
																													'https://example.com/cover.jpg', 'https://cdnimg.melon.co.kr.example.com/cover.jpg',
																													'https://cdnimg.melon.co.kr@evil.example/cover.jpg', 'https://user:password@cdnimg.melon.co.kr/cover.jpg',
																													'https://cdnimg.melon.co.kr:8443/cover.jpg', 'https://cdnimg.melon.co.kr\\evil/cover.jpg',
																													'https://cdnimg.melon.co.kr/cover\n.jpg'];
	for (const value of invalid) {
		assert.equal(normalizeAlbumCoverUrl(value), null, String(value));
		if (typeof value === 'string') {
			const result = parse(coverRow(fixture(), 1001, value));
			assert.equal(result.entries.length, 100);
			assert.equal(result.entries[0].albumCoverUrl, null, value);
		}
	}
	assert.equal(normalizeAlbumCoverUrl(COVER), COVER);
	assert.equal(normalizeAlbumCoverUrl(COVER.replace('https:', '')), COVER);
});

test('artwork enrichment preserves the pre-artwork semantic hash while raw HTML hash remains exact', () => {
	const previous = parse();
	const previousSemantic = {
		chartType: previous.chartType, window: previous.window, chartDate: previous.chartDate,
		chartHour: previous.chartHour,
		entries: previous.entries.map(({ albumCoverUrl: _cover, ...entry }) => entry),
	};
	const legacyHash = createHash('sha256').update(JSON.stringify(previousSemantic)).digest('hex');
	const html = coverRow(fixture(), 1001, COVER);
	const enriched = parse(html);
	assert.equal(previous.contentHash, legacyHash);
	assert.equal(enriched.contentHash, legacyHash);
	assert.notEqual(enriched.rawHtmlHash, previous.rawHtmlHash);
	assert.equal(enriched.rawHtmlHash, createHash('sha256').update(html).digest('hex'));
	assert.equal(parse(coverRow(fixture(), 1001, COVER.replace('/120/', '/240/'))).contentHash, legacyHash);
});
