/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '@/config.js';
import { MusicChartService } from '@/core/MusicChartService.js';
import type { HttpRequestService } from '@/core/HttpRequestService.js';
import type { MusicChartReferenceService } from '@/core/MusicChartReferenceService.js';
import { MiMusicChartState } from '@/models/MusicChartState.js';
import { MiMusicChartSnapshot } from '@/models/MusicChartSnapshot.js';

// This suite is intentionally opt-in: initialize the existing chart schema in a disposable DB first.
describe.skipIf(process.env.PUBO_MUSIC_CHARTS_DB_TEST !== 'true')('Music chart persistence in an isolated database', () => {
	let db: DataSource;
	let service: MusicChartService;
	const send = vi.fn();
	const period = new Date(Math.floor(Date.now() / 3600000) * 3600000 - 3600000);
	const attempt = new Date(period.getTime() + 5 * 60000);
	const success = { snapshot: { period: period.toISOString(), rank: 9, eligible: true } };

	beforeAll(async () => {
		if (process.env.NODE_ENV !== 'test') throw new Error('Use an isolated test database');
		const config = loadConfig();
		db = new DataSource({ type: 'postgres', host: config.db.host, port: config.db.port, username: config.db.user, password: config.db.pass, database: config.db.db, entities: [MiMusicChartState, MiMusicChartSnapshot], synchronize: false, extra: { max: 3 } });
		await db.initialize();
	});

	beforeEach(async () => {
		await db.getRepository(MiMusicChartSnapshot).clear();
		await db.getRepository(MiMusicChartState).clear();
		send.mockReset();
		service = new MusicChartService(db, { send } as unknown as HttpRequestService, { readReferences: async () => ({}) } as unknown as MusicChartReferenceService);
	});

	afterAll(async () => { if (db?.isInitialized) await db.destroy(); });

	it('returns all five truthful placeholders with no external request', async () => {
		const summary = await service.summary();
		expect(summary.charts.map(chart => chart.key)).toEqual(['melon-daily', 'melon-hot100', 'melon-top100', 'genie-realtime', 'bugs-realtime']);
		expect(summary.charts.every(chart => chart.status === 'pending' && chart.rank === null)).toBe(true);
		expect(send).not.toHaveBeenCalled();
	});

	it('preserves retired MV rows without exposing or reusing them for Genie TOP200', async () => {
		await db.query('INSERT INTO music_chart_state ("chartKey", status, result, rank, "sourcePeriod") VALUES ($1, $2, $3, $4, $5)', ['genie-mv-daily', 'available', 'ranked', 9, period]);
		await db.query('INSERT INTO music_chart_snapshot ("chartKey", "sourcePeriod", "observedAt", rank, eligible) VALUES ($1, $2, $3, $4, $5)', ['genie-mv-daily', period, attempt, 9, true]);
		const summary = await service.summary();
		expect(summary.charts).toHaveLength(5);
		expect(summary.charts.find(chart => chart.key === 'genie-realtime')).toMatchObject({ rank: null, maxRank: 200 });
		expect((await service.history('genie-realtime')).points.every(point => point.result === 'missing')).toBe(true);
		await service.recordOutcome('genie-realtime', { snapshot: { ...success.snapshot, rank: 200 } }, attempt);
		expect((await service.history('genie-realtime')).points.filter(point => point.result === 'ranked')).toMatchObject([{ rank: 200 }]);
		expect(await db.query('SELECT rank FROM music_chart_state WHERE "chartKey"=$1', ['genie-mv-daily'])).toEqual([{ rank: 9 }]);
		expect(await db.query('SELECT rank FROM music_chart_snapshot WHERE "chartKey"=$1', ['genie-mv-daily'])).toEqual([{ rank: 9 }]);
		expect(send).not.toHaveBeenCalled();
	});

	it('rejects Genie rank 201 transactionally while preserving an actual rank 200', async () => {
		await service.recordOutcome('genie-realtime', { snapshot: { ...success.snapshot, rank: 200 } }, attempt);
		await expect(service.recordOutcome('genie-realtime', { snapshot: { ...success.snapshot, rank: 201 } }, new Date(attempt.getTime() + 1000))).rejects.toThrow();
		expect((await db.getRepository(MiMusicChartState).findOneByOrFail({ chartKey: 'genie-realtime' })).rank).toBe(200);
		expect(await db.getRepository(MiMusicChartSnapshot).count()).toBe(1);
	});

	it('deduplicates a period and atomically rejects delayed concurrent updates', async () => {
		await Promise.all([
			service.recordOutcome('bugs-realtime', { snapshot: { ...success.snapshot, rank: 4 } }, new Date(attempt.getTime() + 1000)),
			service.recordOutcome('bugs-realtime', success, attempt),
		]);
		const state = await db.getRepository(MiMusicChartState).findOneByOrFail({ chartKey: 'bugs-realtime' });
		expect(state.rank).toBe(4);
		expect(await db.getRepository(MiMusicChartSnapshot).count()).toBe(1);
		expect((await db.getRepository(MiMusicChartSnapshot).findOneByOrFail({ chartKey: 'bugs-realtime' })).rank).toBe(4);
	});

	it('commits failures without deleting the last valid sample', async () => {
		await service.recordOutcome('bugs-realtime', success, attempt);
		await service.recordOutcome('bugs-realtime', { failure: 'restricted' }, new Date(attempt.getTime() + 1000));
		const summary = await service.summary();
		expect(summary.charts.find(chart => chart.key === 'bugs-realtime')).toMatchObject({ status: 'restricted', rank: 9, result: 'ranked' });
		expect(await db.getRepository(MiMusicChartSnapshot).count()).toBe(1);
	});

	it('rolls back a rejected observation without partially creating state', async () => {
		await expect(service.recordOutcome('bugs-realtime', { snapshot: { ...success.snapshot, rank: 101 } }, attempt)).rejects.toThrow();
		expect(await db.getRepository(MiMusicChartSnapshot).count()).toBe(0);
		expect(await db.getRepository(MiMusicChartState).count()).toBe(0);
	});

	it('preserves the observed peak while expiring old history', async () => {
		const oldPeriod = new Date(period.getTime() - 10 * 24 * 3600000);
		await service.recordOutcome('bugs-realtime', { snapshot: { period: oldPeriod.toISOString(), rank: 2, eligible: true } }, new Date(oldPeriod.getTime() + 60000));
		await service.recordOutcome('bugs-realtime', success, attempt);
		const state = await db.getRepository(MiMusicChartState).findOneByOrFail({ chartKey: 'bugs-realtime' });
		expect(state.peakRank).toBe(2);
		expect(state.previousRank).toBe(2);
		expect(await db.getRepository(MiMusicChartSnapshot).count()).toBe(1);
	});

	it('caches bounded public reads and keeps historical gaps', async () => {
		await service.recordOutcome('bugs-realtime', success, attempt);
		const first = await service.summary();
		const second = await service.summary();
		expect(first).toBe(second);
		const history = await service.history('bugs-realtime');
		expect(history.points).toHaveLength(169);
		expect(history.points.filter(point => point.result === 'ranked')).toHaveLength(1);
		expect(history.points.some(point => point.result === 'missing')).toBe(true);
		expect(await service.history('bugs-realtime')).toBe(history);
		expect(send).not.toHaveBeenCalled();
	});

	it('backs off a source policy denial without requesting chart content', async () => {
		send.mockResolvedValue({ status: 200, headers: new Map([['content-type', 'text/plain']]), text: async () => 'User-agent: *\nDisallow: /\n' });
		await service.collect('bugs-realtime');
		await service.collect('bugs-realtime');
		expect(send).toHaveBeenCalledTimes(1);
		expect(send.mock.calls[0][0]).toBe('https://music.bugs.co.kr/robots.txt');
		expect(send.mock.calls[0][1]).toMatchObject({ redirect: 'error', timeout: 10000, size: 1024 * 1024 });
		expect((await service.summary()).charts.find(chart => chart.key === 'bugs-realtime')).toMatchObject({ status: 'restricted', result: 'unknown', rank: null });
	});

	it('expiry changes eligibility without storing a synthetic observation', async () => {
		await service.recordOutcome('melon-hot100', success, attempt);
		await service.recordOutcome('melon-hot100', { ineligible: true }, new Date(attempt.getTime() + 1000));
		expect(await db.getRepository(MiMusicChartSnapshot).count()).toBe(1);
		const state = await db.getRepository(MiMusicChartState).findOneByOrFail({ chartKey: 'melon-hot100' });
		expect(state).toMatchObject({ rank: null, result: 'out_of_scope', sourcePeriod: period, lastSuccessAt: attempt, peakRank: 9 });
	});
});
