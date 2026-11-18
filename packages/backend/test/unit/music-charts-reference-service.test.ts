/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import 'reflect-metadata';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Redis from 'ioredis';
import type { DataSource } from 'typeorm';
import { MusicChartReferenceService } from '@/core/MusicChartReferenceService.js';
import { MusicChartService } from '@/core/MusicChartService.js';
import type { HttpRequestService } from '@/core/HttpRequestService.js';
import type { ReferenceSnapshot } from '@/core/music-charts/reference-parser.js';
import { referenceAttemptKey, referenceSnapshotKey, REFERENCE_WRITE_SCRIPT } from '@/core/music-charts/reference-state.js';

const mocks = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock('@/core/music-charts/reference-parser.js', () => ({ parseReferencePage: mocks.parse }));

const now = new Date('2026-10-16T16:00:00.000Z');
const snapshot = { chartKey: 'bugs-realtime', rank: 8, result: 'ranked', sourceFetchedAt: '2026-10-16T15:00:00.000Z', sourceTimeLabel: '2026.10.17 00:00' };
const response = (body: string, type = 'text/html', status = 200) => ({ status, headers: { get: () => type }, text: async () => body, body: Readable.from([body]) });

function makeService() {
	const redis = { status: 'ready', get: vi.fn(async (_key: string) => null as string | null), mget: vi.fn(async (..._keys: string[]) => [null, null] as (string | null)[]), eval: vi.fn(async (_script: string, ..._args: (string | number)[]) => 1) };
	const send = vi.fn(async (_url: string, ..._options: unknown[]) => response('User-agent: *\nAllow: /', 'text/plain'));
	return { redis, send, service: new MusicChartReferenceService(redis as unknown as Redis.Redis, { send } as unknown as HttpRequestService) };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(now);
	vi.stubEnv('PUBO_MUSIC_CHART_REFERENCES', 'bugs-realtime');
	mocks.parse.mockReturnValue([snapshot]);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('Reference service bounded reads and acquisition', () => {
	it('does not touch cache or upstream when references are disabled', async () => {
		vi.stubEnv('PUBO_MUSIC_CHART_REFERENCES', '');
		const { service, redis, send } = makeService();
		expect(await service.readReferences()).toEqual({});
		await service.collect('bugs');
		expect(redis.mget).not.toHaveBeenCalled();
		expect(redis.get).not.toHaveBeenCalled();
		expect(send).not.toHaveBeenCalled();
	});
	it('reads only fixed cache keys and never fetches or writes from a summary', async () => {
		const { service, redis, send } = makeService();
		redis.mget.mockResolvedValue([JSON.stringify({ ...snapshot, lastSuccessAt: now.toISOString() }), null]);
		expect(await service.readReferences()).toMatchObject({ 'bugs-realtime': { rank: 8 } });
		expect(redis.mget).toHaveBeenCalledWith(referenceSnapshotKey('bugs-realtime'), referenceAttemptKey('bugs'));
		expect(redis.eval).not.toHaveBeenCalled();
		expect(send).not.toHaveBeenCalled();
	});
	it('fails closed without offline queueing when Redis is disconnected', async () => {
		const { service, redis, send } = makeService();
		redis.status = 'reconnecting';
		expect(await service.readReferences()).toEqual({});
		await service.collect('bugs');
		expect(redis.mget).not.toHaveBeenCalled();
		expect(send).not.toHaveBeenCalled();
	});
	it('bounds a stalled cache read to 500ms and preserves the official summary', async () => {
		const { service: reference, redis, send } = makeService();
		redis.mget.mockImplementation(() => new Promise(() => {}));
		const find = vi.fn(async () => []);
		const official = new MusicChartService({ getRepository: () => ({ find }) } as unknown as DataSource, { send } as unknown as HttpRequestService, reference);
		const summary = official.summary();
		await vi.advanceTimersByTimeAsync(500);
		expect((await summary).charts).toHaveLength(5);
		expect((await summary).charts.every(chart => chart.reference === null)).toBe(true);
		expect(send).not.toHaveBeenCalled();
	});
	it('adds references without changing official ranks or filling official history', async () => {
		const { service: reference, redis, send } = makeService();
		redis.mget.mockResolvedValue([JSON.stringify({ ...snapshot, lastSuccessAt: now.toISOString() }), null]);
		const find = vi.fn(async () => []);
		const transaction = vi.fn();
		const official = new MusicChartService({ getRepository: () => ({ find }), transaction } as unknown as DataSource, { send } as unknown as HttpRequestService, reference);
		const summary = await official.summary();
		expect(summary.charts.find(chart => chart.key === 'bugs-realtime')).toMatchObject({ status: 'pending', rank: null, peakRank: null, reference: { rank: 8, result: 'ranked' } });
		expect(summary.charts.find(chart => chart.key === 'melon-hot100')?.reference).toBeNull();
		expect((await official.history('bugs-realtime')).points.every(point => point.result === 'missing')).toBe(true);
		await official.summary();
		expect(redis.mget).toHaveBeenCalledTimes(1);
		expect(transaction).not.toHaveBeenCalled();
		expect(send).not.toHaveBeenCalled();
	});
	it('respects existing backoff before making any upstream request', async () => {
		const { service, redis, send } = makeService();
		redis.get.mockResolvedValue(JSON.stringify({ status: 'restricted', checkedAt: now.getTime() - 1, nextAttemptAt: now.getTime() + 86400000, failureCount: 1 }));
		await service.collect('bugs');
		expect(send).not.toHaveBeenCalled();
		expect(redis.eval).not.toHaveBeenCalled();
	});
	it('defers a successful early scheduled attempt without HTTP or cache writes, then reads at the exact boundary', async () => {
		const { service, redis, send } = makeService();
		const scheduledAt = now.getTime();
		redis.get.mockResolvedValue(JSON.stringify({ status: 'available', checkedAt: scheduledAt - 3600000 + 51, nextAttemptAt: scheduledAt + 51, failureCount: 0 }));
		expect(await service.collect('bugs', scheduledAt)).toEqual({ deferUntil: scheduledAt + 51 });
		expect(send).not.toHaveBeenCalled();
		expect(redis.eval).not.toHaveBeenCalled();
		vi.setSystemTime(scheduledAt + 51);
		send.mockResolvedValueOnce(response('User-agent: *\nAllow: /', 'text/plain')).mockResolvedValueOnce(response('<html>synthetic</html>'));
		await service.collect('bugs', scheduledAt);
		expect(send).toHaveBeenCalledTimes(2);
		expect(redis.eval.mock.calls[0].slice(-4)).toEqual([3600000, 900000, 'null', 0]);
	});
	it('does not repeat a logical slot already observed after a delayed job or restart', async () => {
		const { service, redis, send } = makeService();
		redis.get.mockResolvedValue(JSON.stringify({ status: 'available', checkedAt: now.getTime(), nextAttemptAt: now.getTime() + 3600000, failureCount: 0 }));
		vi.setSystemTime(now.getTime() + 3600001);
		expect(await service.collect('bugs', now.getTime())).toBeUndefined();
		expect(send).not.toHaveBeenCalled();
		expect(redis.eval).not.toHaveBeenCalled();
	});
	it('uses the existing request identity, fixed URLs and bounded nonredirecting HTML requests', async () => {
		const { service, redis, send } = makeService();
		send.mockResolvedValueOnce(response('User-agent: *\nAllow: /', 'text/plain')).mockResolvedValueOnce(response('<html>synthetic</html>'));
		await service.collect('bugs');
		expect(send.mock.calls).toEqual([
			['https://www.chartradar.app/robots.txt', { timeout: 10000, size: 65536, redirect: 'error' }, { throwErrorWhenResponseNotOk: false }],
			['https://www.chartradar.app/charts/bugs', { timeout: 10000, size: 3145728, redirect: 'error' }, { throwErrorWhenResponseNotOk: false }],
		]);
		expect(redis.eval.mock.calls[0][0]).toBe(REFERENCE_WRITE_SCRIPT);
		expect(redis.eval.mock.calls[0]).toContain('available');
	});
	it.each([403, 429])('backs off restricted HTTP %i without parsing', async status => {
		const { service, redis, send } = makeService();
		const denied = response('denied', 'text/plain', status);
		send.mockResolvedValue(denied);
		await service.collect('bugs');
		expect(redis.eval.mock.calls[0]).toContain('restricted');
		expect(mocks.parse).not.toHaveBeenCalled();
		expect(denied.body.destroyed).toBe(true);
	});
	it('does not fetch a page excluded by generic robots policy', async () => {
		const { service, redis, send } = makeService();
		send.mockResolvedValue(response('User-agent: *\nDisallow: /charts/', 'text/plain'));
		await service.collect('bugs');
		expect(send).toHaveBeenCalledTimes(1);
		expect(redis.eval.mock.calls[0]).toContain('restricted');
	});
	it.each(['', '<html>not a policy</html>', 'Service unavailable'])('records invalid robots separately without requesting a chart: %s', async body => {
		const { service, redis, send } = makeService();
		send.mockResolvedValue(response(body, 'text/plain'));
		await service.collect('bugs');
		expect(send).toHaveBeenCalledTimes(1);
		expect(redis.eval.mock.calls[0]).toContain('unavailable');
		expect(JSON.parse(redis.eval.mock.calls[0].at(-2) as string)).toMatchObject({ phase: 'robots', reason: 'robots_invalid', httpStatus: 200 });
	});
	it.each([401, 403, 429, 503])('records the page stage, HTTP %i and valid Retry-After without source contents', async status => {
		const { service, redis, send } = makeService();
		const denied = response('do not retain this text', 'text/html', status);
		denied.headers.get = (name?: string) => name === 'retry-after' ? '90000' : 'text/html';
		send.mockResolvedValueOnce(response('User-agent: *\nAllow: /', 'text/plain')).mockResolvedValueOnce(denied);
		await service.collect('bugs');
		const diagnostic = JSON.parse(redis.eval.mock.calls[0].at(-2) as string);
		expect(diagnostic).toEqual({ phase: 'page', reason: status === 503 ? 'http_error' : `http_${status}`, httpStatus: status, retryAfterAt: new Date(now.getTime() + 90000000).toISOString(), elapsedMs: 0 });
		expect(redis.eval.mock.calls[0].at(-1)).toBe(now.getTime() + 90000000);
		expect(JSON.stringify(redis.eval.mock.calls)).not.toContain('do not retain');
		expect(denied.body.destroyed).toBe(true);
	});
	it.each([
		[{ name: 'AbortError' }, 'timeout'], [{ type: 'no-redirect' }, 'redirect'],
		[{ type: 'max-size' }, 'response_too_large'], [{ code: 'ECONNREFUSED' }, 'network_error'],
	] as const)('records bounded transport classifications %j', async (error, reason) => {
		const { service, redis, send } = makeService();
		send.mockRejectedValue(error);
		await service.collect('bugs');
		expect(JSON.parse(redis.eval.mock.calls[0].at(-2) as string)).toMatchObject({ phase: 'robots', reason, httpStatus: null });
	});
	it.each(['wrong-type', 'oversize', 'parser-error', 'missing-chart'])('records unavailable for %s without snapshot writes', async kind => {
		const { service, redis, send } = makeService();
		send.mockResolvedValueOnce(response('User-agent: *\nAllow: /', 'text/plain')).mockResolvedValueOnce(response(kind === 'oversize' ? 'x'.repeat(3145729) : '<html></html>', kind === 'wrong-type' ? 'application/json' : 'text/html'));
		if (kind === 'parser-error') mocks.parse.mockImplementation(() => { throw new Error('Invalid source'); });
		if (kind === 'missing-chart') mocks.parse.mockReturnValue([]);
		await service.collect('bugs');
		expect(redis.eval.mock.calls[0]).toContain('unavailable');
		expect(redis.eval.mock.calls[0]).toContain('[]');
		const diagnostic = JSON.parse(redis.eval.mock.calls[0].at(-2) as string);
		expect(diagnostic.reason).toBe(kind === 'wrong-type' ? 'content_type' : kind === 'oversize' ? 'response_too_large' : 'invalid_payload');
		expect(diagnostic.phase).toBe(kind === 'wrong-type' || kind === 'oversize' ? 'page' : 'parse');
	});
	it('fetches the Melon source once and saves only enabled chart references', async () => {
		vi.stubEnv('PUBO_MUSIC_CHART_REFERENCES', 'melon-top100');
		const { service, redis, send } = makeService();
		send.mockResolvedValueOnce(response('User-agent: *\nAllow: /', 'text/plain')).mockResolvedValueOnce(response('<html></html>'));
		mocks.parse.mockReturnValue([{ ...snapshot, chartKey: 'melon-daily' }, { ...snapshot, chartKey: 'melon-top100' }]);
		await service.collect('melon');
		expect(send).toHaveBeenCalledTimes(2);
		expect(redis.eval.mock.calls[0]).toContain(referenceSnapshotKey('melon-top100'));
		expect(redis.eval.mock.calls[0]).not.toContain(referenceSnapshotKey('melon-daily'));
	});
	it('refuses arbitrary sources before any I/O', async () => {
		const { service, redis, send } = makeService();
		await expect(service.collect('arbitrary' as 'bugs')).rejects.toThrow('Unknown reference source');
		expect(send).not.toHaveBeenCalled();
		expect(redis.get).not.toHaveBeenCalled();
	});
	it('rejects cross-source, duplicate, incomplete and failed snapshot writes', async () => {
		const { service, redis } = makeService();
		await expect(service.recordOutcome('bugs', 'available', [], now)).rejects.toThrow('Invalid reference snapshot set');
		await expect(service.recordOutcome('bugs', 'available', [snapshot, snapshot] as ReferenceSnapshot[], now)).rejects.toThrow('Invalid reference snapshot set');
		await expect(service.recordOutcome('bugs', 'available', [{ ...snapshot, chartKey: 'melon-top100' }] as ReferenceSnapshot[], now)).rejects.toThrow('Invalid reference snapshot set');
		await expect(service.recordOutcome('bugs', 'restricted', [snapshot] as ReferenceSnapshot[], now)).rejects.toThrow('Invalid reference snapshot set');
		expect(redis.eval).not.toHaveBeenCalled();
	});
});
