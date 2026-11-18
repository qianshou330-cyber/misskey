/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { Endpoints } from 'misskey-js';

const origin = process.env.PUBO_MUSIC_CHARTS_TEST_ORIGIN;
const keys = ['melon-daily', 'melon-hot100', 'melon-top100', 'genie-realtime', 'bugs-realtime'];

async function summaryBody(response: Response): Promise<Endpoints['music-charts/summary']['res']> {
	const body: unknown = await response.json();
	expect(body).toEqual(expect.objectContaining({ charts: expect.any(Array) }));
	return body as Endpoints['music-charts/summary']['res'];
}

async function historyBody(response: Response): Promise<Endpoints['music-charts/history']['res']> {
	const body: unknown = await response.json();
	expect(body).toEqual(expect.objectContaining({ chartKey: expect.any(String), maxRank: expect.any(Number), from: expect.any(String), to: expect.any(String), points: expect.any(Array) }));
	return body as Endpoints['music-charts/history']['res'];
}

// The candidate must already be running against the isolated database; no production calls.
describe.skipIf(!origin)('Music chart anonymous HTTP integration', () => {
	beforeAll(() => {
		if (process.env.NODE_ENV !== 'test') throw new Error('An isolated candidate is required');
		const parsed = new URL(origin!);
		if (!['localhost', '127.0.0.1', 'a2o-candidate'].includes(parsed.hostname)) throw new Error('Only an isolated candidate is allowed');
	});

	async function request(endpoint: string, body?: Record<string, unknown>) {
		return fetch(`${origin}/api/music-charts/${endpoint}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
	}

	it('serves GET and POST summaries without a credential', async () => {
		for (const body of [undefined, {}]) {
			const response = await request('summary', body);
			expect(response.status).toBe(200);
			const result = await summaryBody(response);
			expect(result.charts.map(chart => chart.key)).toEqual(keys);
			for (const chart of result.charts) {
				expect(chart.maxRank).toBe(chart.key === 'genie-realtime' ? 200 : 100);
				expect(['pending', 'available', 'restricted', 'unavailable', 'stale']).toContain(chart.status);
				if (chart.result !== 'ranked') expect(chart.rank).toBeNull();
				expect(chart.sourceUrl.startsWith('https://')).toBe(true);
			}
		}
	});

	it('serves bounded history for every registered chart', async () => {
		for (const chartKey of keys) {
			const response = await request('history', { chartKey });
			expect(response.status).toBe(200);
			const result = await historyBody(response);
			expect(result.chartKey).toBe(chartKey);
			expect(result.points).toHaveLength(chartKey === 'melon-daily' ? 8 : 169);
			expect(result.maxRank).toBe(chartKey === 'genie-realtime' ? 200 : 100);
			expect(Date.parse(result.to) - Date.parse(result.from)).toBe(7 * 24 * 3600000);
			for (const point of result.points) {
				if (point.result === 'missing') expect(point.rank).toBeNull();
			}
		}
	});

	it('supports GET history using the registered enum', async () => {
		const response = await request('history?chartKey=bugs-realtime');
		expect(response.status).toBe(200);
		expect((await historyBody(response)).chartKey).toBe('bugs-realtime');
	});

	it.each([{}, { chartKey: 'invalid' }, { chartKey: 'https://example.com' }, { chartKey: 1 }, { chartKey: 'genie-mv-daily' }])('rejects unsupported or missing chart keys: %s', async body => {
		const response = await request('history', body);
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ error: { code: 'INVALID_PARAM' } });
	});
});
