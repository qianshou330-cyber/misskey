/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { assertKpopSnapshot, collectKpopChart, kpopContentHash } from '../../src/core/kpop-charts/parser.js';
import { KPOP_CHARTS, matchKpopGroups } from '../../src/core/kpop-charts/catalog.js';
import type { KpopChartKey } from '../../src/core/kpop-charts/types.js';

const observedAt = '2026-10-17T14:30:30.798Z';
describe('reviewed cropped/test fixtures through the complete injected collector', () => {
	for (const [key, filename, count] of [['genie-realtime', 'genie-pages.json', 200], ['flo', 'flo-chart.json', 100], ['tencent', 'tencent-preview.html', 10]] as const) {
		test(key, async () => {
			const fixture = await readFile(new URL(`./kpop-parser-fixtures/${filename}`, import.meta.url), 'utf8');
			const pages: string[] = key === 'genie-realtime' ? JSON.parse(fixture).pages : [fixture];
			let calls = 0;
			const snapshot = await collectKpopChart(key, async () => ({ body: pages[calls++], observedAt }));
			expect(calls).toBe(pages.length);
			expect(snapshot.entries).toHaveLength(count);
			expect(snapshot.entries[0].title).toBe('NEON');
			expect(snapshot.entries[0].groupIds).toEqual(['a2o-lite']);
			expect(snapshot.chartKey).toBe(key);
			expect(snapshot.coverage).toBe(KPOP_CHARTS[key].coverage);
		});
	}
	test('synthetic Melon complete hour preserves real period and target identity', async () => {
		const body = '<title>Melon TOP100</title><div class="calendar_prid"><span class="year">2026.10.17</span><span class="hour">23:00</span></div><table>' + Array.from({ length: 100 }, (_, i) => `<tr data-song-no="${i + 1}"><td class="rank">${i + 1}</td><td class="rank01"><a>${i ? `Synthetic ${i}` : 'NEON'}</a></td><td class="rank02"><a href="?artistId=${i ? '99' : '5217450'}">${i ? 'Synthetic Artist' : 'A2O LITE'}</a></td><td class="rank03"><a href="?albumId=1">Album</a></td></tr>`).join('') + '</table>';
		const snapshot = await collectKpopChart('melon-top100', async () => ({ body, observedAt }));
		expect(snapshot.entries).toHaveLength(100);
		expect(snapshot.sourcePeriod).toBe('2026-10-17T14:00:00.000Z');
		expect(snapshot.entries[0].groupIds).toEqual(['a2o-lite']);
	});
	test('shared A2O credit and substring lookalikes never match LITE', () => {
		expect(matchKpopGroups('melon', [{ id: '4531271', name: 'A2O' }])).toEqual([]);
		expect(matchKpopGroups('melon', [{ id: null, name: 'A2O LITE tribute' }])).toEqual([]);
	});
	test('a known exact name with an unconfirmed platform ID is diagnosed', () => {
		expect(() => matchKpopGroups('melon', [{ id: '999999', name: 'A2O LITE' }])).toThrowError(expect.objectContaining({ code: 'identity_unverified' }));
	});
	test('persistence validation tolerates JSON key ordering and ignores cover changes in the semantic hash', async () => {
		const body = await readFile(new URL('./kpop-parser-fixtures/flo-chart.json', import.meta.url), 'utf8');
		const snapshot = await collectKpopChart('flo', async () => ({ body, observedAt }));
		// JSONB can reorder every object independently; reordering only the root is enough to catch insertion-order hashing.
		const rootReordered = Object.fromEntries(Object.entries(snapshot).reverse());
		expect(() => assertKpopSnapshot(rootReordered)).not.toThrow();
		const changed = structuredClone(snapshot);
		changed.entries[0].albumCoverUrl = null;
		expect(kpopContentHash(changed)).toBe(snapshot.contentHash);
		expect(() => assertKpopSnapshot(changed)).not.toThrow();
		expect(() => assertKpopSnapshot({ ...snapshot, contentHash: '0'.repeat(64) })).toThrow();
		expect(() => assertKpopSnapshot({ ...snapshot, entries: snapshot.entries.slice(1) })).toThrow();
	});
	test('200 login title maps to a fixed challenge diagnostic', async () => {
		await expect(collectKpopChart('melon-top100', async () => ({ body: '<title>로그인 :: Melon</title>', observedAt }))).rejects.toMatchObject({ code: 'access_challenge' });
		await expect(collectKpopChart('unknown' as KpopChartKey, async () => { throw new Error('must not call'); })).rejects.toMatchObject({ code: 'invalid_payload' });
	});
});
