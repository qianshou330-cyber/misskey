/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import { enabledReferenceCharts, packReference, parseReferenceAttempt, validateReferenceSnapshot, REFERENCE_RETENTION_MS } from '@/core/music-charts/reference-state.js';
import type { ReferenceSnapshot } from '@/core/music-charts/reference-parser.js';

const now = new Date('2026-10-16T16:00:00.000Z');
const snapshot: ReferenceSnapshot & { lastSuccessAt: string } = { chartKey: 'melon-top100', rank: 8, result: 'ranked', sourceFetchedAt: '2026-10-16T15:00:00.000Z', sourceTimeLabel: '2026.10.17 00:00', lastSuccessAt: '2026-10-16T15:05:00.000Z' };
const attempt = { status: 'available', checkedAt: now.getTime(), nextAttemptAt: now.getTime() + 900000, failureCount: 0 };
const pack = (data = snapshot, state: unknown = attempt, at = now) => packReference(data.chartKey as 'melon-top100', JSON.stringify(data), JSON.stringify(state), at);

describe('Independent reference cache states', () => {
	it('defaults disabled and accepts only four registered keys, deduplicated', () => {
		expect(enabledReferenceCharts('')).toEqual([]);
		expect(enabledReferenceCharts('melon-hot100, arbitrary, melon-top100,melon-top100,bugs-realtime')).toEqual(['melon-top100', 'bugs-realtime']);
	});
	it('keeps ranking, title-artist basis and reference source distinct', () => {
		expect(pack()).toMatchObject({ provider: 'chartradar', sourceUrl: 'https://www.chartradar.app/charts/melon', scope: 'top100', status: 'available', rank: 8, result: 'ranked', basis: 'title_artist' });
	});
	it('returns no fabricated snapshot for missing cache or successful metadata alone', () => {
		expect(packReference('melon-top100', null, null, now)).toBeNull();
		expect(packReference('melon-top100', null, JSON.stringify(attempt), now)).toBeNull();
	});
	it('returns truthful unknown on first blocked attempt', () => {
		expect(packReference('melon-top100', null, JSON.stringify({ ...attempt, status: 'restricted' }), now)).toMatchObject({ status: 'restricted', result: 'unknown', rank: null, sourceFetchedAt: null, lastSuccessAt: null });
	});
	it('retains stale content when a subsequent request fails', () => {
		expect(pack(snapshot, { ...attempt, status: 'unavailable' })).toMatchObject({ status: 'unavailable', rank: 8, sourceFetchedAt: snapshot.sourceFetchedAt, lastSuccessAt: snapshot.lastSuccessAt });
	});
	it('hourly age becomes stale only beyond three hours', () => {
		expect(pack(snapshot, attempt, new Date('2026-10-16T18:00:00.000Z'))?.status).toBe('available');
		expect(pack(snapshot, attempt, new Date('2026-10-16T18:00:00.001Z'))?.status).toBe('stale');
	});
	it('daily age uses a separate 72-hour threshold', () => {
		const daily = { ...snapshot, chartKey: 'melon-daily' as const };
		expect(pack(daily, attempt, new Date('2026-10-19T15:00:00.000Z'))?.status).toBe('available');
		expect(pack(daily, attempt, new Date('2026-10-19T15:00:00.001Z'))?.status).toBe('stale');
	});
	it('never retains a snapshot beyond seven days from the source timestamp', () => {
		const expired = new Date(Date.parse(snapshot.sourceFetchedAt) + REFERENCE_RETENTION_MS);
		expect(pack(snapshot, attempt, expired)).toBeNull();
	});
	it('represents absence only as reference not_found and permits Genie rank 200', () => {
		expect(pack({ ...snapshot, result: 'not_found', rank: null })).toMatchObject({ result: 'not_found', rank: null });
		expect(pack({ ...snapshot, chartKey: 'genie-realtime', rank: 200 })).toMatchObject({ scope: 'reference-top200', rank: 200 });
	});
	it.each([
		{ chartKey: 'melon-hot100' }, { chartKey: '__proto__' }, { rank: 101 }, { rank: 0 }, { rank: 1.5 },
		{ sourceFetchedAt: '2026-10-16T17:00:00.000Z' }, { sourceFetchedAt: 'bad' }, { result: 'not_found', rank: 8 }, { sourceTimeLabel: '' },
	])('rejects invalid cache inputs %j', change => {
		expect(() => validateReferenceSnapshot({ ...snapshot, ...change } as ReferenceSnapshot, now)).toThrow();
		expect(pack({ ...snapshot, ...change } as typeof snapshot)).toBeNull();
	});
	it('ignores corrupt, future and expired attempt metadata', () => {
		expect(parseReferenceAttempt('not-json')).toBeNull();
		expect(parseReferenceAttempt(JSON.stringify({ ...attempt, nextAttemptAt: 1 }))).toBeNull();
		expect(packReference('melon-top100', null, JSON.stringify({ ...attempt, checkedAt: now.getTime() + 1, status: 'restricted' }), now)).toBeNull();
	});
});
