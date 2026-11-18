/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import type { KpopChartView, KpopEntry, KpopHistory } from '@/utility/kpop-charts.js';
import { kpopChartLabel, kpopDiagnostic, kpopEmpty, kpopGroups, kpopHistoryPeriod, kpopHistoryPoints, kpopHistoryResult, kpopMovement, kpopPeriodHint, kpopPlatform, kpopPlatforms, kpopPrevious, kpopScope, kpopStatus, kpopTime, kpopTopTwo, validKpopChartKey } from '@/utility/kpop-charts.js';
import { i18n } from '@/i18n.js';

function entry(rank: number, group: KpopEntry['groupIds'][number] = 'a2o-lite'): KpopEntry {
	return { songId: `synthetic-${rank}`, rank, title: `Synthetic ${rank}`, artists: [{ id: null, name: 'Synthetic artist' }], album: null, albumId: null, albumCoverUrl: null, sourceMovement: { type: 'unknown', amount: null }, groupIds: [group], previousRank: null, change: null, bestRank7d: rank };
}

function chart(overrides: Partial<KpopChartView> = {}): KpopChartView {
	return { chartKey: 'melon-top100', provider: 'melon', label: '', sourceUrl: 'https://www.melon.com/chart/index.htm', maxRank: 100, periodHours: 1, coverage: 'complete', sourceTotal: 100, expectedCount: 100, rankBasis: 'official_rank', status: 'available', checkedAt: '2026-10-17T10:00:00.000Z', lastSuccessAt: '2026-10-17T10:00:00.000Z', lastChangedAt: '2026-10-17T10:00:00.000Z', nextAttemptAt: null, diagnostic: null, sourcePeriod: null, sourceUpdatedAt: null, sourceDate: null, observedAt: '2026-10-17T10:00:00.000Z', ...overrides };
}

describe('native K-pop chart presentation', () => {
	it('registers eight platforms and thirteen groups without treating Tencent as QQ toplist 4', () => {
		expect(kpopPlatforms.map(row => row.provider)).toEqual(['melon', 'genie', 'bugs', 'flo', 'apple', 'spotify', 'tencent', 'billboard']);
		expect(kpopGroups.map(row => row.id)).toEqual(['a2o-lite', 'hearts2hearts', 'kiiikiii', 'baby-dont-cry', 'ifeye', 'babymonster', 'illit', 'meovv', 'triples', 'aespa', 'newjeans', 'le-sserafim', 'ive']);
		expect(validKpopChartKey('qq-toplist-4')).toBe('melon-top100');
	});
	it('keeps the selected Melon scope under the Melon platform and defaults invalid URLs safely', () => {
		for (const key of ['melon-hot100', 'melon-hot100-d30', 'melon-daily'] as const) expect(kpopPlatform(key).provider).toBe('melon');
		expect(validKpopChartKey(undefined)).toBe('melon-top100');
		expect(validKpopChartKey('spotify')).toBe('spotify');
	});
	it('accepts Billboard deep links and names the actual weekly chart', () => {
		const key = validKpopChartKey('billboard-korea-global-k-songs');
		expect(key).toBe('billboard-korea-global-k-songs');
		expect(kpopPlatform(key).provider).toBe('billboard');
		expect(kpopChartLabel(key)).toBe(i18n.ts._musicCharts.kpopBillboard);
		expect(kpopChartLabel(key)).toContain('Billboard Korea Global K-Songs');
	});
	it('keeps the official ranks when tracked Billboard songs are a subset of the full chart', () => {
		expect(kpopTopTwo([entry(42, 'ive'), { ...entry(1), groupIds: [] }, entry(7, 'aespa'), entry(19, 'le-sserafim')]).map(row => row.rank)).toEqual([7, 19]);
	});
	it('takes exactly the top two songs across original and added groups, not two per group', () => {
		const rows = [entry(9, 'ifeye'), entry(3), entry(1, 'babymonster'), entry(2, 'illit'), entry(5, 'meovv'), entry(4, 'triples')];
		expect(kpopTopTwo(rows).map(row => row.rank)).toEqual([1, 2]);
		expect(rows.map(row => row.rank)).toEqual([9, 3, 1, 2, 5, 4]);
		expect(kpopTopTwo([entry(1), entry(2), entry(3, 'ifeye')]).map(row => row.groupIds[0])).toEqual(['a2o-lite', 'a2o-lite']);
	});
	it.each(['aespa', 'newjeans', 'le-sserafim', 'ive'] as const)('includes %s in the homepage ranking alongside the original groups', group => {
		const rows = [entry(7, 'meovv'), entry(2, 'a2o-lite'), entry(1, group), entry(4, 'babymonster')];
		expect(kpopTopTwo(rows).map(row => row.groupIds[0])).toEqual([group, 'a2o-lite']);
		expect(rows.map(row => row.rank)).toEqual([7, 2, 1, 4]);
	});
	it('does not promote an untracked artist or an invalid rank into the homepage', () => {
		expect(kpopTopTwo([{ ...entry(1), groupIds: [] }, entry(0), entry(-2), entry(1.5), entry(4)]).map(row => row.rank)).toEqual([4]);
	});
	it('makes preview absence distinct from a complete chart without a group match', () => {
		expect(kpopEmpty(chart({ coverage: 'preview' }))).toBe(i18n.ts._musicCharts.kpopPreviewMissing);
		expect(kpopEmpty(chart())).toBe(i18n.ts._musicCharts.kpopNoMatch);
		expect(kpopEmpty(null)).toBe(i18n.ts._musicCharts.kpopNoData);
	});
	it('labels Spotify 30/50 as a partial playlist and Tencent ten as a preview of unknown total', () => {
		expect(kpopScope(chart({ coverage: 'preview', expectedCount: 30, sourceTotal: 50, rankBasis: 'playlist_order' }))).toBe(`${i18n.tsx._musicCharts.kpopPreviewCount({ count: 30, total: 50 })} · ${i18n.ts._musicCharts.kpopPlaylist}`);
		expect(kpopScope(chart({ coverage: 'preview', expectedCount: 10, sourceTotal: null }))).toBe(i18n.tsx._musicCharts.kpopPreview({ count: 10 }));
	});
	it('does not turn observation time into a source period', () => {
		const time = kpopTime(chart());
		expect(time.label).toBe(i18n.ts._musicCharts.kpopObserved);
		expect(time.value).toBe('2026-10-17 19:00');
	});
	it('keeps date-only source periods date-only and unknown times unknown', () => {
		expect(kpopTime(chart({ sourceDate: '2026-10-16' }))).toEqual({ label: i18n.ts._musicCharts.kpopSourceDate, value: '2026-10-16', datetime: null });
		expect(kpopTime(chart({ sourcePeriod: '2026-10-16' }))).toEqual({ label: i18n.ts._musicCharts.period, value: '2026-10-16', datetime: null });
		expect(kpopTime(null).datetime).toBeNull();
	});
	it('shows the Billboard issue date as a label even when ahead of observation, never as a publication instant', () => {
		const weekly = chart({ chartKey: 'billboard-korea-global-k-songs', provider: 'billboard', periodHours: 168, sourceDate: '2026-10-31', observedAt: '2026-10-28T04:00:00.000Z' });
		expect(kpopTime(weekly)).toEqual({ label: i18n.ts._musicCharts.kpopBillboardIssueDate, value: '2026-10-31', datetime: null });
		expect(kpopPeriodHint(weekly)).toBe(i18n.ts._musicCharts.kpopBillboardPeriodHint);
		expect(kpopScope(weekly)).toBe(i18n.tsx._musicCharts.kpopComplete({ count: 100 }));
		expect(kpopPeriodHint(chart({ sourcePeriod: '2026-10-17' }))).toBeNull();
		expect(kpopPeriodHint(chart())).toBe(i18n.ts._musicCharts.kpopPeriodUnknown);
	});
	it('labels retained successful results as previous after a failed refresh or source restriction', () => {
		expect(kpopPrevious(chart(), true)).toBe(true);
		expect(kpopPrevious(chart({ status: 'restricted' }))).toBe(true);
		expect(kpopPrevious(chart({ status: 'stale' }))).toBe(true);
		expect(kpopPrevious(chart({ observedAt: null, status: 'restricted' }))).toBe(false);
		expect(kpopPrevious(chart())).toBe(false);
	});
	it('does not equate unavailable, restricted, disabled and pending states', () => {
		expect(new Set(['restricted', 'unavailable', 'disabled', 'pending'].map(status => kpopStatus(chart({ status: status as KpopChartView['status'] })))).size).toBe(4);
		expect(kpopStatus(null, true)).toBe(i18n.ts._musicCharts.compactLoading);
	});
	it('uses fixed diagnostic labels without exposing arbitrary source error text', () => {
		expect(kpopDiagnostic(chart({ diagnostic: { phase: 'page', reason: 'http_403', httpStatus: 403, elapsedMs: 100, retryAfterAt: null } }))).toBe(i18n.ts._musicCharts.failureForbidden);
		expect(kpopDiagnostic(chart({ diagnostic: { phase: 'page', reason: 'access_challenge', httpStatus: 200, elapsedMs: 100, retryAfterAt: null } }))).toBe(i18n.ts._musicCharts.kpopChallenge);
		expect(kpopDiagnostic(chart({ diagnostic: { phase: 'parse', reason: 'identity_unverified', httpStatus: 200, elapsedMs: 100, retryAfterAt: null } }))).toBe(i18n.ts._musicCharts.failureInvalidPayload);
		expect(kpopDiagnostic(chart())).toBeNull();
		expect(kpopDiagnostic(chart({ chartKey: 'billboard-korea-global-k-songs', provider: 'billboard', diagnostic: { phase: 'robots', reason: 'robots_denied', httpStatus: 200, elapsedMs: 100, retryAfterAt: null } }))).toBe(i18n.ts._musicCharts.failureRobotsDenied);
	});
	it('prefers actual source movement over inferred changes and never invents an initial comparison', () => {
		expect(kpopMovement(entry(1)).text).toBe(i18n.ts._musicCharts.noComparison);
		expect(kpopMovement({ ...entry(2), sourceMovement: { type: 'same', amount: null }, previousRank: 9, change: 7 }).text).toBe(i18n.ts._musicCharts.unchanged);
		expect(kpopMovement({ ...entry(2), sourceMovement: { type: 'down', amount: 1 }, previousRank: 9, change: 7 }).direction).toBe('down');
	});
	it('provides compact changes and accessible explanations with their comparison basis', () => {
		const cases = [
			{ row: { ...entry(5), sourceMovement: { type: 'up' as const, amount: 3 }, previousRank: 3, change: -2 }, label: '↑3', basis: 'source', text: i18n.tsx._musicCharts.rise({ count: 3 }) },
			{ row: { ...entry(5), sourceMovement: { type: 'down' as const, amount: 2 }, previousRank: 8, change: 3 }, label: '↓2', basis: 'source', text: i18n.tsx._musicCharts.fall({ count: 2 }) },
			{ row: { ...entry(5), sourceMovement: { type: 'new' as const, amount: null }, previousRank: 8, change: 3 }, label: 'NEW', basis: 'source', text: i18n.ts._musicCharts.kpopNew },
			{ row: { ...entry(5), sourceMovement: { type: 'same' as const, amount: null }, previousRank: 8, change: 3 }, label: '＝', basis: 'source', text: i18n.ts._musicCharts.unchanged },
			{ row: { ...entry(5), previousRank: 8, change: 3 }, label: '↑3', basis: 'comparison', text: i18n.tsx._musicCharts.rise({ count: 3 }) },
			{ row: { ...entry(5), previousRank: 3, change: -2 }, label: '↓2', basis: 'comparison', text: i18n.tsx._musicCharts.fall({ count: 2 }) },
			{ row: { ...entry(5), previousRank: 5, change: 0 }, label: '＝', basis: 'comparison', text: i18n.ts._musicCharts.unchanged },
			{ row: entry(5), label: '—', basis: 'none', text: i18n.ts._musicCharts.noComparison },
		];
		for (const { row, label, basis, text } of cases) expect(kpopMovement(row)).toMatchObject({ label, basis, text });
	});
	it('does not manufacture NEW or unchanged from incomplete or invalid comparisons', () => {
		for (const row of [
			entry(5),
			{ ...entry(5), previousRank: 8 },
			{ ...entry(5), previousRank: 0, change: 0 },
			{ ...entry(5), previousRank: 5, change: NaN },
			{ ...entry(5), sourceMovement: { type: 'up' as const, amount: Infinity } },
		]) expect(kpopMovement(row)).toMatchObject({ label: '—', basis: 'none' });
		expect(kpopMovement({ ...entry(5), sourceMovement: { type: 'up', amount: 0 }, previousRank: 3, change: -2 })).toMatchObject({ label: '↓2', basis: 'comparison' });
	});
	it('uses observation instants for history and explicitly breaks a missing interval', () => {
		const history: KpopHistory = { chartKey: 'melon-top100', songId: 'synthetic-1', basis: 'observation', from: '2026-10-10T00:00:00.000Z', to: '2026-10-17T12:00:00.000Z', points: [
			{ observedAt: '2026-10-17T10:00:00.000Z', sourceUpdatedAt: null, sourcePeriod: null, result: 'ranked', rank: 2, gapBefore: false },
			{ observedAt: '2026-10-17T12:00:00.000Z', sourceUpdatedAt: null, sourcePeriod: null, result: 'ranked', rank: 1, gapBefore: true },
		] };
		const points = kpopHistoryPoints(history);
		expect(points.map(point => point.y)).toEqual([2, null, 1]);
		expect(points[2].x).toBe(Date.parse(history.points[1].observedAt));
	});
	it('uses official daily dates only as KST coordinate anchors and excludes out-of-range or unknown periods', () => {
		const history: KpopHistory = { chartKey: 'melon-daily', songId: 'synthetic-1', basis: 'official_period', from: '2026-10-10T00:00:00.000Z', to: '2026-10-17T12:00:00.000Z', points: [
			{ observedAt: '2026-10-17T10:00:00.000Z', sourcePeriod: '2026-10-16', sourceUpdatedAt: null, rank: 2, result: 'ranked', gapBefore: false },
			{ observedAt: '2026-10-17T11:00:00.000Z', sourcePeriod: '2026-10-01', sourceUpdatedAt: null, rank: 1, result: 'ranked', gapBefore: false },
			{ observedAt: '2026-10-17T12:00:00.000Z', sourcePeriod: null, sourceUpdatedAt: null, rank: 3, result: 'ranked', gapBefore: false },
			{ observedAt: '2026-10-17T12:00:00.000Z', sourcePeriod: '2026-99-99', sourceUpdatedAt: null, rank: 3, result: 'ranked', gapBefore: false },
		] };
		expect(kpopHistoryPoints(history)).toEqual([{ x: Date.parse('2026-10-15T15:00:00.000Z'), y: 2 }]);
		expect(kpopHistoryPeriod('2026-10-16')).toBe('2026-10-16');
		expect(kpopHistoryPeriod('2026-10-17T00:00:00.000Z')).toBe('2026-10-17 09:00');
	});
	it('plots Billboard weekly ranks at actual observations without inventing an issue publication timestamp', () => {
		const observedAt = '2026-10-28T04:00:00.000Z';
		const history: KpopHistory = { chartKey: 'billboard-korea-global-k-songs', songId: 'synthetic-7', basis: 'observation', from: '2026-10-21T04:00:00.000Z', to: observedAt, points: [{ observedAt, sourceUpdatedAt: null, sourcePeriod: null, result: 'ranked', rank: 7, gapBefore: false }] };
		expect(kpopHistoryPoints(history)).toEqual([{ x: Date.parse(observedAt), y: 7 }]);
	});
	it('distinguishes full-list absence, unknown preview membership and missing observations', () => {
		const point = { observedAt: '2026-10-17T10:00:00.000Z', sourcePeriod: null, sourceUpdatedAt: null, rank: null, result: 'unknown' as const, gapBefore: false };
		expect(kpopHistoryResult({ ...point, result: 'not_listed' })).toBe(i18n.ts._musicCharts.kpopNotListed);
		expect(kpopHistoryResult(point, true)).toBe(i18n.ts._musicCharts.kpopPreviewMissing);
		expect(kpopHistoryResult(point)).toBe(i18n.ts._musicCharts.missing);
	});
});
