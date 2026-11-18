/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { MusicChartService } from '@/core/MusicChartService.js';
import type { MusicChartReferenceService } from '@/core/MusicChartReferenceService.js';
import type { HttpRequestService } from '@/core/HttpRequestService.js';
import { initialMusicChartState } from '@/core/music-charts/state.js';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/core/music-charts/provider.js', async importOriginal => ({
	...await importOriginal<typeof import('@/core/music-charts/provider.js')>(),
	fetchMusicChart: mocks.fetch,
}));
const slot = Date.parse('2026-10-16T17:13:00.000Z');

function makeService(status = 'available') {
	const state = { ...initialMusicChartState('bugs-realtime'), checkedAt: new Date(slot - 3600000 + 51), nextAttemptAt: new Date(slot + 51), status };
	const findOneBy = vi.fn(async () => state);
	const transaction = vi.fn();
	const send = vi.fn();
	const service = new MusicChartService({ getRepository: () => ({ findOneBy }), transaction } as unknown as DataSource, { send } as unknown as HttpRequestService, {} as MusicChartReferenceService);
	const record = vi.spyOn(service, 'recordOutcome').mockResolvedValue(undefined);
	return { state, service, record, send, transaction };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(slot);
	mocks.fetch.mockResolvedValue({ period: '2026-10-16T17:00:00.000Z', rank: 8, eligible: true });
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('Official collection cooldown and logical slots', () => {
	it('does not request or write before the hourly cooldown, then collects at its exact boundary', async () => {
		const { service, record, send, transaction } = makeService();
		expect(await service.collect('bugs-realtime', slot)).toEqual({ deferUntil: slot + 51 });
		expect(mocks.fetch).not.toHaveBeenCalled();
		expect(send).not.toHaveBeenCalled();
		expect(record).not.toHaveBeenCalled();
		expect(transaction).not.toHaveBeenCalled();
		vi.setSystemTime(slot + 51);
		await service.collect('bugs-realtime', slot);
		expect(mocks.fetch).toHaveBeenCalledTimes(1);
		expect(record).toHaveBeenCalledExactlyOnceWith('bugs-realtime', { snapshot: { period: '2026-10-16T17:00:00.000Z', rank: 8, eligible: true } }, new Date(slot + 51));
	});
	it.each(['restricted', 'unavailable'])('keeps existing %s backoff untouched', async status => {
		const { state, service, record } = makeService(status);
		state.nextAttemptAt = new Date(slot + 86400000);
		expect(await service.collect('bugs-realtime', slot)).toBeUndefined();
		expect(mocks.fetch).not.toHaveBeenCalled();
		expect(record).not.toHaveBeenCalled();
		expect(state.nextAttemptAt.getTime()).toBe(slot + 86400000);
	});
	it('does not re-fetch an already observed logical slot even after its cooldown expires', async () => {
		const { state, service, record } = makeService();
		state.checkedAt = new Date(slot + 51);
		vi.setSystemTime(slot + 3600000);
		await service.collect('bugs-realtime', slot);
		expect(mocks.fetch).not.toHaveBeenCalled();
		expect(record).not.toHaveBeenCalled();
	});
});
