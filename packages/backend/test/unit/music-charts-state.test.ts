/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import { initialMusicChartState, applyMusicChartOutcome, packMusicChartState, musicChartHistory } from '@/core/music-charts/state.js';
import type { MiMusicChartSnapshot } from '@/models/MusicChartSnapshot.js';

const firstTime = new Date('2026-10-15T04:05:00Z');
const firstOutcome = { snapshot: { period: '2026-10-15T04:00:00Z', rank: 8, eligible: true } };

describe('Music chart observations', () => {
	it('starts unknown rather than inventing an absent rank', () => {
		const summary = packMusicChartState(initialMusicChartState('bugs-realtime'), firstTime);
		expect(summary).toMatchObject({ rank: null, result: 'unknown', status: 'pending', peakRank: null, change: null });
	});

	it('stores an actual first observation without a synthetic comparison', () => {
		const update = applyMusicChartOutcome(initialMusicChartState('bugs-realtime'), firstOutcome, firstTime)!;
		expect(update.state).toMatchObject({ rank: 8, previousRank: null, peakRank: 8, monitorStartedAt: firstTime });
		expect(update.snapshot).toMatchObject({ rank: 8, sourcePeriod: new Date(firstOutcome.snapshot.period) });
		expect(update.state.nextAttemptAt!.getTime() - firstTime.getTime()).toBe(3600000);
	});
	it('preserves the original transient retry backoff independently of hourly collection', () => {
		const hourly = applyMusicChartOutcome(initialMusicChartState('bugs-realtime'), { failure: 'unavailable' }, firstTime)!.state;
		const daily = applyMusicChartOutcome(initialMusicChartState('melon-daily'), { failure: 'unavailable' }, firstTime)!.state;
		expect(hourly.nextAttemptAt!.getTime() - firstTime.getTime()).toBe(900000);
		expect(daily.nextAttemptAt!.getTime() - firstTime.getTime()).toBe(3600000);
	});
	it('does not loosen the existing successful-data freshness threshold when collection becomes hourly', () => {
		const state = applyMusicChartOutcome(initialMusicChartState('bugs-realtime'), firstOutcome, firstTime)!.state;
		expect(packMusicChartState(state, new Date(firstTime.getTime() + 3600000)).status).toBe('available');
		expect(packMusicChartState(state, new Date(firstTime.getTime() + 3600001)).status).toBe('stale');
	});

	it('does not replace a newer result with a delayed success or error', () => {
		const state = applyMusicChartOutcome(initialMusicChartState('bugs-realtime'), firstOutcome, firstTime)!.state;
		expect(applyMusicChartOutcome(state, { failure: 'restricted' }, new Date(firstTime.getTime() - 1))).toBeNull();
		expect(applyMusicChartOutcome(state, firstOutcome, firstTime)).toBeNull();
	});

	it('retains valid rank and source period when access becomes restricted', () => {
		const state = applyMusicChartOutcome(initialMusicChartState('bugs-realtime'), firstOutcome, firstTime)!.state;
		const failedAt = new Date('2026-10-15T05:05:00Z');
		const update = applyMusicChartOutcome(state, { failure: 'restricted' }, failedAt)!;
		expect(update.snapshot).toBeNull();
		expect(update.state).toMatchObject({ rank: 8, result: 'ranked', status: 'restricted', lastSuccessAt: firstTime });
		expect(update.state.sourcePeriod).toEqual(state.sourcePeriod);
		expect(update.state.nextAttemptAt!.getTime() - failedAt.getTime()).toBe(24 * 3600000);
	});

	it('treats an older source period as a failure without adding a point', () => {
		const state = applyMusicChartOutcome(initialMusicChartState('bugs-realtime'), firstOutcome, firstTime)!.state;
		const update = applyMusicChartOutcome(state, { snapshot: { ...firstOutcome.snapshot, period: '2026-10-15T03:00:00Z', rank: 1 } }, new Date('2026-10-15T05:05:00Z'))!;
		expect(update.state).toMatchObject({ rank: 8, peakRank: 8, status: 'unavailable' });
		expect(update.snapshot).toBeNull();
	});

	it('repeated source periods keep the original previous-period comparison', () => {
		let state = applyMusicChartOutcome(initialMusicChartState('bugs-realtime'), firstOutcome, firstTime)!.state;
		state = applyMusicChartOutcome(state, { snapshot: { ...firstOutcome.snapshot, period: '2026-10-15T05:00:00Z', rank: 3 } }, new Date('2026-10-15T05:05:00Z'))!.state;
		state = applyMusicChartOutcome(state, { snapshot: { ...firstOutcome.snapshot, period: '2026-10-15T05:00:00Z', rank: 4 } }, new Date('2026-10-15T05:20:00Z'))!.state;
		expect(packMusicChartState(state, new Date('2026-10-15T05:21:00Z'))).toMatchObject({ previousRank: 8, rank: 4, change: 4, peakRank: 3 });
	});

	it('distinguishes a validated absence and out-of-scope from a failure', () => {
		const empty = applyMusicChartOutcome(initialMusicChartState('melon-top100'), { snapshot: { ...firstOutcome.snapshot, rank: null } }, firstTime)!;
		const expired = applyMusicChartOutcome(initialMusicChartState('melon-hot100'), { ineligible: true }, firstTime)!;
		expect(empty.state).toMatchObject({ status: 'available', result: 'unranked', rank: null });
		expect(expired.state).toMatchObject({ status: 'available', result: 'out_of_scope', rank: null });
		expect(expired.snapshot).toBeNull();
		expect(expired.state.sourcePeriod).toBeNull();
		expect(expired.state.lastSuccessAt).toBeNull();
		expect(expired.state.monitorStartedAt).toBeNull();
	});

	it('expiry preserves actual historical metadata without inventing a source period', () => {
		const state = applyMusicChartOutcome(initialMusicChartState('melon-hot100'), firstOutcome, firstTime)!.state;
		const update = applyMusicChartOutcome(state, { ineligible: true }, new Date('2027-01-21T00:00:00Z'))!;
		expect(update.snapshot).toBeNull();
		expect(update.state).toMatchObject({ result: 'out_of_scope', rank: null, peakRank: 8, sourcePeriod: state.sourcePeriod, lastSuccessAt: firstTime, monitorStartedAt: firstTime });
	});

	it('does not turn a re-entry into a fake numeric rise', () => {
		const state = applyMusicChartOutcome(initialMusicChartState('bugs-realtime'), { snapshot: { ...firstOutcome.snapshot, rank: null } }, firstTime)!.state;
		const update = applyMusicChartOutcome(state, { snapshot: { ...firstOutcome.snapshot, period: '2026-10-15T05:00:00Z', rank: 12 } }, new Date('2026-10-15T05:05:00Z'))!;
		expect(packMusicChartState(update.state, new Date('2026-10-15T05:06:00Z')).change).toBeNull();
	});

	it.each([0, 101, 1.5, -1])('rejects invalid rank %s', rank => {
		expect(() => applyMusicChartOutcome(initialMusicChartState('bugs-realtime'), { snapshot: { ...firstOutcome.snapshot, rank } }, firstTime)).toThrow('Invalid music chart snapshot');
	});

	it.each([101, 150, 200])('accepts real Genie TOP200 rank %s without changing other charts to TOP200', rank => {
		const update = applyMusicChartOutcome(initialMusicChartState('genie-realtime'), { snapshot: { ...firstOutcome.snapshot, rank } }, firstTime)!;
		expect(packMusicChartState(update.state, firstTime)).toMatchObject({ rank, maxRank: 200 });
		expect(update.snapshot?.rank).toBe(rank);
		expect(() => applyMusicChartOutcome(initialMusicChartState('melon-daily'), { snapshot: { ...firstOutcome.snapshot, rank } }, firstTime)).toThrow('Invalid music chart snapshot');
	});

	it.each([0, 201, 100.5, -1])('rejects invalid Genie TOP200 rank %s', rank => {
		expect(() => applyMusicChartOutcome(initialMusicChartState('genie-realtime'), { snapshot: { ...firstOutcome.snapshot, rank } }, firstTime)).toThrow('Invalid music chart snapshot');
	});

	it('rejects future and impossible ineligible observations', () => {
		expect(() => applyMusicChartOutcome(initialMusicChartState('bugs-realtime'), { snapshot: { ...firstOutcome.snapshot, period: '2026-10-16T04:00:00Z' } }, firstTime)).toThrow();
		expect(() => applyMusicChartOutcome(initialMusicChartState('melon-hot100'), { snapshot: { ...firstOutcome.snapshot, eligible: false } }, firstTime)).toThrow();
	});

	it('backs off transient failures and resets the count after recovery', () => {
		let state = initialMusicChartState('bugs-realtime');
		for (let index = 0; index < 10; index++) state = applyMusicChartOutcome(state, { failure: 'unavailable' }, new Date(firstTime.getTime() + index * 1000))!.state;
		expect(state.nextAttemptAt!.getTime() - state.checkedAt!.getTime()).toBe(6 * 3600000);
		state = applyMusicChartOutcome(state, firstOutcome, new Date(firstTime.getTime() + 11000))!.state;
		expect(state).toMatchObject({ status: 'available', failureCount: 0, rank: 8 });
	});

	it('marks old successful data stale without fabricating a new result', () => {
		const state = applyMusicChartOutcome(initialMusicChartState('bugs-realtime'), firstOutcome, firstTime)!.state;
		expect(packMusicChartState(state, new Date('2026-10-15T08:00:00Z'))).toMatchObject({ status: 'stale', rank: 8 });
	});

	it('does not apply the hourly Melon 12-hour age bound to its daily chart', () => {
		const state = applyMusicChartOutcome(initialMusicChartState('melon-daily'), { snapshot: { ...firstOutcome.snapshot, period: '2026-10-13T15:00:00Z' } }, firstTime)!.state;
		expect(packMusicChartState(state, firstTime)).toMatchObject({ status: 'available', maxRank: 100, periodHours: 24 });
	});
});

describe('Music chart history', () => {
	it('returns an hourly grid with explicit gaps and no synthetic ranks', () => {
		const sample: MiMusicChartSnapshot = { chartKey: 'bugs-realtime', sourcePeriod: new Date(firstOutcome.snapshot.period), observedAt: firstTime, rank: 8, eligible: true };
		const result = musicChartHistory('bugs-realtime', [sample], new Date('2026-10-15T06:05:00Z'));
		expect(result.points).toHaveLength(169);
		expect(result.points.filter(point => point.result === 'ranked')).toEqual([{ period: '2026-10-15T04:00:00.000Z', rank: 8, result: 'ranked' }]);
		expect(result.points.at(-1)).toMatchObject({ result: 'missing', rank: null });
	});

	it('aligns daily periods to Korea midnight across a UTC date boundary', () => {
		const result = musicChartHistory('melon-daily', [], new Date('2026-10-15T01:05:00Z'));
		expect(result.to).toBe('2026-10-14T15:00:00.000Z');
		expect(result.points).toHaveLength(8);
		expect(result.points.every(point => point.rank === null && point.result === 'missing')).toBe(true);
	});

	it('keeps the Genie TOP200 scale and does not reuse another chart\'s coincident sample', () => {
		const other: MiMusicChartSnapshot = { chartKey: 'bugs-realtime', sourcePeriod: new Date(firstOutcome.snapshot.period), observedAt: firstTime, rank: 8, eligible: true };
		const result = musicChartHistory('genie-realtime', [other], firstTime);
		expect(result.maxRank).toBe(200);
		expect(result.points).toHaveLength(169);
		expect(result.points.every(point => point.rank === null && point.result === 'missing')).toBe(true);
		const withGenie = musicChartHistory('genie-realtime', [{ ...other, chartKey: 'genie-realtime', rank: 200 }], firstTime);
		expect(withGenie.points.find(point => point.result === 'ranked')?.rank).toBe(200);
	});
});
