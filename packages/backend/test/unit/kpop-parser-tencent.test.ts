/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'vitest';
import { parseTencent } from '../../src/core/kpop-charts/parser-tencent.js';

const fixture = await readFile(new URL('./kpop-parser-fixtures/tencent-preview.html', import.meta.url), 'utf8');
const fetchedAt = '2026-10-17T14:16:55.485Z';

function changeData(change: (props: any) => void): string {
	return fixture.replace(/(<script id="__NEXT_DATA__" type="application\/json">)([\s\S]*?)(<\/script>)/u,
		(_whole, start, json, end) => {
			const value = JSON.parse(json); change(value.props.pageProps);
			return `${start}${JSON.stringify(value)}${end}`;
		});
}

test('Tencent preserves the ten visible official ranks as an explicitly partial preview', () => {
	const result = parseTencent(fixture, fetchedAt);
	assert.equal(result.provider, 'tencent');
	assert.equal(result.chartKey, 'korean');
	assert.equal(result.coverage, 'preview');
	assert.equal(result.expectedCount, 10);
	assert.equal(result.sourceTotal, null);
	assert.equal(result.entries.length, 10);
	assert.equal(result.chartDate, '2026-10-17');
	assert.equal(result.sourceUpdatedAt, null);
	assert.deepEqual(result.entries.map(entry => entry.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
	assert.equal(result.entries[0].songId, '558014624');
	assert.equal(result.entries[0].title, 'NEON');
	assert.deepEqual(result.entries[0].artists, [{ id: '24243234', name: 'A2O LITE' }, { id: '17088922', name: 'A2O' }]);
	assert.equal(result.entries[0].album, 'NEON');
	assert.equal(result.entries[0].albumId, '001BLmVC0kTjAd');
	assert.equal(result.entries[4].title, 'TAKE ME');
	assert.equal(result.entries[9].title, 'Moonride');
	assert.equal(result.entries[9].artists[0].name, 'Hearts2Hearts');
	assert.match(result.entries[0].albumCoverUrl!, /^https:\/\/y\.gtimg\.cn\//u);
	assert.equal(parseTencent(fixture, '2026-10-18T12:00:00Z').contentHash, result.contentHash);
});

test('Tencent never substitutes a score change or last-week rank for current rank movement', () => {
	const body = changeData(props => {
		props.data[0].incrScore = '99.99';
		props.data[0].extend = { lastWeekRank: 80, newFlag: true };
	});
	assert.deepEqual(parseTencent(body, fetchedAt).entries[0].sourceMovement, { type: 'same', amount: 0 });
	assert.throws(() => parseTencent(changeData(props => { props.data[0].incrRank = 2; }), fetchedAt), /movement fields disagree/u);
	const unknown = changeData(props => { props.data[0].preRank = 0; props.data[0].incrRank = null; props.data[0].firstOnChart = 1; });
	assert.deepEqual(parseTencent(unknown, fetchedAt).entries[0].sourceMovement, { type: 'unknown', amount: null });
});

test('Tencent refuses missing rows, extra rows, duplicate songs and mixed issues', () => {
	assert.throws(() => parseTencent(changeData(props => { props.data.pop(); }), fetchedAt), /ten-song/u);
	assert.throws(() => parseTencent(changeData(props => { props.data.push(props.data[0]); }), fetchedAt), /ten-song/u);
	assert.throws(() => parseTencent(fixture.replace('songItem_songContainer__fixture', 'missingContainer'), fetchedAt), /same ten/u);
	assert.throws(() => parseTencent(changeData(props => { props.data[1].itemId = props.data[0].itemId; }), fetchedAt), /Invalid song ID/u);
	assert.throws(() => parseTencent(changeData(props => { props.data[1].issue = '202640'; }), fetchedAt), /mixed chart issue/u);
});

test('Tencent cross-checks rendered titles, ranks and covers against embedded data', () => {
	assert.throws(() => parseTencent(fixture.replace('>NEON<', '>Different song<'), fetchedAt), /rank\/title disagree/u);
	assert.throws(() => parseTencent(changeData(props => { props.data[0].rank = 2; }), fetchedAt), /Invalid song ID, rank/u);
	assert.throws(() => parseTencent(fixture.replace('https://y.gtimg.cn/', 'https://untrusted.example/'), fetchedAt), /cover disagrees/u);
	assert.throws(() => parseTencent(changeData(props => { props.data[0].info.singerId = '24243234'; }), fetchedAt), /artist credits/u);
});

test('Tencent confirms only the source date and does not fabricate a timezone or missing date', () => {
	const missing = changeData(props => { delete props.chartIssueVo.updateTime; delete props.SSG_UPDATETIME; });
	const result = parseTencent(missing, fetchedAt);
	assert.equal(result.chartDate, null);
	assert.equal(result.sourceUpdatedAt, null);
	assert.throws(() => parseTencent(changeData(props => { props.SSG_UPDATETIME = '2026-10-17 21:00'; }), fetchedAt), /update text/u);
	assert.throws(() => parseTencent(changeData(props => {
		props.chartIssueVo.updateTime = '2026-02-31 22:00'; props.SSG_UPDATETIME = '2026-02-31 22:00';
	}), fetchedAt), /calendar date/u);
});

test('Tencent invalid artwork is omitted when both source representations agree', () => {
	const unsafe = 'https://untrusted.example/cover.jpg';
	const body = changeData(props => { props.data[0].info.coverImages = unsafe; })
		.replace('https://y.gtimg.cn/music/photo_new/T002R180x180M000001BLmVC0kTjAd_2.jpg', unsafe);
	const result = parseTencent(body, fetchedAt);
	assert.equal(result.entries[0].albumCoverUrl, null);
	assert.equal(result.entries[0].title, 'NEON');
});
