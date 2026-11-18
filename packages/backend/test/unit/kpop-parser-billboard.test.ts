/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { parse } from 'node-html-parser';
import { describe, expect, it } from 'vitest';
import { parseBillboard, BILLBOARD_SOURCE_URL, BILLBOARD_CHART_KEY } from '../../src/core/kpop-charts/parser-billboard.js';
import { assertKpopSnapshot, collectKpopChart, kpopContentHash } from '../../src/core/kpop-charts/parser.js';
import { KPOP_CHARTS, matchKpopGroups } from '../../src/core/kpop-charts/catalog.js';
import { KPOP_SCHEDULE_VERSION, KPOP_SLOTS, kpopSchedule, enabledKpopKeys } from '../../src/core/kpop-charts/schedule.js';
import { kpopSnapshotCoordinate, snapshotDecision, failureStatus } from '../../src/core/kpop-charts/state.js';
import { kpopChartSchema } from '../../src/models/json-schema/kpop-charts.js';
import type { MiKpopChartSnapshot } from '../../src/models/KpopChartSnapshot.js';
import type { KpopSnapshot } from '../../src/core/kpop-charts/types.js';

const body = readFileSync(new URL('./kpop-parser-fixtures/billboard-global-k-songs-20261031.html', import.meta.url), 'utf8');
const observedAt = '2026-10-28T08:24:23.000Z';
const collect = (page = body, time = observedAt) => collectKpopChart(BILLBOARD_CHART_KEY, async () => ({ body: page, observedAt: time }));

function replaceField(selector: string, value: string) {
	const root = parse(body);
	root.querySelector(selector)!.set_content(value);
	return root.toString();
}

function stored(snapshot: KpopSnapshot): MiKpopChartSnapshot {
	return { ...snapshot, observedAt: new Date(snapshot.observedAt), sourceUpdatedAt: null } as unknown as MiKpopChartSnapshot;
}

describe('official Billboard Korea public weekly chart', () => {
	it('validates the real 100-row fixture and retains the weekly label without inventing a timestamp', async () => {
		const result = await collect();
		expect(result).toMatchObject({ chartKey: BILLBOARD_CHART_KEY, source: 'billboard', sourceUrl: BILLBOARD_SOURCE_URL,
			sourceDate: '2026-10-31', sourcePeriod: null, sourceUpdatedAt: null, observedAt, coverage: 'complete', sourceTotal: 100, expectedCount: 100, rankBasis: 'official_rank' });
		expect(result.entries).toHaveLength(100);
		expect(result.entries[0]).toMatchObject({ rank: 1, title: 'NEON', artists: [{ id: null, name: 'A2O(에이투오)' }, { id: null, name: 'A2O LITE(에이투오 라이트)' }],
			groupIds: ['a2o-lite'], sourceMovement: { type: 'up', amount: 10 }, album: null, albumId: null });
		expect(result.entries[0].albumCoverUrl).toBe('https://contents.billboard.co.kr/media/album/NEON/NEON_billboard_tweH7dw.jpg');
		expect(result.entries[99].rank).toBe(100);
		expect(() => assertKpopSnapshot(result)).not.toThrow();
	});
	it('uses official LW for up/down/same, distinguishes a debut from a returning entry', () => {
		const entries = parseBillboard(body, observedAt).entries;
		expect(entries[1].sourceMovement).toEqual({ type: 'down', amount: 1 });
		expect(entries[63].sourceMovement).toEqual({ type: 'same', amount: 0 });
		expect(entries[90].sourceMovement).toEqual({ type: 'new', amount: null });
		expect(entries[98].sourceMovement).toEqual({ type: 'unknown', amount: null });
	});
	it('filters exact compound artist credits while preserving global ranks', async () => {
		const result = await collect();
		const selected = result.entries.filter(row => row.groupIds.length);
		expect(selected.length).toBeGreaterThan(10);
		expect(selected.find(row => row.title === 'Whiplash')).toMatchObject({ rank: 67, groupIds: ['aespa'] });
		expect(selected.find(row => row.title === 'Ditto')).toMatchObject({ rank: 83, groupIds: ['newjeans'] });
		expect(selected.find(row => row.title === 'ICONIC HEART')).toMatchObject({ rank: 93, groupIds: ['hearts2hearts'] });
		expect(result.entries.filter(row => row.artists.some(artist => /JENNIE|ROSÉ|A2O SOUL|정한X조슈아/.test(artist.name))).every(row => !row.groupIds.length)).toBe(true);
		for (const name of ['A2O', 'A2O SOUL(에이투오 소울)', 'A2O LITE tribute', 'WINTER (aespa)', '장원영 (IVE)', 'HANNI (NewJeans)', 'IVE & aespa']) {
			expect(matchKpopGroups('billboard', [{ id: null, name }])).toEqual([]);
		}
		expect(matchKpopGroups('melon', [{ id: null, name: 'A2O LITE(에이투오 라이트)' }])).toEqual([]);
	});
	it.each([
		['wrong title', 'h1.chart-title', 'BILLBOARD KOREA HOT 100'],
		['tied rank', '.chart-item:nth-child(2) .album-rank', '1'],
		['rank out of order', '.chart-item:nth-child(2) .album-rank', '3'],
		['missing title', '.chart-item:nth-child(1) .album-title', ''],
		['missing artist', '.chart-item:nth-child(1) .album-artist', ''],
		['ambiguous credit', '.chart-item:nth-child(1) .album-artist', '<span class="artist-link">A2O LITE</span> unstructured guest'],
		['duplicate credit', '.chart-item:nth-child(1) .album-artist', '<span class="artist-link">A2O LITE</span>, <span class="artist-link">A2O LITE</span>'],
		['invalid LW', '.chart-item:nth-child(1) .last-week-content', '101'],
		['invalid peak', '.chart-item:nth-child(1) .best-rank-content', '2'],
		['missing weeks', '.chart-item:nth-child(1) .weeks-in-chart-content', ''],
	] as const)('rejects %s instead of saving a partial chart', async (_name, selector, text) => {
		await expect(collect(replaceField(selector, text))).rejects.toMatchObject({ code: 'invalid_payload' });
	});
	it('rejects missing/duplicate issue labels, missing rows, duplicate songs and the wrong canonical chart', async () => {
		const variants = [body.replace('https://billboard.co.kr/charts/billboard-korea-global-k-songs/', 'https://billboard.co.kr/charts/billboard-korea-hot-100/')];
		const noDate = parse(body); noDate.querySelector('.week-date')!.remove(); variants.push(noDate.toString());
		variants.push(`${body}<p class="week-date">WEEK OF OCTOBER 31, 2026</p>`);
		const partial = parse(body); partial.querySelector('.chart-item')!.remove(); variants.push(partial.toString());
		const duplicate = parse(body), rows = duplicate.querySelectorAll('.chart-item');
		rows[1].querySelector('.album-title')!.set_content(rows[0].querySelector('.album-title')!.innerHTML);
		rows[1].querySelector('.album-artist')!.set_content(rows[0].querySelector('.album-artist')!.innerHTML);
		variants.push(duplicate.toString());
		for (const page of variants) await expect(collect(page)).rejects.toMatchObject({ code: 'invalid_payload' });
	});
	it.each(['WEEK OF FEBRUARY 29, 2026', 'WEEK OF NOVEMBER 31, 2026', 'WEEK OF NOVEMBER 5, 2026', 'WEEK OF OCTOBER 6, 2026', 'OCTOBER 31, 2026'])('rejects invalid or implausible issue %s', async value => {
		await expect(collect(replaceField('.week-date', value))).rejects.toMatchObject({ code: 'invalid_payload' });
	});
	it('allows a forward issue within seven days and refuses forged snapshot timing at persistence', async () => {
		const result = await collect(replaceField('.week-date', 'WEEK OF NOVEMBER 4, 2026'));
		expect(result.sourceDate).toBe('2026-11-04');
		for (const fields of [{ sourceDate: null }, { sourceDate: '2026-11-31' }, { sourceDate: '2026-11-05' }, { sourceUpdatedAt: observedAt, sourcePeriod: observedAt }]) {
			const changed = { ...result, ...fields }; changed.contentHash = kpopContentHash(changed);
			expect(() => assertKpopSnapshot(changed)).toThrow();
		}
	});
	it('keeps song identity independent of rank, issue and artwork', () => {
		const first = parseBillboard(body, observedAt).entries[0];
		const moved = parse(body), rows = moved.querySelectorAll('.chart-item');
		const firstHtml = rows[0].innerHTML, secondHtml = rows[1].innerHTML;
		rows[0].set_content(secondHtml); rows[1].set_content(firstHtml);
		rows[0].querySelector('.album-rank')!.set_content('1'); rows[1].querySelector('.album-rank')!.set_content('2');
		rows[1].querySelector('img.album-cover')!.setAttribute('src', 'https://contents.billboard.co.kr/media/album/NEON/other.jpg');
		moved.querySelector('.week-date')!.set_content('WEEK OF NOVEMBER 1, 2026');
		expect(parseBillboard(moved.toString(), observedAt).entries[1].songId).toBe(first.songId);
	});
	it.each(['https://attacker.example/cover.jpg', 'http://contents.billboard.co.kr/media/album/a.jpg', 'https://user@contents.billboard.co.kr/media/album/a.jpg', 'https://contents.billboard.co.kr/api/a.jpg'])('omits an unverified optional cover %s', value => {
		const root = parse(body); root.querySelector('img.album-cover')!.setAttribute('src', value);
		expect(parseBillboard(root.toString(), observedAt).entries[0].albumCoverUrl).toBeNull();
	});
	it('deduplicates repeated weekly samples and uses observation history; old issue cannot overwrite new', async () => {
		const first = await collect(), previous = stored(first);
		const next = await collect(body, '2026-10-28T09:24:23.000Z');
		expect(next.contentHash).toBe(first.contentHash);
		expect(snapshotDecision(previous, next)).toBe('duplicate');
		expect(kpopSnapshotCoordinate(previous)).toBe(Date.parse(observedAt));
		const old = await collect(replaceField('.week-date', 'WEEK OF OCTOBER 24, 2026'), '2026-10-28T09:24:23.000Z');
		expect(snapshotDecision(previous, old)).toBe('old');
		const changed = await collect(replaceField('.chart-item:nth-child(1) .album-title', 'NEON (Revised)'), '2026-10-28T09:24:23.000Z');
		expect(snapshotDecision(previous, changed)).toBe('new');
		const nextWeek = await collect(replaceField('.week-date', 'WEEK OF NOVEMBER 7, 2026'), '2026-11-04T09:24:23.000Z');
		expect(snapshotDecision(previous, nextWeek)).toBe('new');
	});
});

describe('append-only Billboard chart integration', () => {
	it('keeps all original ten schedules/version and adds only minute 25', () => {
		expect(KPOP_SCHEDULE_VERSION).toBe(1);
		expect(KPOP_SLOTS).toEqual({ 'melon-daily': 5, 'melon-hot100': 7, 'melon-top100': 9, 'melon-hot100-d30': 11,
			'genie-realtime': 13, 'bugs-realtime': 15, flo: 17, apple: 19, spotify: 21, tencent: 23, [BILLBOARD_CHART_KEY]: 25 });
		expect(kpopSchedule(BILLBOARD_CHART_KEY)).toEqual({ pattern: '0 25 * * * *', tz: 'UTC' });
		expect(enabledKpopKeys('melon-daily')).toEqual(['melon-daily']);
		expect(KPOP_CHARTS[BILLBOARD_CHART_KEY].periodMinutes).toBe(10080);
	});
	it('exposes the added chart/source/restriction through existing API schemas', () => {
		expect(kpopChartSchema.properties.chartKey.enum).toContain(BILLBOARD_CHART_KEY);
		expect(kpopChartSchema.properties.provider.enum).toContain('billboard');
		expect(kpopChartSchema.properties.diagnostic.properties.reason.enum).toContain('robots_denied');
		expect(failureStatus({ phase: 'robots', reason: 'robots_denied', elapsedMs: 0, httpStatus: 200, retryAfterAt: null })).toBe('restricted');
	});
});
