/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource, In, LessThan, MoreThanOrEqual } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { MiMusicChartState } from '@/models/MusicChartState.js';
import { MiMusicChartSnapshot } from '@/models/MusicChartSnapshot.js';
import { HttpRequestService } from './HttpRequestService.js';
import { MusicChartReferenceService } from './MusicChartReferenceService.js';
import type { MusicChartReference } from './music-charts/reference-state.js';
import { MUSIC_CHARTS, fetchMusicChart, MusicChartSourceError, type MusicChartKey } from './music-charts/provider.js';
import { initialMusicChartState, applyMusicChartOutcome, packMusicChartState, musicChartHistory, type MusicChartOutcome } from './music-charts/state.js';
import { musicChartCollectionGate, type MusicChartCollectionResult } from './music-charts/schedule.js';

const CACHE_MS = 30000;
const ALLOWED_HOSTS = new Set(['www.melon.com', 'www.genie.co.kr', 'music.bugs.co.kr']);

@Injectable()
export class MusicChartService {
	private summaryCache: { expires: number; value: Promise<{ charts: (ReturnType<typeof packMusicChartState> & { reference: MusicChartReference | null })[] }> } | null = null;
	private historyCache = new Map<MusicChartKey, { expires: number; value: Promise<ReturnType<typeof musicChartHistory>> }>();

	constructor(
		@Inject(DI.db) private db: DataSource,
		private httpRequestService: HttpRequestService,
		private musicChartReferenceService: MusicChartReferenceService,
	) {}

	/** Public reads never fetch an upstream chart or enqueue work. */
	public async summary() {
		const now = new Date();
		if (this.summaryCache && this.summaryCache.expires > now.getTime()) return this.summaryCache.value;
		const value = Promise.all([
			this.db.getRepository(MiMusicChartState).find({ where: { chartKey: In(MUSIC_CHARTS.map(chart => chart.key)) } }),
			this.musicChartReferenceService.readReferences(now),
		]).then(([rows, references]) => ({
			charts: MUSIC_CHARTS.map(definition => ({
				...packMusicChartState(rows.find(row => row.chartKey === definition.key) ?? initialMusicChartState(definition.key), now),
				reference: references[definition.key] ?? null,
			})),
		}));
		this.summaryCache = { value, expires: now.getTime() + CACHE_MS };
		try {
			return await value;
		} catch (error) {
			if (this.summaryCache?.value === value) this.summaryCache = null;
			throw error;
		}
	}

	public async history(chartKey: MusicChartKey) {
		if (!MUSIC_CHARTS.some(chart => chart.key === chartKey)) throw new Error('Unknown music chart');
		const now = new Date();
		const cached = this.historyCache.get(chartKey);
		if (cached && cached.expires > now.getTime()) return cached.value;
		const range = musicChartHistory(chartKey, [], now);
		const value = this.db.getRepository(MiMusicChartSnapshot).find({
			where: { chartKey, sourcePeriod: MoreThanOrEqual(new Date(range.from)) },
			order: { sourcePeriod: 'ASC' },
			take: 169,
		}).then(rows => musicChartHistory(chartKey, rows, now));
		this.historyCache.set(chartKey, { value, expires: now.getTime() + CACHE_MS });
		try {
			return await value;
		} catch (error) {
			if (this.historyCache.get(chartKey)?.value === value) this.historyCache.delete(chartKey);
			throw error;
		}
	}

	public async collect(chartKey: MusicChartKey, scheduledAt?: number): Promise<MusicChartCollectionResult> {
		if (!MUSIC_CHARTS.some(chart => chart.key === chartKey)) throw new Error('Unknown music chart');
		const checkedAt = new Date();
		const current = await this.db.getRepository(MiMusicChartState).findOneBy({ chartKey });
		const gate = musicChartCollectionGate(current?.checkedAt && current.nextAttemptAt ? { checkedAt: current.checkedAt.getTime(), nextAttemptAt: current.nextAttemptAt.getTime(), status: current.status, result: current.result } : null, checkedAt.getTime(), scheduledAt);
		if (gate.action === 'defer') return { deferUntil: gate.deferUntil };
		if (gate.action === 'skip') return;
		let outcome: MusicChartOutcome;
		try {
			const snapshot = await fetchMusicChart(chartKey, async url => {
				const parsed = new URL(url);
				if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname) || parsed.port || parsed.username || parsed.password) throw new Error('Disallowed chart URL');
				const response = await this.httpRequestService.send(url, { timeout: 10000, size: 1024 * 1024, redirect: 'error' }, { throwErrorWhenResponseNotOk: false });
				return { status: response.status, contentType: response.headers.get('content-type'), body: await response.text() };
			}, checkedAt);
			outcome = { snapshot };
		} catch (error) {
			outcome = error instanceof MusicChartSourceError && error.kind === 'out_of_scope'
				? { ineligible: true }
				: { failure: error instanceof MusicChartSourceError && error.kind === 'restricted' ? 'restricted' : 'unavailable' };
		}
		await this.recordOutcome(chartKey, outcome, checkedAt);
		return undefined;
	}

	/** Commit state and period sample together, serialized per chart without holding a lock during HTTP. */
	public async recordOutcome(chartKey: MusicChartKey, outcome: MusicChartOutcome, checkedAt: Date): Promise<void> {
		if (!MUSIC_CHARTS.some(chart => chart.key === chartKey)) throw new Error('Unknown music chart');
		await this.db.transaction(async manager => {
			await manager.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', ['pubo-music-chart', chartKey]);
			const states = manager.getRepository(MiMusicChartState);
			const current = await states.findOneBy({ chartKey }) ?? initialMusicChartState(chartKey);
			const update = applyMusicChartOutcome(current, outcome, checkedAt);
			if (!update) return;
			if (update.snapshot) await manager.getRepository(MiMusicChartSnapshot).upsert(update.snapshot, ['chartKey', 'sourcePeriod']);
			await states.save(update.state);
			// Keep one extra day so the boundary of the seven-day view remains intact.
			await manager.getRepository(MiMusicChartSnapshot).delete({ chartKey, sourcePeriod: LessThan(new Date(checkedAt.getTime() - 8 * 24 * 3600000)) });
		});
		this.summaryCache = null;
		this.historyCache.delete(chartKey);
	}
}
