/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'vitest';
import { collectGenie, GENIE_URL, parseGenie } from '../../src/core/kpop-charts/parser-genie.js';

const fetchedAt = '2026-10-17T14:30:00.000Z';
const fixture = JSON.parse(await readFile(new URL('./kpop-parser-fixtures/genie-pages.json', import.meta.url), 'utf8')) as { pages: string[] };
const evidence = () => structuredClone(fixture);

test('Genie parses all 200 observed rows with official date, source credits, covers and movements', () => {
	const result = parseGenie(JSON.stringify(fixture), fetchedAt);
	assert.equal(result.provider, 'genie');
	assert.equal(result.chartKey, 'TOP200');
	assert.equal(result.expectedCount, 200);
	assert.equal(result.entries.length, 200);
	assert.equal(result.sourceUpdatedAt, '2026-10-17T14:00:00.000Z');
	assert.equal(result.chartDate, '2026-10-17');
	assert.equal(result.entries[0].songId, '117256249');
	assert.equal(result.entries[0].title, 'NEON');
	assert.equal(result.entries[0].artists[0].name, 'A2O & A2O LITE');
	assert.equal(result.entries[0].albumId, '88270548');
	assert.match(result.entries[0].albumCoverUrl!, /^https:\/\/image\.genie\.co\.kr\//u);
	assert.deepEqual(result.entries[0].sourceMovement, { type: 'same', amount: 0 });
	assert.deepEqual(result.entries[3].sourceMovement, { type: 'up', amount: 3 });
	assert.equal(result.entries[199].songId, '84201067');
	assert.equal(result.entries[199].title, '뱅뱅뱅 (BANG BANG BANG)');
	assert.deepEqual(result.entries[199].sourceMovement, { type: 'down', amount: 49 });
	assert.match(result.rawHash, /^[0-9a-f]{64}$/u);
	assert.equal(parseGenie(JSON.stringify(fixture), '2026-10-17T15:00:00Z').contentHash, result.contentHash);
});

test('Genie rejects a preview, duplicated pages, missing rows and a changed complete song list', () => {
	assert.throws(() => parseGenie(fixture.pages[0], fetchedAt), /four-page/u);
	assert.throws(() => parseGenie(JSON.stringify({ pages: fixture.pages.slice(0, 3) }), fetchedAt), /Four public HTML pages/u);
	const duplicated = evidence(); duplicated.pages[3] = duplicated.pages[2];
	assert.throws(() => parseGenie(JSON.stringify(duplicated), fetchedAt), /duplicated\/out of order/u);
	const partial = evidence(); partial.pages[0] = partial.pages[0].replace(/<tr class="list"[\s\S]*?<\/tr>/u, '');
	assert.throws(() => parseGenie(JSON.stringify(partial), fetchedAt), /exactly 50/u);
	const changed = evidence(); changed.pages[1] = changed.pages[1].replace('117256249;', '999999999;');
	assert.throws(() => parseGenie(JSON.stringify(changed), fetchedAt), /different periods/u);
});

test('Genie rejects mixed periods and does not invent dates from capture time', () => {
	const missing = evidence(); missing.pages[0] = missing.pages[0].replace('name="strHH"', 'name="missingHour"');
	assert.throws(() => parseGenie(JSON.stringify(missing), fetchedAt), /date\/hour/u);
	const mixed = evidence(); mixed.pages[2] = mixed.pages[2].replaceAll('20261017', '20261018').replaceAll('2026.10.17', '2026.10.18').replace('name="strDD" value="17"', 'name="strDD" value="18"');
	assert.throws(() => parseGenie(JSON.stringify(mixed), fetchedAt), /different periods|Inconsistent/u);
	assert.throws(() => parseGenie(JSON.stringify(fixture), '2026-10-17T13:00:00Z'), /future/u);
});

test('Genie unsafe cover URLs are omitted without altering chart facts', () => {
	const value = evidence();
	value.pages[0] = value.pages[0].replace('//image.genie.co.kr/', '//untrusted.example/');
	const result = parseGenie(JSON.stringify(value), fetchedAt);
	assert.equal(result.entries[0].albumCoverUrl, null);
	assert.equal(result.entries[0].rank, 1);
	assert.equal(result.entries.length, 200);
});

test('Genie collector follows only the source-published four-page period links in order', async () => {
	const requested: string[] = [];
	const response = await collectGenie(async url => {
		requested.push(url);
		return { body: fixture.pages[requested.length - 1], fetchedAt };
	});
	assert.deepEqual(requested, [GENIE_URL, ...[2, 3, 4].map(page => `${GENIE_URL}?ditc=D&ymd=20261017&hh=23&rtm=Y&pg=${page}`)]);
	assert.equal(response.snapshot.entries.length, 200);
	assert.deepEqual(JSON.parse(response.raw), fixture);
	const malicious = fixture.pages[0].replace('?ditc=D&amp;ymd=20261017&amp;hh=23&amp;rtm=Y&amp;pg=2', 'https://untrusted.example/?ditc=D&amp;ymd=20261017&amp;hh=23&amp;rtm=Y&amp;pg=2');
	let calls = 0;
	await assert.rejects(collectGenie(async () => { calls++; return { body: malicious, fetchedAt }; }), /Unexpected source pagination/u);
	assert.equal(calls, 1);
});
