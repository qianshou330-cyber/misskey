/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DataSource, In, MoreThanOrEqual, type EntityManager } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { MiKpopChartState } from '@/models/KpopChartState.js';
import { MiKpopChartSnapshot } from '@/models/KpopChartSnapshot.js';
import { MiKpopChartEntry } from '@/models/KpopChartEntry.js';
import { HttpRequestService } from './HttpRequestService.js';
import { KPOP_CHARTS, KPOP_GROUPS } from './kpop-charts/catalog.js';
import { allowedKpopUrl, fetchKpopChart } from './kpop-charts/transport.js';
import { assertKpopSnapshot } from './kpop-charts/parser.js';
import { projectKpopGroups, reclassifiedKpopHash } from './kpop-charts/groups.js';
import { KpopSourceError, type KpopChartKey, type KpopDiagnostic, type KpopGroupId, type KpopRobotsAudit, type KpopSnapshot } from './kpop-charts/types.js';
import { enabledKpopKeys, kpopEnabled, KPOP_HOUR_MS, KPOP_KEYS } from './kpop-charts/schedule.js';
import { failureStatus, initialKpopState, kpopBackoff, kpopCollectionGate, KPOP_HISTORY_MS, KPOP_RETENTION_MS, packKpopChart, safeKpopDiagnostic, sanitizeKpopDiagnostic, snapshotDecision, kpopSnapshotCoordinate, selectKpopSeries } from './kpop-charts/state.js';

const CACHE_MS = 30000;
type Outcome = { snapshot: KpopSnapshot; robots: KpopRobotsAudit[] } | { diagnostic: KpopDiagnostic; robots: KpopRobotsAudit[] };

@Injectable()
export class KpopMusicChartService {
	private cache = new Map<string, { until: number; promise: Promise<unknown> }>();

	constructor(@Inject(DI.db) private db: DataSource, private http: HttpRequestService) {}

	private cached<T>(key: string, read: () => Promise<T>): Promise<T> {
		const cached = this.cache.get(key);
		if (cached && cached.until > Date.now()) return cached.promise as Promise<T>;
		if (this.cache.size >= 256) this.cache.delete(this.cache.keys().next().value!);
		const promise = read().catch(error => { this.cache.delete(key); throw error; });
		this.cache.set(key, { until: Date.now() + CACHE_MS, promise });
		return promise;
	}

	private async view(key: KpopChartKey) {
		const source = KPOP_CHARTS[key].source;
		const rows = await this.db.getRepository(MiKpopChartState).findBy({ key: In([key, `source:${source}`]) });
		const state = rows.find(row => row.key === key) ?? initialKpopState(key, source, key);
		const gate = rows.find(row => row.key === `source:${source}`) ?? initialKpopState(`source:${source}`, source, null);
		const snapshot = state.latestSnapshotId ? await this.db.getRepository(MiKpopChartSnapshot).findOneBy({ id: state.latestSnapshotId }) : null;
		const chart = packKpopChart(key, state, gate, snapshot, Date.now(), kpopEnabled() && enabledKpopKeys().includes(key));
		const stored = snapshot ? await this.db.getRepository(MiKpopChartEntry).find({ where: { snapshotId: snapshot.id }, order: { rank: 'ASC' }, take: 200 }) : [];
		try {
			return { chart, snapshot, entries: projectKpopGroups(source, stored) };
		} catch (error) {
			if (!(error instanceof KpopSourceError) || error.code !== 'identity_unverified') throw error;
			// An old complete snapshot can contain a newly registered exact name
			// with a conflicting ID. Report that uncertainty instead of HTTP 500
			// or silently presenting the artist as absent. Persisted state is intact.
			return { chart: { ...chart, status: chart.status === 'disabled' ? 'disabled' as const : 'unavailable' as const, diagnostic: error.diagnostic }, snapshot, entries: null };
		}
	}

	/** Anonymous reads only consult local rows. They never enqueue or request a source. */
	public async summary(chartKey: KpopChartKey = 'melon-top100') {
		return this.cached(`summary:${chartKey}`, async () => {
			const views = await Promise.all(KPOP_KEYS.map(key => this.view(key)));
			const selected = views.find(view => view.chart.chartKey === chartKey)!;
			const entries = selected.snapshot && selected.entries ? await this.entries(selected.snapshot, selected.entries) : [];
			return { charts: views.map(view => view.chart), groups: KPOP_GROUPS.map(group => ({ id: group.id, label: group.name })), selected: selected.chart,
				entries: entries.filter(entry => entry.groupIds.length > 0).slice(0, 2) };
		});
	}

	public async chart(chartKey: KpopChartKey, groupId?: KpopGroupId, query = '', offset = 0, limit = 50) {
		return this.cached(`chart:${JSON.stringify([chartKey, groupId, query, offset, limit])}`, async () => {
			const view = await this.view(chartKey);
			const text = query.normalize('NFKC').toLocaleLowerCase();
			const entries = (view.snapshot && view.entries ? await this.entries(view.snapshot, view.entries) : []).filter(entry => entry.groupIds.length > 0 && (!groupId || entry.groupIds.includes(groupId))
				&& (!text || `${entry.title} ${entry.artists.map(artist => artist.name).join(' ')}`.normalize('NFKC').toLocaleLowerCase().includes(text)));
			return { chart: view.chart, entries: entries.slice(offset, offset + limit), total: entries.length, hasMore: offset + limit < entries.length };
		});
	}

	private async entries(snapshot: MiKpopChartSnapshot, entries: MiKpopChartEntry[]) {
		const now = Date.now();
		const rows = await this.db.getRepository(MiKpopChartSnapshot).find({ where: { chartKey: snapshot.chartKey, observedAt: MoreThanOrEqual(new Date(now - KPOP_HISTORY_MS)) }, order: { observedAt: 'DESC' }, take: 193 });
		const snapshots = selectKpopSeries(rows, snapshot, now - KPOP_HISTORY_MS, now);
		const prior = [...snapshots].reverse().find(row => row.id !== snapshot.id && kpopSnapshotCoordinate(row) < kpopSnapshotCoordinate(snapshot));
		const previous = prior ? await this.db.getRepository(MiKpopChartEntry).findBy({ snapshotId: prior.id }) : [];
		const best = snapshots.length ? await this.db.getRepository(MiKpopChartEntry).createQueryBuilder('entry').select('entry.songId', 'songId').addSelect('MIN(entry.rank)', 'rank')
			.where('entry.snapshotId IN (:...ids)', { ids: snapshots.map(row => row.id) }).groupBy('entry.songId').getRawMany<{ songId: string; rank: number }>() : [];
		return entries.map(entry => {
			const previousRank = previous.find(row => row.songId === entry.songId)?.rank ?? null;
			return { songId: entry.songId, rank: entry.rank, title: entry.title, artists: entry.artists, album: entry.album, albumId: entry.albumId,
				albumCoverUrl: entry.albumCoverUrl, groupIds: entry.groupIds, sourceMovement: entry.sourceMovement,
				previousRank, change: previousRank == null ? null : previousRank - entry.rank, bestRank7d: best.find(row => row.songId === entry.songId)?.rank ?? null };
		});
	}

	public async history(chartKey: KpopChartKey, songId: string) {
		return this.cached(`history:${chartKey}:${songId}`, async () => {
			const now = new Date();
			const from = new Date(now.getTime() - KPOP_HISTORY_MS);
			const view = await this.view(chartKey);
			const basis = view.snapshot?.sourcePeriod ? 'official_period' as const : 'observation' as const;
			const rows = await this.db.getRepository(MiKpopChartSnapshot).find({ where: { chartKey, observedAt: MoreThanOrEqual(from) }, order: { observedAt: 'ASC' }, take: 193 });
			const snapshots = view.snapshot && view.entries ? selectKpopSeries(rows, view.snapshot, from.getTime(), now.getTime()) : [];
			const entries = snapshots.length ? await this.db.getRepository(MiKpopChartEntry).findBy({ snapshotId: In(snapshots.map(snapshot => snapshot.id)), songId }) : [];
			return { chartKey, songId, basis, from: from.toISOString(), to: now.toISOString(), points: snapshots.map((snapshot, index) => {
				const rank = entries.find(entry => entry.snapshotId === snapshot.id)?.rank ?? null;
				const previous = snapshots[index - 1];
				const gapBefore = !previous || kpopSnapshotCoordinate(snapshot) - kpopSnapshotCoordinate(previous) > KPOP_CHARTS[chartKey].periodMinutes * 60000 * 1.5;
				return { observedAt: snapshot.observedAt.toISOString(), sourcePeriod: snapshot.sourcePeriod, sourceUpdatedAt: snapshot.sourceUpdatedAt?.toISOString() ?? null,
					rank, result: rank !== null ? 'ranked' as const : snapshot.coverage === 'complete' ? 'not_listed' as const : 'unknown' as const, gapBefore };
			}) };
		});
	}

	public async collect(chartKey: KpopChartKey, slot: number): Promise<{ deferUntil: number } | undefined> {
		if (!kpopEnabled() || !enabledKpopKeys().includes(chartKey)) return;
		const source = KPOP_CHARTS[chartKey].source;
		const runner = this.db.createQueryRunner();
		let locked = false;
		try {
			await runner.connect();
			const lock = await runner.query('SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS locked', ['pubo-kpop-source', source]);
			locked = lock[0]?.locked === true;
			if (!locked) return { deferUntil: Date.now() + 30000 };
			const states = runner.manager.getRepository(MiKpopChartState);
			const chart = await states.findOneBy({ key: chartKey }) ?? initialKpopState(chartKey, source, chartKey);
			const gate = await states.findOneBy({ key: `source:${source}` }) ?? initialKpopState(`source:${source}`, source, null);
			const checkedAt = new Date();
			const decision = kpopCollectionGate(chart, gate, checkedAt.getTime(), slot);
			if (decision !== 'run') return decision === 'skip' ? undefined : decision;
			// Persist the logical slot before any HTTP. A crash cannot replay a request
			// from this slot on another worker; following hourly slots remain eligible.
			await states.save({ ...chart, checkedAt, lastSlotAt: new Date(slot) });
			let outcome: Outcome;
			try {
				const result = await fetchKpopChart(chartKey, this.http);
				outcome = { snapshot: result.snapshot, robots: result.robotsAudit };
			} catch (error) {
				outcome = { diagnostic: error instanceof KpopSourceError ? error.diagnostic : safeKpopDiagnostic(), robots: error instanceof KpopSourceError ? error.robotsAudit : [] };
			}
			await runner.startTransaction();
			try { await this.persist(runner.manager, chartKey, outcome, checkedAt); await runner.commitTransaction(); } catch (error) { await runner.rollbackTransaction(); throw error; }
		} finally {
			try { if (locked) await runner.query('SELECT pg_advisory_unlock(hashtext($1), hashtext($2))', ['pubo-kpop-source', source]); } finally { await runner.release(); }
		}
		this.cache.clear();
		return undefined;
	}

	/** Used by the collector and isolated persistence tests; never exposed as API. */
	public async recordOutcome(chartKey: KpopChartKey, outcome: Outcome, checkedAt: Date): Promise<void> {
		if (!Object.hasOwn(KPOP_CHARTS, chartKey)) throw new Error('Invalid K-pop chart');
		await this.db.transaction(async manager => {
			await manager.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', ['pubo-kpop-source', KPOP_CHARTS[chartKey].source]);
			await this.persist(manager, chartKey, outcome, checkedAt);
		});
		this.cache.clear();
	}

	private async persist(manager: EntityManager, key: KpopChartKey, outcome: Outcome, checkedAt: Date): Promise<void> {
		if (!Object.hasOwn(KPOP_CHARTS, key) || !Number.isFinite(checkedAt.getTime())) throw new Error('Invalid K-pop outcome');
		const source = KPOP_CHARTS[key].source;
		const robots = (Array.isArray(outcome.robots) ? outcome.robots : []).slice(0, 8).filter(audit => audit && audit.source === source && allowedKpopUrl(source, audit.url)
			&& /^[a-f0-9]{64}$/.test(audit.robotsHash) && Number.isFinite(Date.parse(audit.checkedAt)) && audit.checkedAt.length <= 32
			&& Number.isFinite(audit.crawlDelaySeconds) && audit.crawlDelaySeconds >= 0 && audit.crawlDelaySeconds <= 86400
			&& Number.isInteger(audit.httpStatus) && audit.httpStatus >= 100 && audit.httpStatus <= 599
			&& (audit.allowed === null || typeof audit.allowed === 'boolean')).map(audit => ({ source, url: audit.url, checkedAt: new Date(audit.checkedAt).toISOString(),
			robotsHash: audit.robotsHash, mode: 'record' as const, allowed: audit.allowed, crawlDelaySeconds: audit.crawlDelaySeconds, httpStatus: audit.httpStatus }));
		outcome = 'snapshot' in outcome ? { snapshot: outcome.snapshot, robots } : { diagnostic: sanitizeKpopDiagnostic(outcome.diagnostic), robots };
		const states = manager.getRepository(MiKpopChartState);
		const snapshots = manager.getRepository(MiKpopChartSnapshot);
		const chart = await states.findOneBy({ key }) ?? initialKpopState(key, source, key);
		const gate = await states.findOneBy({ key: `source:${source}` }) ?? initialKpopState(`source:${source}`, source, null);
		if (chart.disabled || gate.disabled || (chart.checkedAt?.getTime() ?? 0) > checkedAt.getTime() || (gate.checkedAt?.getTime() ?? 0) > checkedAt.getTime()) return;
		const previous = chart.latestSnapshotId ? await snapshots.findOneBy({ id: chart.latestSnapshotId }) : null;
		if ('snapshot' in outcome) {
			const snapshot = outcome.snapshot;
			assertKpopSnapshot(snapshot);
			if (snapshot.chartKey !== key || snapshot.source !== source || snapshot.entries.length !== KPOP_CHARTS[key].expectedCount || Date.parse(snapshot.observedAt) > checkedAt.getTime() + 600000) throw new Error('Invalid K-pop snapshot');
			let decision = snapshotDecision(previous, snapshot);
			if (previous && previous.contentHash !== snapshot.contentHash
				&& (decision === 'conflict' || decision === 'new' && !previous.sourcePeriod && !snapshot.sourcePeriod)) {
				const stored = await manager.getRepository(MiKpopChartEntry).find({ where: { snapshotId: previous.id }, order: { rank: 'ASC' }, take: 201 });
				try {
					decision = snapshotDecision({ ...previous, contentHash: reclassifiedKpopHash(previous, stored) }, snapshot);
				} catch (error) {
					// If the old payload cannot be revalidated, keep the original strict
					// conflict/new decision; never excuse a real content change.
					if (!(error instanceof KpopSourceError)) throw error;
				}
			}
			if (decision === 'old') return;
			if (decision === 'conflict') outcome = { diagnostic: safeKpopDiagnostic(), robots: outcome.robots };
			else if (gate.status !== 'available' && (gate.nextAttemptAt?.getTime() ?? 0) > checkedAt.getTime()) return;
			else {
				if (decision === 'new') {
					const id = randomUUID();
					await snapshots.insert({ id, chartKey: key, source, periodKey: snapshot.sourcePeriod ? `source:${snapshot.sourcePeriod}` : `observation:${snapshot.observedAt}`,
						sourcePeriod: snapshot.sourcePeriod, sourceUpdatedAt: snapshot.sourceUpdatedAt ? new Date(snapshot.sourceUpdatedAt) : null, sourceDate: snapshot.sourceDate,
						observedAt: new Date(snapshot.observedAt), coverage: snapshot.coverage, rankBasis: snapshot.rankBasis, expectedCount: snapshot.expectedCount,
						sourceTotal: snapshot.sourceTotal, contentHash: snapshot.contentHash, rawHash: snapshot.rawHash });
					await manager.getRepository(MiKpopChartEntry).insert(snapshot.entries.map(entry => ({ ...entry, snapshotId: id })));
					chart.latestSnapshotId = id;
					chart.lastChangedAt = checkedAt;
				}
				await states.save([{ ...chart, checkedAt, lastSuccessAt: checkedAt, status: 'available', diagnostic: null, failureCount: 0,
					nextAttemptAt: new Date(Math.max(chart.nextAttemptAt?.getTime() ?? 0, checkedAt.getTime() + KPOP_HOUR_MS)), robots: outcome.robots },
				{ ...gate, checkedAt, lastSuccessAt: checkedAt, status: 'available', diagnostic: null, failureCount: 0, nextAttemptAt: null, robots: outcome.robots }]);
				await snapshots.createQueryBuilder().delete().where('"chartKey" = :key AND "observedAt" < :before AND "id" != :latest',
					{ key, before: new Date(checkedAt.getTime() - KPOP_RETENTION_MS), latest: chart.latestSnapshotId }).execute();
				return;
			}
		}
		const next = kpopBackoff(gate, outcome.diagnostic, checkedAt.getTime());
		await states.save([{ ...chart, checkedAt, status: failureStatus(outcome.diagnostic), diagnostic: outcome.diagnostic,
			failureCount: chart.failureCount + 1, nextAttemptAt: new Date(Math.max(next, chart.nextAttemptAt?.getTime() ?? 0)), robots: outcome.robots },
		{ ...gate, checkedAt, status: failureStatus(outcome.diagnostic), diagnostic: outcome.diagnostic,
			failureCount: gate.failureCount + 1, nextAttemptAt: new Date(next), robots: outcome.robots }]);
	}
}
