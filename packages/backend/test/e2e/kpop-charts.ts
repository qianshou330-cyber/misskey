/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { describe, expect, test } from 'vitest';
import { api, castAsError } from '../utils.js';

const chartKeys = ['melon-daily', 'melon-hot100', 'melon-top100', 'melon-hot100-d30', 'genie-realtime', 'bugs-realtime', 'flo', 'apple', 'spotify', 'tencent', 'billboard-korea-global-k-songs'] as const;
const groupIds = ['a2o-lite', 'hearts2hearts', 'kiiikiii', 'baby-dont-cry', 'ifeye', 'babymonster', 'illit', 'meovv', 'triples', 'aespa', 'newjeans', 'le-sserafim', 'ive'] as const;

// The ordinary e2e server uses its empty disposable database and leaves chart
// collection disabled. These requests neither seed rows nor contact a source.
describe('K-pop chart anonymous endpoints', () => {
	test('returns the fixed catalog and an honest empty default selection', async () => {
		const response = await api('music-charts/kpop-summary', {});
		expect(response.status).toBe(200);
		expect(response.body.charts.map(chart => chart.chartKey)).toEqual(chartKeys);
		expect(response.body.groups.map(group => group.id)).toEqual(groupIds);
		expect(response.body.selected.chartKey).toBe('melon-top100');
		expect(response.body.entries).toEqual([]);
		for (const chart of response.body.charts) {
			expect(chart.status).toBe('disabled');
			expect([chart.checkedAt, chart.lastSuccessAt, chart.lastChangedAt, chart.sourcePeriod, chart.sourceUpdatedAt, chart.observedAt, chart.diagnostic]).toEqual([null, null, null, null, null, null, null]);
		}
	});

	test.each(chartKeys)('selects only the registered %s chart without creating history', async chartKey => {
		const summary = await api('music-charts/kpop-summary', { chartKey });
		expect(summary.status).toBe(200);
		expect(summary.body.selected.chartKey).toBe(chartKey);
		expect(summary.body.entries).toEqual([]);
		const history = await api('music-charts/kpop-history', { chartKey, songId: 'synthetic-no-source-song' });
		expect(history.status).toBe(200);
		expect(history.body.chartKey).toBe(chartKey);
		expect(history.body.basis).toBe('observation');
		expect(history.body.points).toEqual([]);
		expect(Date.parse(history.body.to) - Date.parse(history.body.from)).toBe(7 * 24 * 60 * 60 * 1000);
	});

	test.each(groupIds)('accepts the bounded %s filter while preserving empty state', async groupId => {
		const response = await api('music-charts/kpop-chart', { chartKey: 'melon-top100', groupId, query: 'NEON', offset: 0, limit: 100 });
		expect(response.status).toBe(200);
		expect(response.body.chart.chartKey).toBe('melon-top100');
		expect([response.body.entries, response.body.total, response.body.hasMore]).toEqual([[], 0, false]);
	});

	test('rejects arbitrary URLs and unknown chart or group selectors', async () => {
		// @ts-expect-error Verify that a URL cannot become an upstream request.
		const summary = await api('music-charts/kpop-summary', { chartKey: 'https://example.invalid/chart' });
		// @ts-expect-error Verify runtime chart enum validation.
		const chart = await api('music-charts/kpop-chart', { chartKey: 'unknown' });
		// @ts-expect-error Verify runtime history enum validation.
		const history = await api('music-charts/kpop-history', { chartKey: 'https://example.invalid/chart', songId: 'synthetic' });
		// @ts-expect-error Verify runtime group enum validation.
		const group = await api('music-charts/kpop-chart', { chartKey: 'flo', groupId: 'unknown' });
		for (const response of [summary, chart, history, group]) {
			expect(response.status).toBe(400);
			expect(castAsError(response.body).error.code).toBe('INVALID_PARAM');
		}
	});

	test('rejects missing required fields and unbounded input', async () => {
		// @ts-expect-error Verify runtime required chart field validation.
		const chart = await api('music-charts/kpop-chart', {});
		// @ts-expect-error Verify runtime required song field validation.
		const history = await api('music-charts/kpop-history', { chartKey: 'flo' });
		const query = await api('music-charts/kpop-chart', { chartKey: 'flo', query: 'x'.repeat(201) });
		const limit = await api('music-charts/kpop-chart', { chartKey: 'flo', limit: 101 });
		const offset = await api('music-charts/kpop-chart', { chartKey: 'flo', offset: -1 });
		const song = await api('music-charts/kpop-history', { chartKey: 'flo', songId: 'x'.repeat(201) });
		for (const response of [chart, history, query, limit, offset, song]) {
			expect(response.status).toBe(400);
			expect(castAsError(response.body).error.code).toBe('INVALID_PARAM');
		}
	});

	test('repeated anonymous summary reads do not change observation state', async () => {
		const first = await api('music-charts/kpop-summary', {});
		for (let index = 0; index < 3; index++) {
			const next = await api('music-charts/kpop-summary', {});
			expect(next.status).toBe(200);
			expect(next.body).toEqual(first.body);
		}
	});
});
