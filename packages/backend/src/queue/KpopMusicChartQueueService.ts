/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Bull from 'bullmq';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { KpopMusicChartService } from '@/core/KpopMusicChartService.js';
import { enabledKpopKeys, kpopEnabled, kpopJobSlot, kpopSchedule, KPOP_KEYS, KPOP_SCHEDULE_VERSION, nextKpopSlot } from '@/core/kpop-charts/schedule.js';
import type { KpopChartKey } from '@/core/kpop-charts/types.js';
import { QueueLoggerService } from './QueueLoggerService.js';
import { baseQueueOptions, baseWorkerOptions, QUEUE } from './const.js';

type KpopJob = { chartKey: KpopChartKey; scheduleVersion: number };

@Injectable()
export class KpopMusicChartQueueService {
	private queue: Bull.Queue<KpopJob> | null = null;
	private worker: Bull.Worker<KpopJob> | null = null;
	private firstSlots = new Map<KpopChartKey, number>();
	private stopping: Promise<void> | null = null;
	constructor(@Inject(DI.config) private config: Config, private service: KpopMusicChartService, private logger: QueueLoggerService) {}

	public async start(): Promise<void> {
		if (this.queue) return;
		this.stopping = null;
		this.queue = new Bull.Queue(QUEUE.KPOP_MUSIC_CHARTS, baseQueueOptions(this.config, QUEUE.KPOP_MUSIC_CHARTS));
		const enabled = kpopEnabled() ? enabledKpopKeys() : [];
		const startedAt = Date.now();
		for (const key of KPOP_KEYS) {
			if (!enabled.includes(key)) { await this.queue.removeJobScheduler(key); continue; }
			this.firstSlots.set(key, nextKpopSlot(key, startedAt));
			await this.queue.upsertJobScheduler(key, kpopSchedule(key), {
				name: key, data: { chartKey: key, scheduleVersion: KPOP_SCHEDULE_VERSION },
				opts: { attempts: 1, removeOnComplete: { count: 30 }, removeOnFail: { count: 30 } },
			});
		}
		if (!enabled.length) return;
		// If scheduler registration itself was slow, do not execute catch-up work
		// immediately when the worker is finally ready.
		const readyAt = Date.now();
		for (const key of enabled) this.firstSlots.set(key, nextKpopSlot(key, readyAt));
		this.worker = new Bull.Worker(QUEUE.KPOP_MUSIC_CHARTS, async (job, token) => {
			const key = job.data.chartKey;
			if (!kpopEnabled() || !enabledKpopKeys().includes(key) || job.data.scheduleVersion !== KPOP_SCHEDULE_VERSION) return;
			const slot = kpopJobSlot(key, job.id);
			const first = this.firstSlots.get(key);
			if (slot === null || first === undefined || slot < first || slot > Date.now()) return;
			const result = await this.service.collect(key, slot);
			if (result) { await job.moveToDelayed(result.deferUntil, token); throw new Bull.DelayedError(); }
		}, { ...baseWorkerOptions(this.config, QUEUE.KPOP_MUSIC_CHARTS), concurrency: 1 });
		const logger = this.logger.logger.createSubLogger('kpop-charts');
		this.worker.on('error', () => logger.error('K-pop chart worker error'));
		this.worker.on('failed', () => logger.warn('K-pop chart job failed'));
	}
	public async stop(): Promise<void> {
		this.stopping ??= (async () => { await this.worker?.close(); await this.queue?.close(); this.worker = null; this.queue = null; this.firstSlots.clear(); })();
		await this.stopping;
	}
}
