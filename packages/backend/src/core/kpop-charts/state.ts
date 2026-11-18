/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { MiKpopChartState } from '@/models/KpopChartState.js';
import type { MiKpopChartSnapshot } from '@/models/KpopChartSnapshot.js';
import { KPOP_CHARTS } from './catalog.js';
import { KPOP_HOUR_MS } from './schedule.js';
import { KPOP_FAILURE_REASONS, type KpopChartKey, type KpopDiagnostic, type KpopSnapshot, type KpopSource } from './types.js';

export const KPOP_HISTORY_MS = 7 * 24 * KPOP_HOUR_MS;
export const KPOP_RETENTION_MS = 8 * 24 * KPOP_HOUR_MS;
export function initialKpopState(key: string, source: KpopSource, chartKey: KpopChartKey | null): MiKpopChartState {
	return Object.assign(new MiKpopChartState(), { key, source, chartKey, status: 'pending', disabled: false, failureCount: 0,
		checkedAt: null, lastSuccessAt: null, lastChangedAt: null, nextAttemptAt: null, lastSlotAt: null, latestSnapshotId: null, diagnostic: null, robots: [] });
}
export function kpopBackoff(current: Pick<MiKpopChartState, 'failureCount' | 'nextAttemptAt'>, diagnostic: KpopDiagnostic, now: number): number {
	const count = Math.min(5, Math.max(0, current.failureCount) + 1);
	const hours = diagnostic.reason === 'http_401' || diagnostic.reason === 'access_challenge' ? 24 : [1, 2, 4, 8, 24][count - 1];
	const retry = diagnostic.retryAfterAt ? Date.parse(diagnostic.retryAfterAt) : 0;
	return Math.max(now + hours * KPOP_HOUR_MS, current.nextAttemptAt?.getTime() ?? 0, Number.isFinite(retry) ? retry : 0);
}
export function failureStatus(diagnostic: KpopDiagnostic): 'restricted' | 'unavailable' {
	return ['http_401', 'http_403', 'http_429', 'access_challenge', 'robots_denied'].includes(diagnostic.reason) ? 'restricted' : 'unavailable';
}
export function kpopCollectionGate(chart: MiKpopChartState, source: MiKpopChartState, now: number, slot: number): 'run' | 'skip' | { deferUntil: number } {
	if (chart.disabled || source.disabled || slot > now || now >= slot + KPOP_HOUR_MS || (chart.lastSlotAt?.getTime() ?? -1) >= slot) return 'skip';
	const next = Math.max(chart.nextAttemptAt?.getTime() ?? 0, source.nextAttemptAt?.getTime() ?? 0);
	if (next <= now) return 'run';
	// Only small successful-clock skew may delay this job. Failures skip their
	// original slot, so four Melon schedules cannot converge at pause expiry.
	const successful = chart.status === 'available' && source.status === 'available';
	return successful && next - now <= 120000 && next < slot + KPOP_HOUR_MS ? { deferUntil: next } : 'skip';
}
export function snapshotDecision(previous: MiKpopChartSnapshot | null, incoming: KpopSnapshot): 'new' | 'duplicate' | 'old' | 'conflict' {
	if (!previous) return 'new';
	if (Date.parse(incoming.observedAt) < previous.observedAt.getTime()) return 'old';
	// WEEK OF is an issue label, not a publication timestamp. Keep history on
	// observation time while refusing a regressed weekly issue from the source.
	if (incoming.chartKey === 'billboard-korea-global-k-songs' && previous.sourceDate && incoming.sourceDate && incoming.sourceDate < previous.sourceDate) return 'old';
	if (previous.sourcePeriod && incoming.sourcePeriod) {
		if (incoming.sourcePeriod < previous.sourcePeriod) return 'old';
		if (incoming.sourcePeriod === previous.sourcePeriod) return incoming.contentHash === previous.contentHash ? 'duplicate' : 'conflict';
	}
	if (previous.sourceUpdatedAt && incoming.sourceUpdatedAt && Date.parse(incoming.sourceUpdatedAt) < previous.sourceUpdatedAt.getTime()) return 'old';
	if (!incoming.sourcePeriod && !previous.sourcePeriod && incoming.contentHash === previous.contentHash) return 'duplicate';
	return 'new';
}
export function safeKpopDiagnostic(): KpopDiagnostic {
	return { phase: 'parse', reason: 'invalid_payload', httpStatus: null, retryAfterAt: null, elapsedMs: 0 };
}
export function packKpopChart(key: KpopChartKey, state: MiKpopChartState, source: MiKpopChartState, snapshot: MiKpopChartSnapshot | null, now: number, enabled: boolean) {
	const definition = KPOP_CHARTS[key];
	const failure = source.checkedAt && source.status !== 'available' && (!state.checkedAt || source.checkedAt >= state.checkedAt) ? source : state;
	const ageBase = snapshot?.sourceUpdatedAt?.getTime() ?? (key === 'melon-daily' && snapshot?.sourceDate ? Date.parse(`${snapshot.sourceDate}T00:00:00+09:00`) : state.lastSuccessAt?.getTime());
	const stale = ageBase != null && now - ageBase > Math.max(3 * KPOP_HOUR_MS, definition.periodMinutes * 3 * 60000);
	const status: MiKpopChartState['status'] | 'stale' | 'disabled' = state.disabled || source.disabled || !enabled ? 'disabled' : failure.status === 'available' && stale ? 'stale' : failure.status;
	const next = Math.max(state.nextAttemptAt?.getTime() ?? 0, source.nextAttemptAt?.getTime() ?? 0);
	return {
		chartKey: key, provider: definition.source, label: definition.label, sourceUrl: definition.url,
		maxRank: definition.sourceTotal ?? definition.expectedCount, periodHours: definition.periodMinutes / 60,
		status: status as MiKpopChartState['status'] | 'stale' | 'disabled', checkedAt: failure.checkedAt?.toISOString() ?? null, lastSuccessAt: state.lastSuccessAt?.toISOString() ?? null,
		lastChangedAt: state.lastChangedAt?.toISOString() ?? null, nextAttemptAt: next ? new Date(next).toISOString() : null, diagnostic: failure.diagnostic ? sanitizeKpopDiagnostic(failure.diagnostic) : null,
		sourcePeriod: snapshot?.sourcePeriod ?? null, sourceUpdatedAt: snapshot?.sourceUpdatedAt?.toISOString() ?? null,
		sourceDate: snapshot?.sourceDate ?? null, observedAt: snapshot?.observedAt.toISOString() ?? null,
		coverage: definition.coverage, sourceTotal: definition.sourceTotal, expectedCount: definition.expectedCount, rankBasis: definition.rankBasis,
	};
}

/** Persist a fixed diagnostic contract, never upstream messages or extra keys. */
export function sanitizeKpopDiagnostic(value: unknown): KpopDiagnostic {
	if (!value || typeof value !== 'object') return safeKpopDiagnostic();
	const data = value as Partial<KpopDiagnostic>;
	if (!data.reason || !KPOP_FAILURE_REASONS.includes(data.reason) || !data.phase || !['robots', 'page', 'parse'].includes(data.phase)) return safeKpopDiagnostic();
	const retry = typeof data.retryAfterAt === 'string' && data.retryAfterAt.length <= 64 ? Date.parse(data.retryAfterAt) : NaN;
	return { phase: data.phase, reason: data.reason,
		httpStatus: Number.isInteger(data.httpStatus) && data.httpStatus! >= 100 && data.httpStatus! <= 599 ? data.httpStatus! : null,
		retryAfterAt: Number.isFinite(retry) ? new Date(retry).toISOString() : null,
		elapsedMs: Number.isSafeInteger(data.elapsedMs) && data.elapsedMs! >= 0 && data.elapsedMs! <= 600000 ? data.elapsedMs! : 0 };
}

export function kpopSnapshotCoordinate(row: MiKpopChartSnapshot): number {
	if (!row.sourcePeriod) return row.observedAt.getTime();
	return row.sourceUpdatedAt?.getTime() ?? (row.chartKey === 'melon-daily' && row.sourceDate ? Date.parse(`${row.sourceDate}T00:00:00+09:00`) : NaN);
}
/** Never compare official periods with observations, or preview with full data. */
export function selectKpopSeries(rows: MiKpopChartSnapshot[], reference: MiKpopChartSnapshot, from: number, to: number): MiKpopChartSnapshot[] {
	return rows.filter(row => row.chartKey === reference.chartKey && row.coverage === reference.coverage && row.rankBasis === reference.rankBasis
		&& Boolean(row.sourcePeriod) === Boolean(reference.sourcePeriod) && kpopSnapshotCoordinate(row) >= from && kpopSnapshotCoordinate(row) <= to)
		.sort((a, b) => kpopSnapshotCoordinate(a) - kpopSnapshotCoordinate(b));
}
