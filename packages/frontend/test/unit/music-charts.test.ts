/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import { puboMusicChartsZhCN } from '../../../i18n/src/pubo-music-charts-zh-cn.js';
import { formatMusicChartPeriod, musicChartChange, musicChartPoints, musicChartReferenceHasResult, musicChartRows, musicChartUsesReference } from '@/utility/music-charts.js';
import { musicChartAccessibleLabel, musicChartCompactAccessibleResult, musicChartCompactResult, musicChartIsPreviousResult, musicChartLabel, musicChartRankLabel, musicChartReferenceFailure, musicChartReferenceResult, musicChartReferenceScope, musicChartReferenceStatus, musicChartShortLabel, musicChartStatusLabel } from '@/utility/music-chart-labels.js';
import { i18n } from '@/i18n.js';
import type { MusicChartReference, MusicChartSummary } from '@/utility/music-charts.js';

describe('music chart display truthfulness', () => {
	it('keeps five audio chart entries in the required order without manufacturing a rank or comparison', () => {
		const rows = musicChartRows(null);
		expect(rows.map(row => row.key)).toEqual(['melon-daily', 'melon-hot100', 'melon-top100', 'genie-realtime', 'bugs-realtime']);
		expect(rows.map(row => row.maxRank)).toEqual([100, 100, 100, 200, 100]);
		expect(rows.map(row => row.periodHours)).toEqual([24, 1, 1, 1, 1]);
		expect(rows.map(row => row.sourceUrl)).toEqual([
			'https://www.melon.com/chart/day/index.htm',
			'https://www.melon.com/chart/hot100/index.htm',
			'https://www.melon.com/chart/index.htm',
			'https://www.genie.co.kr/chart/top200?ditc=D&rtm=Y',
			'https://music.bugs.co.kr/chart/track/realtime/total',
		]);
		for (const row of rows) {
			expect(row.rank).toBeNull();
			expect(row.reference).toBeNull();
			expect(musicChartChange(row)).toBeNull();
			expect(musicChartRankLabel(row)).toBe(i18n.ts._musicCharts.placeholder);
			expect(musicChartStatusLabel(row)).toBe(i18n.ts._musicCharts.pending);
		}
	});

	it('ignores a retired MV observation and never reuses it as the new Genie audio chart', () => {
		const legacy = { ...musicChartRows(null)[0], key: 'genie-mv-daily', rank: 1, result: 'ranked', status: 'available' };
		const rows = musicChartRows({ charts: [legacy] } as unknown as MusicChartSummary);
		expect(rows).toHaveLength(5);
		expect(rows.every(row => row.rank === null && row.status === 'pending')).toBe(true);
	});

	it('uses Korean chart time, including day boundaries, separately from fetch time', () => {
		expect(formatMusicChartPeriod('2026-10-14T15:00:00.000Z')).toBe('2026-10-15 00:00');
		expect(formatMusicChartPeriod('2026-10-14T15:00:00.000Z', true)).toBe('2026-10-15');
		expect(formatMusicChartPeriod(null)).toBeNull();
		expect(formatMusicChartPeriod('not-a-date')).toBeNull();
	});

	it('does not throw when a valid retry timestamp overflows the Korean timezone date range', () => {
		const upperDate = '+275760-09-13T00:00:00.000Z';
		expect(Number.isFinite(Date.parse(upperDate))).toBe(true);
		expect(formatMusicChartPeriod(upperDate)).toBeNull();
	});

	it('keeps unranked, missing and expired samples as gaps instead of zero and does not connect across them', () => {
		const points = musicChartPoints({ chartKey: 'melon-top100', maxRank: 100, from: '2026-10-15T00:00:00.000Z', to: '2026-10-15T05:00:00.000Z', points: [
			{ period: '2026-10-15T00:00:00.000Z', result: 'ranked', rank: 1 },
			{ period: '2026-10-15T01:00:00.000Z', result: 'unranked', rank: null },
			{ period: '2026-10-15T02:00:00.000Z', result: 'missing', rank: null },
			{ period: '2026-10-15T03:00:00.000Z', result: 'out_of_scope', rank: null },
			{ period: '2026-10-15T04:00:00.000Z', result: 'ranked', rank: 100 },
			{ period: '2026-10-15T05:00:00.000Z', result: 'ranked', rank: 0 },
		] });
		expect(points.map(point => point.y)).toEqual([1, null, null, null, 100, null]);
		expect(points).toHaveLength(6);
	});

	it('plots valid Genie ranks from 101 through 200 while rejecting ranks outside the chart and fractional values', () => {
		const chartHistory = { chartKey: 'genie-realtime' as const, maxRank: 200 as const, from: '2026-10-15T00:00:00.000Z', to: '2026-10-15T07:00:00.000Z', points: [1, 100, 101, 150, 200, 201, 0, 1.5].map((rank, index) => ({ period: `2026-10-15T0${index}:00:00.000Z`, result: 'ranked' as const, rank })) };
		expect(musicChartPoints(chartHistory).map(point => point.y)).toEqual([1, 100, 101, 150, 200, null, null, null]);
		for (const chartKey of ['melon-daily', 'melon-hot100', 'melon-top100', 'bugs-realtime'] as const) {
			expect(musicChartPoints({ ...chartHistory, chartKey, maxRank: 100 }).map(point => point.y)).toEqual([1, 100, null, null, null, null, null, null]);
		}
	});

	it('distinguishes unavailable, absent and expired rather than calling each unranked', () => {
		const row = musicChartRows(null)[0];
		expect(musicChartStatusLabel({ ...row, status: 'restricted' })).toBe(i18n.ts._musicCharts.restricted);
		expect(musicChartStatusLabel({ ...row, status: 'unavailable' })).toBe(i18n.ts._musicCharts.unavailable);
		expect(musicChartStatusLabel({ ...row, status: 'stale', sourcePeriod: '2026-10-15T00:00:00.000Z' })).toBe(i18n.ts._musicCharts.lastResult);
		expect(musicChartRankLabel({ ...row, result: 'unranked' })).toBe(i18n.ts._musicCharts.unranked);
		expect(musicChartRankLabel({ ...row, result: 'out_of_scope' })).toBe(i18n.ts._musicCharts.outOfScope);
	});

	it('compares actual ranked observations only', () => {
		const row = { ...musicChartRows(null)[0], result: 'ranked' as const, rank: 10, previousRank: 15 };
		expect(musicChartChange(row)).toBe(5);
		expect(musicChartChange({ ...row, previousRank: 8 })).toBe(-2);
		expect(musicChartChange({ ...row, previousRank: null })).toBeNull();
		expect(musicChartChange({ ...row, result: 'unranked', rank: null })).toBeNull();
	});

	it('preserves complete chart names alongside distinct short labels', () => {
		const rows = musicChartRows(null);
		expect(new Set(rows.map(row => musicChartShortLabel(row.key))).size).toBe(5);
		expect(musicChartShortLabel('melon-hot100')).toBe(i18n.ts._musicCharts.shortMelonHot100);
		expect(musicChartLabel('melon-hot100')).toBe(i18n.ts._musicCharts.melonHot100);
		expect(musicChartLabel('genie-realtime')).toBe(i18n.ts._musicCharts.genieRealtime);
		expect(musicChartAccessibleLabel('melon-hot100')).toContain(i18n.ts._musicCharts.hot100Scope);
		expect(musicChartAccessibleLabel('melon-daily')).toContain(i18n.tsx._musicCharts.chartRange({ maxRank: 100 }));
		expect(musicChartAccessibleLabel('genie-realtime')).toBe(i18n.ts._musicCharts.genieRealtime);
	});

	it('never presents loading, pending or failed collection as an absent song', () => {
		const row = musicChartRows(null)[0];
		expect(musicChartCompactResult(row, { loading: true })).toBe(i18n.ts._musicCharts.compactLoading);
		expect(musicChartCompactResult(row)).toBe(i18n.ts._musicCharts.compactPending);
		expect(musicChartCompactResult({ ...row, status: 'restricted' })).toBe(i18n.ts._musicCharts.compactRestricted);
		expect(musicChartCompactResult(row, { failed: true })).toBe(i18n.ts._musicCharts.compactUnavailable);
		expect(musicChartCompactResult({ ...row, status: 'unavailable' })).toBe(i18n.ts._musicCharts.compactUnavailable);
		expect(musicChartCompactResult({ ...row, result: 'unranked' })).not.toBe(i18n.ts._musicCharts.unranked);
		expect(puboMusicChartsZhCN.compactRestricted).toBe('未接通');
		expect(musicChartCompactAccessibleResult({ ...row, status: 'restricted' })).toBe(i18n.ts._musicCharts.restricted);
	});

	it('labels both ranked and unranked cached observations when the source or refresh fails', () => {
		const ranked = { ...musicChartRows(null)[3], status: 'available' as const, result: 'ranked' as const, rank: 200, sourcePeriod: '2026-10-15T00:00:00.000Z' };
		const unranked = { ...ranked, result: 'unranked' as const, rank: null };
		expect(musicChartCompactResult(ranked)).toBe(i18n.tsx._musicCharts.compactRank({ rank: 200 }));
		expect(musicChartCompactResult(unranked)).toBe(i18n.ts._musicCharts.unranked);
		for (const status of ['restricted', 'unavailable', 'stale', 'pending'] as const) {
			expect(musicChartIsPreviousResult({ ...ranked, status })).toBe(true);
			expect(musicChartCompactResult({ ...ranked, status })).toBe(i18n.tsx._musicCharts.compactPrevious({ result: i18n.tsx._musicCharts.compactRank({ rank: 200 }) }));
			expect(musicChartCompactResult({ ...unranked, status })).toBe(i18n.tsx._musicCharts.compactPrevious({ result: i18n.ts._musicCharts.unranked }));
		}
		expect(musicChartIsPreviousResult(ranked, true)).toBe(true);
		expect(musicChartCompactResult(unranked, { failed: true })).toBe(i18n.tsx._musicCharts.compactPrevious({ result: i18n.ts._musicCharts.unranked }));
		expect(musicChartCompactResult(ranked, { failed: true })).toBe(i18n.tsx._musicCharts.compactPrevious({ result: i18n.tsx._musicCharts.compactRank({ rank: 200 }) }));
	});

	it('shows known HOT100 expiry without manufacturing an official chart period or rank', () => {
		const expired = { ...musicChartRows(null)[1], status: 'available' as const, result: 'out_of_scope' as const };
		expect(expired.sourcePeriod).toBeNull();
		expect(musicChartCompactResult(expired)).toBe(i18n.ts._musicCharts.compactOutOfScope);
		expect(musicChartIsPreviousResult(expired)).toBe(false);
		expect(musicChartCompactResult(expired, { failed: true })).toBe(i18n.tsx._musicCharts.compactPrevious({ result: i18n.ts._musicCharts.compactOutOfScope }));
	});
});

describe('third-party references remain distinct from official observations', () => {
	const reference: MusicChartReference = {
		provider: 'chartradar', sourceUrl: 'https://www.chartradar.app/charts/genie', scope: 'reference-top200', status: 'available', result: 'ranked', rank: 200,
		sourceTimeLabel: '10:00', sourceFetchedAt: '2026-10-16T01:05:00.000Z', checkedAt: '2026-10-16T01:06:00.000Z', lastSuccessAt: '2026-10-16T01:06:00.000Z', basis: 'title_artist',
		diagnostic: null, nextAttemptAt: '2026-10-16T02:06:00.000Z',
	};
	const row = { ...musicChartRows(null)[3], status: 'restricted' as const, reference };

	it('shows a labelled reference without manufacturing an official rank, period, change or history point', () => {
		expect(musicChartCompactResult(row)).toBe(i18n.tsx._musicCharts.referenceRank({ rank: 200 }));
		expect(musicChartRankLabel(row)).toBe(i18n.ts._musicCharts.placeholder);
		expect(musicChartChange(row)).toBeNull();
		expect(row.rank).toBeNull();
		expect(row.sourcePeriod).toBeNull();
		expect(row.peakRank).toBeNull();
		expect(reference.sourceTimeLabel).toBe('10:00');
		expect(musicChartPoints({ chartKey: row.key, maxRank: row.maxRank, from: reference.checkedAt!, to: reference.checkedAt!, points: [] })).toEqual([]);
	});

	it('prefers current official ranked, unranked and eligibility results over references', () => {
		const official = { ...row, status: 'available' as const, result: 'ranked' as const, rank: 50, sourcePeriod: '2026-10-16T01:00:00.000Z' };
		expect(musicChartUsesReference(official)).toBe(false);
		expect(musicChartCompactResult(official)).toBe(i18n.tsx._musicCharts.compactRank({ rank: 50 }));
		expect(musicChartCompactResult({ ...official, result: 'unranked', rank: null })).toBe(i18n.ts._musicCharts.unranked);
		const expired = { ...musicChartRows(null)[1], status: 'available' as const, result: 'out_of_scope' as const, reference };
		expect(musicChartUsesReference(expired)).toBe(false);
		expect(musicChartCompactResult(expired)).toBe(i18n.ts._musicCharts.compactOutOfScope);
		expect(musicChartUsesReference({ ...expired, status: 'restricted' })).toBe(false);
		expect(musicChartUsesReference({ ...expired, result: 'unknown' })).toBe(false);
	});

	it('uses a reference instead of an obsolete official observation without overwriting that observation', () => {
		const oldOfficial = { ...row, result: 'ranked' as const, rank: 30, sourcePeriod: '2026-10-15T01:00:00.000Z' };
		expect(musicChartCompactResult(oldOfficial)).toBe(i18n.tsx._musicCharts.referenceRank({ rank: 200 }));
		expect(musicChartRankLabel(oldOfficial)).toBe(i18n.tsx._musicCharts.rank({ rank: 30 }));
		expect(musicChartIsPreviousResult(oldOfficial)).toBe(true);
	});

	it('marks retained ranks and missing reference entries as previous after source or frontend failures', () => {
		for (const status of ['stale', 'unavailable', 'restricted'] as const) {
			const oldReference = { ...reference, status };
			expect(musicChartCompactResult({ ...row, reference: oldReference })).toBe(i18n.tsx._musicCharts.compactPrevious({ result: i18n.tsx._musicCharts.referenceRank({ rank: 200 }) }));
			expect(musicChartReferenceResult({ ...oldReference, result: 'not_found', rank: null })).toBe(i18n.tsx._musicCharts.compactPrevious({ result: i18n.ts._musicCharts.referenceNotFound }));
		}
		expect(musicChartCompactResult(row, { failed: true })).toBe(i18n.tsx._musicCharts.compactPrevious({ result: i18n.tsx._musicCharts.referenceRank({ rank: 200 }) }));
		expect(musicChartReferenceResult({ ...reference, result: 'not_found', rank: null }, true)).toBe(i18n.tsx._musicCharts.compactPrevious({ result: i18n.ts._musicCharts.referenceNotFound }));
		expect(musicChartReferenceStatus(reference, true)).toBe(i18n.ts._musicCharts.refreshFailed);
	});

	it('never calls a complete reference absence official unranked, and does not use unknown or invalid reference ranks', () => {
		expect(musicChartCompactResult({ ...row, reference: { ...reference, result: 'not_found', rank: null } })).toBe(i18n.ts._musicCharts.referenceNotFound);
		expect(musicChartCompactResult({ ...row, reference: { ...reference, result: 'unknown', rank: null } })).toBe(i18n.ts._musicCharts.compactRestricted);
		for (const rank of [0, 201, 1.5, NaN]) expect(musicChartReferenceHasResult({ ...reference, rank })).toBe(false);
		expect(musicChartReferenceHasResult({ ...reference, scope: 'top100', rank: 101 })).toBe(false);
		expect(musicChartReferenceHasResult({ ...reference, scope: 'top100', rank: 100 })).toBe(true);
		expect(musicChartCompactResult(row, { loading: true })).toBe(i18n.ts._musicCharts.compactLoading);
	});

	it('includes provider and reference-only scope in accessible labels and distinguishes source failures', () => {
		expect(musicChartCompactAccessibleResult(row)).toContain('ChartRadar');
		expect(musicChartCompactAccessibleResult(row)).toContain(i18n.ts._musicCharts.referenceTop200);
		expect(musicChartReferenceScope({ ...reference, scope: 'top100' })).toBe(i18n.ts._musicCharts.referenceTop100);
		expect(musicChartReferenceStatus({ ...reference, status: 'restricted' })).toBe(i18n.ts._musicCharts.referenceRestricted);
		expect(musicChartReferenceStatus({ ...reference, status: 'stale' })).toBe(i18n.ts._musicCharts.referenceStale);
		expect(musicChartReferenceStatus({ ...reference, status: 'unavailable' })).toBe(i18n.ts._musicCharts.referencePaused);
	});

	it('does not guess old failure causes or label ordinary expiry as a failed request', () => {
		for (const status of ['restricted', 'unavailable'] as const) {
			expect(musicChartReferenceFailure({ ...reference, status, diagnostic: null })).toBe(i18n.ts._musicCharts.referenceFailureUnknown);
		}
		expect(musicChartReferenceFailure({ ...reference, status: 'stale', diagnostic: null })).toBeNull();
		expect(musicChartReferenceFailure(reference)).toBeNull();
	});

	it.each([
		['robots_denied', 'failureRobotsDenied'],
		['robots_invalid', 'failureRobotsInvalid'],
		['http_401', 'failureUnauthorized'],
		['http_403', 'failureForbidden'],
		['http_429', 'failureRateLimited'],
		['timeout', 'failureTimeout'],
		['redirect', 'failureRedirect'],
		['content_type', 'failureContentType'],
		['invalid_payload', 'failureInvalidPayload'],
		['http_error', 'failureHttpError'],
		['network_error', 'failureNetworkError'],
		['response_too_large', 'failureTooLarge'],
	] as const)('explains the fixed %s cause while retaining a previous reference rank', (reason, key) => {
		const paused: MusicChartReference = { ...reference, status: 'restricted', diagnostic: { phase: 'page', reason, httpStatus: null, retryAfterAt: null, elapsedMs: 10 } };
		const pausedRow = { ...row, reference: paused };
		expect(musicChartReferenceFailure(paused)).toBe(i18n.tsx._musicCharts.referenceFailureDetail({ phase: i18n.ts._musicCharts.failurePhasePage, reason: i18n.ts._musicCharts[key] }));
		expect(musicChartCompactResult(pausedRow)).toBe(i18n.tsx._musicCharts.compactPrevious({ result: i18n.tsx._musicCharts.referenceRank({ rank: 200 }) }));
		expect(musicChartRankLabel(pausedRow)).toBe(i18n.ts._musicCharts.placeholder);
	});

	it('identifies the failed stage without exposing raw errors and clears it after success', () => {
		const diagnostic = { phase: 'robots' as const, reason: 'timeout' as const, httpStatus: null, retryAfterAt: null, elapsedMs: 10, rawError: 'PRIVATE_RAW_MESSAGE' };
		const paused = { ...reference, status: 'unavailable' as const, diagnostic };
		expect(musicChartReferenceFailure(paused)).toContain(i18n.ts._musicCharts.failurePhaseRobots);
		expect(musicChartReferenceFailure({ ...paused, diagnostic: { ...diagnostic, phase: 'parse' } })).toContain(i18n.ts._musicCharts.failurePhaseParse);
		expect(musicChartReferenceFailure(paused)).not.toContain(diagnostic.rawError);
		expect(musicChartReferenceFailure({ ...paused, status: 'available' })).toBeNull();
	});
});
