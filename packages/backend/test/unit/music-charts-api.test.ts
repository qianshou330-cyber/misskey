/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import SummaryEndpoint, { meta as summaryMeta } from '@/server/api/endpoints/music-charts/summary.js';
import HistoryEndpoint, { meta as historyMeta } from '@/server/api/endpoints/music-charts/history.js';
import type { MusicChartService } from '@/core/MusicChartService.js';

describe('Public music chart endpoint contracts', () => {
	it('allows anonymous read-only cached summaries without collecting data', async () => {
		const summary = vi.fn(async () => ({ charts: [] }));
		const collect = vi.fn();
		const endpoint = new SummaryEndpoint({ summary, collect } as unknown as MusicChartService);
		expect(await endpoint.exec({}, null, null)).toEqual({ charts: [] });
		expect(summary).toHaveBeenCalledTimes(1);
		expect(collect).not.toHaveBeenCalled();
		expect(summaryMeta).toMatchObject({ requireCredential: false, allowGet: true, cacheSec: 30 });
	});

	it('accepts only registered chart keys and does not expose a fetch proxy', async () => {
		const history = vi.fn(async () => ({ points: [] }));
		const collect = vi.fn();
		const endpoint = new HistoryEndpoint({ history, collect } as unknown as MusicChartService);
		await endpoint.exec({ chartKey: 'bugs-realtime' }, null, null);
		expect(history).toHaveBeenCalledWith('bugs-realtime');
		await expect(endpoint.exec({ chartKey: 'https://example.com' }, null, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		await expect(endpoint.exec({}, null, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		await expect(endpoint.exec({ chartKey: 1 }, null, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		await expect(endpoint.exec({ chartKey: 'genie-mv-daily' }, null, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		expect(history).toHaveBeenCalledTimes(1);
		expect(collect).not.toHaveBeenCalled();
		expect(historyMeta).toMatchObject({ requireCredential: false, allowGet: true });
	});

	it('accepts the new daily and TOP200 sources and exposes an explicit chart scale', async () => {
		const history = vi.fn(async () => ({ points: [] }));
		const endpoint = new HistoryEndpoint({ history } as unknown as MusicChartService);
		for (const chartKey of ['melon-daily', 'melon-hot100', 'melon-top100', 'genie-realtime', 'bugs-realtime']) {
			await endpoint.exec({ chartKey }, null, null);
			expect(history).toHaveBeenLastCalledWith(chartKey);
		}
		expect(summaryMeta.res.properties.charts.items.properties.maxRank).toEqual({ type: 'integer', minimum: 100, maximum: 200, optional: false, nullable: false });
		expect(historyMeta.res.properties.maxRank).toEqual({ type: 'integer', minimum: 100, maximum: 200, optional: false, nullable: false });
	});

	it('documents nullable separate references without changing official history', () => {
		const schema = summaryMeta.res.properties.charts.items.properties.reference;
		expect(schema).toMatchObject({ type: 'object', optional: false, nullable: true });
		expect(schema.properties.provider.enum).toEqual(['chartradar']);
		expect(schema.properties.result.enum).toEqual(['ranked', 'not_found', 'unknown']);
		expect(schema.properties.scope.enum).toEqual(['top100', 'reference-top200']);
		for (const property of Object.values(schema.properties)) expect(property.optional).toBe(false);
		expect(historyMeta.res.properties).not.toHaveProperty('reference');
	});
});
