/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialKpopState, kpopBackoff, kpopCollectionGate, packKpopChart, snapshotDecision, selectKpopSeries, sanitizeKpopDiagnostic } from '@/core/kpop-charts/state.js';
import { enabledKpopKeys, KPOP_HOUR_MS, KPOP_KEYS, kpopJobSlot, kpopSchedule, nextKpopSlot } from '@/core/kpop-charts/schedule.js';
import type { KpopDiagnostic, KpopSnapshot } from '@/core/kpop-charts/types.js';
import type { MiKpopChartSnapshot } from '@/models/KpopChartSnapshot.js';

const now = Date.parse('2026-10-17T10:05:00Z');
const diagnostic: KpopDiagnostic = { phase: 'page', reason: 'http_403', httpStatus: 403, elapsedMs: 1, retryAfterAt: null };
afterEach(() => vi.unstubAllEnvs());
describe('K-pop persistent gate and fixed hourly slots', () => {
	it('has eleven stable hourly slots and empty default allowlist', () => {
		vi.stubEnv('PUBO_KPOP_CHARTS_KEYS', '');
		expect(enabledKpopKeys()).toEqual([]);
		expect(KPOP_KEYS.map(key => kpopSchedule(key).pattern)).toEqual(Array.from({ length: 11 }, (_, i) => `0 ${5 + i * 2} * * * *`));
		expect(enabledKpopKeys('spotify,invalid,melon-top100,spotify')).toEqual(['melon-top100', 'spotify']);
	});
	it('never schedules immediately even exactly on a slot; validates persisted job IDs', () => {
		expect(nextKpopSlot('melon-daily', now)).toBe(now + KPOP_HOUR_MS);
		expect(kpopJobSlot('melon-daily', `repeat:melon-daily:${now}`)).toBe(now);
		expect(kpopJobSlot('melon-daily', `repeat:melon-daily:${now + 1}`)).toBeNull();
		expect(kpopJobSlot('melon-daily', `repeat:spotify:${now}`)).toBeNull();
	});
	it('uses 1/2/4/8/24-hour temporary backoff and preserves a longer pause', () => {
		for (let i = 0; i < 7; i++) expect(kpopBackoff({ failureCount: i, nextAttemptAt: null }, diagnostic, now) - now).toBe([1, 2, 4, 8, 24, 24, 24][i] * KPOP_HOUR_MS);
		const later = now + 50 * KPOP_HOUR_MS;
		expect(kpopBackoff({ failureCount: 0, nextAttemptAt: new Date(later) }, diagnostic, now)).toBe(later);
		expect(kpopBackoff({ failureCount: 0, nextAttemptAt: null }, { ...diagnostic, retryAfterAt: new Date(later).toISOString() }, now)).toBe(later);
	});
	it.each(['http_401', 'access_challenge'] as const)('keeps %s at least 24 hours', reason => {
		expect(kpopBackoff({ failureCount: 0, nextAttemptAt: null }, { ...diagnostic, reason }, now)).toBe(now + 24 * KPOP_HOUR_MS);
	});
	it('defers a boundary instead of skipping an entire hour, but not long pauses', () => {
		const chart = initialKpopState('melon-daily', 'melon', 'melon-daily');
		const source = initialKpopState('source:melon', 'melon', null);
		chart.status = 'available'; source.status = 'available'; chart.nextAttemptAt = new Date(now + 50);
		expect(kpopCollectionGate(chart, source, now, now)).toEqual({ deferUntil: now + 50 });
		expect(kpopCollectionGate(chart, source, now + 50, now)).toBe('run');
		source.status = 'restricted';
		expect(kpopCollectionGate(chart, source, now, now)).toBe('skip');
		source.status = 'available';
		expect(kpopCollectionGate(chart, source, now + KPOP_HOUR_MS, now)).toBe('skip');
		source.nextAttemptAt = new Date(now + 24 * KPOP_HOUR_MS);
		expect(kpopCollectionGate(chart, source, now, now)).toBe('skip');
	});
	it('preserves manual disable, claimed slots, and source-wide exclusion', () => {
		const chart = initialKpopState('melon-daily', 'melon', 'melon-daily');
		const source = initialKpopState('source:melon', 'melon', null);
		source.disabled = true;
		expect(kpopCollectionGate(chart, source, now, now)).toBe('skip');
		source.disabled = false; chart.lastSlotAt = new Date(now);
		expect(kpopCollectionGate(chart, source, now + KPOP_HOUR_MS, now)).toBe('skip');
		expect(kpopCollectionGate(chart, source, now, now + KPOP_HOUR_MS)).toBe('skip');
	});
});
describe('K-pop source clocks and duplicate decisions', () => {
	const previous = { sourcePeriod: '2026-10-16', sourceUpdatedAt: null, observedAt: new Date(now - KPOP_HOUR_MS), contentHash: 'a' } as MiKpopChartSnapshot;
	it('rejects older response/period and conflicting same-period data', () => {
		const next = { sourcePeriod: '2026-10-16', observedAt: new Date(now).toISOString(), contentHash: 'a' } as KpopSnapshot;
		expect(snapshotDecision(previous, next)).toBe('duplicate');
		expect(snapshotDecision(previous, { ...next, contentHash: 'b' })).toBe('conflict');
		expect(snapshotDecision(previous, { ...next, sourcePeriod: '2026-10-15' })).toBe('old');
		expect(snapshotDecision(previous, { ...next, observedAt: new Date(now - 2 * KPOP_HOUR_MS).toISOString() })).toBe('old');
		expect(snapshotDecision(previous, { ...next, sourcePeriod: '2026-10-17' })).toBe('new');
	});
	it('does not invent a period for unchanged observation-only data', () => {
		expect(snapshotDecision({ ...previous, sourcePeriod: null }, { sourcePeriod: null, contentHash: 'a', observedAt: new Date(now).toISOString() } as KpopSnapshot)).toBe('duplicate');
	});
	it('ages daily data by its real source date without inventing sourceUpdatedAt', () => {
		const chart = initialKpopState('melon-daily', 'melon', 'melon-daily');
		const source = initialKpopState('source:melon', 'melon', null);
		chart.status = 'available'; chart.lastSuccessAt = new Date(now);
		const packed = packKpopChart('melon-daily', chart, source, { ...previous, sourceDate: '2026-10-01' } as MiKpopChartSnapshot, now, true);
		expect(packed.status).toBe('stale');
		expect(packed.sourceUpdatedAt).toBeNull();
		expect(packed.sourcePeriod).toBe('2026-10-16');
	});
});

describe('Consistent K-pop series and diagnostic projection', () => {
	it('excludes recently fetched old periods and mixed basis/coverage from seven-day comparison', () => {
		const current = { id: 'current', chartKey: 'melon-top100', sourcePeriod: new Date(now).toISOString(), sourceUpdatedAt: new Date(now), observedAt: new Date(now), coverage: 'complete', rankBasis: 'official_rank' } as MiKpopChartSnapshot;
		const rows = [current, { ...current, id: 'old-period', sourceUpdatedAt: new Date(now - 8 * 86400000) }, { ...current, id: 'unknown', sourcePeriod: null, sourceUpdatedAt: null }, { ...current, id: 'preview', coverage: 'preview' }];
		expect(selectKpopSeries(rows, current, now - 7 * 86400000, now).map(row => row.id)).toEqual(['current']);
	});
	it('uses successful-read age for unknown periods without changing content clocks', () => {
		const chart = initialKpopState('flo', 'flo', 'flo'); chart.status = 'available'; chart.lastSuccessAt = new Date(now);
		const source = initialKpopState('source:flo', 'flo', null);
		const snapshot = { sourcePeriod: null, sourceUpdatedAt: null, sourceDate: '2020-01-01', observedAt: new Date(now - 10 * 86400000) } as MiKpopChartSnapshot;
		const result = packKpopChart('flo', chart, source, snapshot, now, true);
		expect(result.status).toBe('available'); expect(result.sourcePeriod).toBeNull(); expect(result.observedAt).toBe(snapshot.observedAt.toISOString());
		expect(packKpopChart('flo', chart, source, snapshot, now + 4 * 3600000, true).status).toBe('stale');
	});
	it('drops raw diagnostic properties and invalid status/retry/time values', () => {
		expect(sanitizeKpopDiagnostic({ ...diagnostic, raw: 'secret', httpStatus: 900, retryAfterAt: 'invalid', elapsedMs: Infinity })).toEqual({ ...diagnostic, httpStatus: null, elapsedMs: 0 });
		expect(sanitizeKpopDiagnostic({ reason: 'arbitrary message' }).reason).toBe('invalid_payload');
	});
});
