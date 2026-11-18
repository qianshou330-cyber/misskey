/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '@/config.js';
import type { MusicChartService } from '@/core/MusicChartService.js';
import type { MusicChartReferenceService } from '@/core/MusicChartReferenceService.js';
import type { QueueLoggerService } from '@/queue/QueueLoggerService.js';
import { MUSIC_CHART_SCHEDULE_VERSION, nextMusicChartSlot, type MusicChartTask, type MusicChartCollectionResult } from '@/core/music-charts/schedule.js';

type FakeJob = { id?: string; data: ({ chartKey: string } | { kind: 'reference'; source: string }) & { scheduleVersion?: number }; moveToDelayed: ReturnType<typeof vi.fn> };
const mocks = vi.hoisted(() => ({ upsert: vi.fn(), remove: vi.fn(), drain: vi.fn(), closeQueue: vi.fn(), closeWorker: vi.fn(), processor: null as null | ((job: FakeJob, token?: string) => Promise<void>), queues: [] as string[], workers: [] as string[], workerOptions: null as null | { concurrency: number } }));
vi.mock('bullmq', () => ({
	MetricsTime: { ONE_WEEK: 10080 },
	DelayedError: class extends Error { constructor() { super('bullmq:delayed'); } },
	Queue: class {
		constructor(name: string) { mocks.queues.push(name); }
		upsertJobScheduler = mocks.upsert;
		removeJobScheduler = mocks.remove;
		drain = mocks.drain;
		close = mocks.closeQueue;
	},
	Worker: class {
		constructor(name: string, processor: typeof mocks.processor, options: { concurrency: number }) { mocks.workers.push(name); mocks.processor = processor; mocks.workerOptions = options; }
		on() { return this; }
		close = mocks.closeWorker;
	},
}));

import { MusicChartQueueService } from '@/queue/MusicChartQueueService.js';

const startedAt = new Date('2026-10-16T16:00:00.000Z').getTime();

function makeService() {
	const collect = vi.fn(async (): Promise<MusicChartCollectionResult> => undefined);
	const collectReference = vi.fn(async (): Promise<MusicChartCollectionResult> => undefined);
	const logger = { warn: vi.fn(), error: vi.fn() };
	const service = new MusicChartQueueService({ redisForJobQueue: { host: '127.0.0.1', port: 1 } } as Config, { collect } as unknown as MusicChartService, { logger: { createSubLogger: () => logger } } as unknown as QueueLoggerService, { collect: collectReference } as unknown as MusicChartReferenceService);
	return { service, collect, collectReference };
}

function job(task: MusicChartTask, at = nextMusicChartSlot(task, startedAt)): FakeJob {
	return {
		id: `repeat:${task}:${at}`,
		data: task.startsWith('reference:') ? { kind: 'reference', source: task.slice(10), scheduleVersion: MUSIC_CHART_SCHEDULE_VERSION } : { chartKey: task, scheduleVersion: MUSIC_CHART_SCHEDULE_VERSION },
		moveToDelayed: vi.fn(async () => {}),
	};
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(startedAt);
	vi.stubEnv('PUBO_MUSIC_CHARTS_ENABLED', 'true');
	vi.stubEnv('PUBO_KPOP_CHARTS_ENABLED', 'false');
	vi.stubEnv('PUBO_MUSIC_CHART_REFERENCES', '');
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	vi.clearAllMocks();
	mocks.queues.length = 0;
	mocks.workers.length = 0;
	mocks.processor = null;
});

describe('Dedicated hourly chart collection queue', () => {
	it('disabled collection removes known schedules only in its own queue', async () => {
		vi.stubEnv('PUBO_MUSIC_CHARTS_ENABLED', 'false');
		const { service } = makeService();
		await service.start();
		expect(mocks.queues).toEqual(['musicCharts']);
		expect(mocks.remove.mock.calls.map(call => call[0])).toEqual(['genie-mv-daily', 'melon-daily', 'melon-hot100', 'melon-top100', 'genie-realtime', 'bugs-realtime', 'reference:melon', 'reference:genie', 'reference:bugs']);
		expect(mocks.workers).toHaveLength(0);
		expect(mocks.upsert).not.toHaveBeenCalled();
		expect(mocks.drain).not.toHaveBeenCalled();
		await service.stop();
	});
	it('new K-pop switch fences an already running legacy worker without clearing queued jobs', async () => {
		const { service, collect, collectReference } = makeService();
		await service.start();
		vi.stubEnv('PUBO_KPOP_CHARTS_ENABLED', 'true');
		vi.setSystemTime(nextMusicChartSlot('melon-top100', startedAt));
		await mocks.processor!(job('melon-top100'));
		expect(collect).not.toHaveBeenCalled();
		expect(collectReference).not.toHaveBeenCalled();
		expect(mocks.drain).not.toHaveBeenCalled();
		await service.stop();
	});
	it('replaces five schedules in place with fixed hourly cron slots and no immediate fetch', async () => {
		const { service, collect, collectReference } = makeService();
		await service.start();
		await service.start();
		expect(mocks.workers).toEqual(['musicCharts']);
		expect(mocks.workerOptions?.concurrency).toBe(1);
		expect(mocks.upsert.mock.calls.map(call => [call[0], call[1]])).toEqual([
			['melon-daily', { pattern: '0 5 * * * *', tz: 'UTC' }],
			['melon-hot100', { pattern: '0 7 * * * *', tz: 'UTC' }],
			['melon-top100', { pattern: '0 9 * * * *', tz: 'UTC' }],
			['genie-realtime', { pattern: '0 11 * * * *', tz: 'UTC' }],
			['bugs-realtime', { pattern: '0 13 * * * *', tz: 'UTC' }],
		]);
		expect(mocks.upsert.mock.calls.every(call => call[2].data.scheduleVersion === MUSIC_CHART_SCHEDULE_VERSION)).toBe(true);
		expect(collect).not.toHaveBeenCalled();
		expect(collectReference).not.toHaveBeenCalled();
		expect(mocks.drain).not.toHaveBeenCalled();
		vi.setSystemTime('2026-10-16T16:13:00.000Z');
		await mocks.processor!(job('bugs-realtime'));
		expect(collect).toHaveBeenCalledExactlyOnceWith('bugs-realtime', Date.now());
		await service.stop();
		await service.stop();
		expect(mocks.closeWorker).toHaveBeenCalledTimes(1);
		expect(mocks.closeQueue).toHaveBeenCalledTimes(1);
	});
	it('retains the next future slot after restart and skips pre-restart catch-up work', async () => {
		const { service, collect } = makeService();
		await service.start();
		await service.stop();
		vi.setSystemTime('2026-10-16T16:20:00.000Z');
		await service.start();
		await mocks.processor!(job('bugs-realtime'));
		expect(collect).not.toHaveBeenCalled();
		vi.setSystemTime('2026-10-16T17:13:00.000Z');
		await mocks.processor!(job('bugs-realtime', Date.now()));
		expect(collect).toHaveBeenCalledExactlyOnceWith('bugs-realtime', Date.now());
		expect(mocks.upsert).toHaveBeenCalledTimes(10);
		await service.stop();
	});
	it('skips old interval jobs, retired sources, invalid slots and future jobs', async () => {
		const { service, collect } = makeService();
		await service.start();
		vi.setSystemTime('2026-10-16T16:20:00.000Z');
		const legacy = job('bugs-realtime');
		delete legacy.data.scheduleVersion;
		await mocks.processor!(legacy);
		await mocks.processor!({ ...legacy, data: { chartKey: 'genie-mv-daily' } });
		await mocks.processor!(job('bugs-realtime', Date.parse('2026-10-16T16:15:00.000Z')));
		await mocks.processor!(job('bugs-realtime', Date.parse('2026-10-16T17:13:00.000Z')));
		await mocks.processor!({ ...job('bugs-realtime'), id: 'manual-job' });
		expect(collect).not.toHaveBeenCalled();
		expect(mocks.drain).not.toHaveBeenCalled();
		await service.stop();
	});
	it('rejects foreign jobs and checks the disable flag before collection', async () => {
		const { service, collect } = makeService();
		await service.start();
		await expect(mocks.processor!({ ...job('bugs-realtime'), data: { chartKey: 'arbitrary' } })).rejects.toThrow('Unknown music');
		vi.stubEnv('PUBO_MUSIC_CHARTS_ENABLED', 'false');
		await mocks.processor!(job('bugs-realtime'));
		expect(collect).not.toHaveBeenCalled();
		await service.stop();
	});
	it('groups Melon references once and gives each enabled source a stable staggered slot', async () => {
		vi.stubEnv('PUBO_MUSIC_CHART_REFERENCES', 'melon-daily,melon-top100,genie-realtime,bugs-realtime,melon-hot100');
		const { service, collect, collectReference } = makeService();
		await service.start();
		const references = mocks.upsert.mock.calls.filter(call => call[0].startsWith('reference:'));
		expect(references.map(call => [call[0], call[1]])).toEqual([
			['reference:melon', { pattern: '0 15 * * * *', tz: 'UTC' }],
			['reference:genie', { pattern: '0 17 * * * *', tz: 'UTC' }],
			['reference:bugs', { pattern: '0 19 * * * *', tz: 'UTC' }],
		]);
		vi.setSystemTime('2026-10-16T16:15:00.000Z');
		await mocks.processor!(job('reference:melon'));
		expect(collectReference).toHaveBeenCalledExactlyOnceWith('melon', Date.now());
		expect(collect).not.toHaveBeenCalled();
		await expect(mocks.processor!({ ...job('reference:melon'), data: { kind: 'reference', source: 'arbitrary' } })).rejects.toThrow('Unknown reference');
		vi.stubEnv('PUBO_MUSIC_CHART_REFERENCES', '');
		await mocks.processor!(job('reference:melon'));
		expect(collectReference).toHaveBeenCalledTimes(1);
		await service.stop();
	});
	it('does not create reference jobs for HOT100, retired or unknown keys', async () => {
		vi.stubEnv('PUBO_MUSIC_CHART_REFERENCES', 'melon-hot100,https://example.com,genie-mv-daily');
		const { service } = makeService();
		await service.start();
		expect(mocks.upsert).toHaveBeenCalledTimes(5);
		expect(mocks.drain).not.toHaveBeenCalled();
		await service.stop();
	});
	it.each(['bugs-realtime', 'reference:bugs'] as const)('moves the same early %s job to the cooldown boundary without registering extra jobs', async task => {
		vi.stubEnv('PUBO_MUSIC_CHART_REFERENCES', 'bugs-realtime');
		const { service, collect, collectReference } = makeService();
		await service.start();
		const scheduledAt = nextMusicChartSlot(task, startedAt);
		vi.setSystemTime(scheduledAt);
		const collector = task === 'bugs-realtime' ? collect : collectReference;
		collector.mockResolvedValueOnce({ deferUntil: scheduledAt + 51 }).mockResolvedValueOnce(undefined);
		const currentJob = job(task, scheduledAt);
		await expect(mocks.processor!(currentJob, 'lock-token')).rejects.toThrow('bullmq:delayed');
		expect(currentJob.moveToDelayed).toHaveBeenCalledExactlyOnceWith(scheduledAt + 51, 'lock-token');
		vi.setSystemTime(scheduledAt + 51);
		await mocks.processor!(currentJob, 'renewed-token');
		expect(collector).toHaveBeenCalledTimes(2);
		expect(mocks.upsert).toHaveBeenCalledTimes(6);
		await service.stop();
	});
});
