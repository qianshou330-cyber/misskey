/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Bull from 'bullmq';
import { DI } from '@/di-symbols.js';
import { kpopEnabled } from '@/core/kpop-charts/schedule.js';
import type { Config } from '@/config.js';
import { MusicChartService } from '@/core/MusicChartService.js';
import { MusicChartReferenceService } from '@/core/MusicChartReferenceService.js';
import { enabledReferenceCharts, REFERENCE_CHARTS, REFERENCE_SOURCES } from '@/core/music-charts/reference-state.js';
import type { ReferenceSource } from '@/core/music-charts/reference-parser.js';
import { MUSIC_CHARTS, type MusicChartKey } from '@/core/music-charts/provider.js';
import { MUSIC_CHART_SCHEDULE_VERSION, musicChartJobSlot, musicChartSchedule, nextMusicChartSlot, type MusicChartTask } from '@/core/music-charts/schedule.js';
import { QueueLoggerService } from './QueueLoggerService.js';
import { baseQueueOptions, baseWorkerOptions, QUEUE } from './const.js';

// Retired source IDs remain separate from active keys and their stored history.
const RETIRED_CHART_KEYS: readonly string[] = ['genie-mv-daily'];
type ChartJob = ({ chartKey: MusicChartKey; kind?: undefined } | { kind: 'reference'; source: ReferenceSource }) & { scheduleVersion?: number };

/** Dedicated worker: slow external sites cannot block system/federation jobs. */
@Injectable()
export class MusicChartQueueService {
	private queue: Bull.Queue<ChartJob> | null = null;
	private worker: Bull.Worker<ChartJob> | null = null;
	private stopping: Promise<void> | null = null;
	private firstSlots = new Map<MusicChartTask, number>();

	constructor(
		@Inject(DI.config) private config: Config,
		private musicChartService: MusicChartService,
		private queueLoggerService: QueueLoggerService,
		private musicChartReferenceService: MusicChartReferenceService,
	) {}

	public async start(): Promise<void> {
		if (this.queue) return;
		this.stopping = null;
		const startedAt = Date.now();
		this.queue = new Bull.Queue(QUEUE.MUSIC_CHARTS, baseQueueOptions(this.config, QUEUE.MUSIC_CHARTS));
		for (const key of RETIRED_CHART_KEYS) await this.queue.removeJobScheduler(key);
		if (process.env.PUBO_MUSIC_CHARTS_ENABLED !== 'true' || kpopEnabled()) {
			// Only our scheduler IDs in our own queue are affected by disabling collection.
			await Promise.all(MUSIC_CHARTS.map(chart => this.queue!.removeJobScheduler(chart.key)));
			await Promise.all(REFERENCE_SOURCES.map(source => this.queue!.removeJobScheduler(`reference:${source}`)));
			return;
		}
		for (const chart of MUSIC_CHARTS) {
			this.firstSlots.set(chart.key, nextMusicChartSlot(chart.key, startedAt));
			await this.queue.upsertJobScheduler(chart.key, musicChartSchedule(chart.key), {
				name: chart.key,
				data: { chartKey: chart.key, scheduleVersion: MUSIC_CHART_SCHEDULE_VERSION },
				opts: { attempts: 1, removeOnComplete: { count: 20 }, removeOnFail: { count: 20 } },
			});
		}
		const enabledReferences = enabledReferenceCharts();
		for (const source of REFERENCE_SOURCES) {
			const schedulerId = `reference:${source}` as const;
			if (!enabledReferences.some(key => REFERENCE_CHARTS[key].source === source)) {
				await this.queue.removeJobScheduler(schedulerId);
				continue;
			}
			this.firstSlots.set(schedulerId, nextMusicChartSlot(schedulerId, startedAt));
			await this.queue.upsertJobScheduler(schedulerId, musicChartSchedule(schedulerId), {
				name: schedulerId,
				data: { kind: 'reference', source, scheduleVersion: MUSIC_CHART_SCHEDULE_VERSION },
				opts: { attempts: 1, removeOnComplete: { count: 20 }, removeOnFail: { count: 20 } },
			});
		}
		this.worker = new Bull.Worker(QUEUE.MUSIC_CHARTS, async (job, token) => {
			if (process.env.PUBO_MUSIC_CHARTS_ENABLED !== 'true' || kpopEnabled()) return;
			let task: MusicChartTask;
			if (job.data.kind === 'reference') {
				const source = job.data.source;
				if (!REFERENCE_SOURCES.includes(source)) throw new Error('Unknown reference chart job');
				if (!enabledReferenceCharts().some(key => REFERENCE_CHARTS[key].source === source)) return;
				task = `reference:${source}`;
			} else {
				// A delayed job can survive scheduler removal; never fetch a retired source.
				const chartKey = job.data.chartKey;
				if (RETIRED_CHART_KEYS.includes(chartKey)) return;
				if (!MUSIC_CHARTS.some(chart => chart.key === chartKey)) throw new Error('Unknown music chart job');
				task = chartKey;
			}
			// Old interval jobs and catch-up jobs from before this process started
			// cannot cause an immediate collection on upgrade or restart.
			if (job.data.scheduleVersion !== MUSIC_CHART_SCHEDULE_VERSION) return;
			const slot = musicChartJobSlot(task, job.id);
			const firstSlot = this.firstSlots.get(task);
			if (slot === null || firstSlot === undefined || slot < firstSlot || slot > Date.now()) return;
			const result = job.data.kind === 'reference'
				? await this.musicChartReferenceService.collect(job.data.source, slot)
				: await this.musicChartService.collect(job.data.chartKey, slot);
			if (result) {
				// Reuse this logical job. BullMQ has already scheduled the following
				// hour and will not produce it again when this delayed job resumes.
				await job.moveToDelayed(result.deferUntil, token);
				throw new Bull.DelayedError();
			}
		}, { ...baseWorkerOptions(this.config, QUEUE.MUSIC_CHARTS), concurrency: 1 });
		const logger = this.queueLoggerService.logger.createSubLogger('music-charts');
		this.worker.on('error', () => logger.error('Music chart worker error'));
		this.worker.on('failed', job => logger.warn(`Music chart job failed: ${job?.name ?? 'unknown'}`));
	}

	public async stop(): Promise<void> {
		this.stopping ??= (async () => {
			await this.worker?.close();
			await this.queue?.close();
			this.worker = null;
			this.queue = null;
			this.firstSlots.clear();
		})();
		await this.stopping;
	}
}
