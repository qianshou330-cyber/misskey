/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'vitest';
import { parseFlo } from '../../src/core/kpop-charts/parser-flo.js';

const raw = await readFile(new URL('./kpop-parser-fixtures/flo-chart.json', import.meta.url), 'utf8');
const fixture = JSON.parse(raw);
const fetchedAt = '2026-10-17T14:30:30.798Z';
const modified = (change: (value: any) => void) => {
	const value = structuredClone(fixture); change(value); return JSON.stringify(value);
};

test('FLO preserves the complete official order and all artist credits', () => {
	const result = parseFlo(raw, fetchedAt);
	assert.equal(result.provider, 'flo');
	assert.equal(result.chartKey, 'chart');
	assert.equal(result.coverage, 'complete');
	assert.equal(result.expectedCount, 100);
	assert.equal(result.sourceTotal, 100);
	assert.equal(result.entries.length, 100);
	assert.deepEqual(result.entries.map(entry => entry.rank), Array.from({ length: 100 }, (_, index) => index + 1));
	assert.equal(result.entries[0].songId, '611656860');
	assert.equal(result.entries[0].title, 'NEON');
	assert.deepEqual(result.entries[0].artists, [{ id: '412835661', name: 'A2O' }, { id: '414956759', name: 'A2O LITE' }]);
	assert.equal(result.entries[0].albumId, '464803660');
	assert.equal(result.entries[49].songId, '576104327');
	assert.equal(result.entries[49].title, 'RUDE!');
	assert.equal(result.entries[99].songId, '607023302');
	assert.equal(result.entries[99].title, '이 별로부터');
	assert.equal(result.entries[0].albumCoverUrl, fixture.data.trackList[0].album.imgList.find((image: any) => image.size === 140).url);
});

test('FLO rankBadge direction matches the official rendered rise/fall labels', () => {
	const result = parseFlo(raw, fetchedAt);
	assert.equal(result.entries[6].title, 'Rewind');
	assert.deepEqual(result.entries[6].sourceMovement, { type: 'up', amount: 1 });
	assert.equal(result.entries[8].title, 'LOVE ATTACK');
	assert.deepEqual(result.entries[8].sourceMovement, { type: 'down', amount: 2 });
	assert.deepEqual(result.entries[0].sourceMovement, { type: 'same', amount: 0 });
	const newEntry = parseFlo(modified(value => { value.data.trackList[0].rank = { newYn: 'Y', rankBadge: 0 }; }), fetchedAt);
	assert.deepEqual(newEntry.entries[0].sourceMovement, { type: 'new', amount: null });
	const unknown = parseFlo(modified(value => { value.data.trackList[0].rank = { newYn: 'N', rankBadge: 'unknown' }; }), fetchedAt);
	assert.deepEqual(unknown.entries[0].sourceMovement, { type: 'unknown', amount: null });
});

test('FLO rejects errors, wrong charts, partial lists and duplicate tracks', () => {
	assert.throws(() => parseFlo('<html>Application shell</html>', fetchedAt), /public chart JSON/u);
	assert.throws(() => parseFlo(modified(value => { value.code = '4010000'; }), fetchedAt), /complete 100-song/u);
	assert.throws(() => parseFlo(modified(value => { value.data.id = 2; }), fetchedAt), /complete 100-song/u);
	assert.throws(() => parseFlo(modified(value => { value.data.totalCount = 99; }), fetchedAt), /complete 100-song/u);
	assert.throws(() => parseFlo(modified(value => { value.data.trackList.pop(); }), fetchedAt), /complete 100-song/u);
	assert.throws(() => parseFlo(modified(value => { value.data.trackList[1].id = value.data.trackList[0].id; }), fetchedAt), /duplicate song/u);
	assert.throws(() => parseFlo(modified(value => { value.data.trackList[0].artistList = []; }), fetchedAt), /song metadata/u);
});

test('FLO never substitutes track metadata or the capture date for a chart date', () => {
	const result = parseFlo(raw, fetchedAt);
	assert.equal(result.chartDate, null);
	assert.equal(result.sourceUpdatedAt, null);
	const changed = parseFlo(modified(value => {
		value.data.trackList[0].updateDateTime = '2030-01-01 12:00:00';
		value.data.trackList[0].album.releaseYmd = '20300101';
	}), '2026-10-18T14:30:30.798Z');
	assert.equal(changed.chartDate, null);
	assert.equal(changed.sourceUpdatedAt, null);
	assert.equal(changed.contentHash, result.contentHash);
	assert.notEqual(changed.rawHash, result.rawHash);
});

test('FLO uses only a source-provided safe image URL and falls back without inventing paths', () => {
	const fallback = parseFlo(modified(value => {
		value.data.trackList[0].album.imgList[1].url = 'https://untrusted.example/cover.jpg';
	}), fetchedAt);
	assert.equal(fallback.entries[0].albumCoverUrl, fixture.data.trackList[0].album.imgList[0].url);
	const missing = parseFlo(modified(value => {
		value.data.trackList[0].album.imgList = [{ size: 140, url: 'javascript:alert(1)' }, { size: 75, url: 'https://cdn.music-flo.com@untrusted.example/cover.jpg' }];
	}), fetchedAt);
	assert.equal(missing.entries[0].albumCoverUrl, null);
	assert.equal(missing.entries[0].rank, 1);
});
