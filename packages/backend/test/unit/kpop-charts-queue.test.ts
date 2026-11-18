/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '@/config.js';
import type { KpopMusicChartService } from '@/core/KpopMusicChartService.js';
import type { QueueLoggerService } from '@/queue/QueueLoggerService.js';
import { KPOP_KEYS, nextKpopSlot } from '@/core/kpop-charts/schedule.js';
const mocks = vi.hoisted(() => ({ upsert: vi.fn(), remove: vi.fn(), close: vi.fn(), processor: null as null | ((job: { id: string; data: { chartKey: string; scheduleVersion: number }; moveToDelayed: ReturnType<typeof vi.fn> }, token?: string) => Promise<void>), queueNames: [] as string[], workerOptions: null as null | { concurrency: number } }));
vi.mock('bullmq', () => ({
	MetricsTime: { ONE_WEEK: 10080 }, DelayedError: class extends Error {},
	Queue: class { constructor(name: string) { mocks.queueNames.push(name); } upsertJobScheduler = mocks.upsert; removeJobScheduler = mocks.remove; close = mocks.close; },
	Worker: class { constructor(_name: string, processor: typeof mocks.processor, options: { concurrency: number }) { mocks.processor = processor; mocks.workerOptions = options; } on() { return this; } close = mocks.close; },
}));
import { KpopMusicChartQueueService } from '@/queue/KpopMusicChartQueueService.js';
const startedAt = Date.parse('2026-10-17T10:00:00Z');

function service() {
	const collect = vi.fn(async (): Promise<{ deferUntil: number } | undefined> => undefined);
	return { collect, queue: new KpopMusicChartQueueService({ redisForJobQueue: { host: 'redis', port: 6379 } } as Config, { collect } as unknown as KpopMusicChartService, { logger: { createSubLogger: () => ({ warn: vi.fn(), error: vi.fn() }) } } as unknown as QueueLoggerService) };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(startedAt); vi.stubEnv('PUBO_KPOP_CHARTS_ENABLED', 'true'); vi.stubEnv('PUBO_KPOP_CHARTS_KEYS', KPOP_KEYS.join(',')); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.clearAllMocks(); mocks.processor = null; mocks.queueNames.length = 0; });
describe('Dedicated K-pop queue', () => {
	it('registers eleven hourly schedules without eager collection and starts only one worker', async () => {
		const { queue, collect } = service(); await queue.start(); await queue.start();
		expect(mocks.queueNames).toEqual(['kpopMusicCharts']); expect(mocks.upsert).toHaveBeenCalledTimes(11); expect(collect).not.toHaveBeenCalled(); expect(mocks.workerOptions?.concurrency).toBe(1);
		await queue.stop();
	});
	it('default empty allowlist removes own schedules and creates no worker', async () => {
		vi.stubEnv('PUBO_KPOP_CHARTS_KEYS', ''); const { queue } = service(); await queue.start();
		expect(mocks.remove.mock.calls.map(call => call[0])).toEqual(KPOP_KEYS); expect(mocks.processor).toBeNull(); await queue.stop();
	});
	it('rejects old version, pre-start and future jobs', async () => {
		const { queue, collect } = service(); await queue.start(); const slot = nextKpopSlot('melon-daily', startedAt);
		const job = { id: `repeat:melon-daily:${slot}`, data: { chartKey: 'melon-daily', scheduleVersion: 1 }, moveToDelayed: vi.fn() };
		await mocks.processor!(job); vi.setSystemTime(slot); await mocks.processor!({ ...job, data: { ...job.data, scheduleVersion: 0 } });
		await mocks.processor!({ ...job, id: `repeat:melon-daily:${slot - 3600000}` }); expect(collect).not.toHaveBeenCalled();
		await mocks.processor!(job); expect(collect).toHaveBeenCalledExactlyOnceWith('melon-daily', slot); await queue.stop();
	});
	it('reuses a delayed logical job at cooldown expiry and rejects runtime disable', async () => {
		const { queue, collect } = service(); await queue.start(); const slot = nextKpopSlot('melon-daily', startedAt); vi.setSystemTime(slot);
		collect.mockResolvedValue({ deferUntil: slot + 25 }); const job = { id: `repeat:melon-daily:${slot}`, data: { chartKey: 'melon-daily', scheduleVersion: 1 }, moveToDelayed: vi.fn(async () => {}) };
		await expect(mocks.processor!(job, 'lock')).rejects.toThrow(); expect(job.moveToDelayed).toHaveBeenCalledExactlyOnceWith(slot + 25, 'lock');
		vi.stubEnv('PUBO_KPOP_CHARTS_ENABLED', 'false'); collect.mockClear(); await mocks.processor!(job); expect(collect).not.toHaveBeenCalled(); await queue.stop();
	});
});
