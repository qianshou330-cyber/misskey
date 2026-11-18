/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@/config.js';
import { REFERENCE_INTERVAL_MS, REFERENCE_RETENTION_MS, REFERENCE_WRITE_SCRIPT } from '@/core/music-charts/reference-state.js';
import { REFERENCE_RECOVERY_SCRIPT } from '@/core/music-charts/reference-recovery.js';

// Opt-in only. All synthetic keys have an isolated random namespace; no business keys or scans.
describe.skipIf(process.env.PUBO_MUSIC_CHART_REFERENCES_REDIS_TEST !== 'true')('Reference cache atomic state in disposable Redis', () => {
	let redis: Redis;
	const namespace = `pubo-music-reference-test:${randomUUID()}:`;
	const keys = [`${namespace}attempt`, `${namespace}snapshot-a`, `${namespace}snapshot-b`];
	const now = Date.now();
	const fetched = now - 3600000;
	const entry = (rank = 8, sourceFetchedMs = fetched) => ({ chartKey: 'melon-top100', result: 'ranked', rank, sourceFetchedMs, sourceFetchedAt: new Date(sourceFetchedMs).toISOString(), sourceTimeLabel: 'synthetic source', lastSuccessAt: new Date(now).toISOString() });
	const write = async (checked: number, status = 'available', snapshots = [entry()]) => redis.eval(REFERENCE_WRITE_SCRIPT, snapshots.length + 1, ...keys.slice(0, snapshots.length + 1), checked, status, JSON.stringify(snapshots), REFERENCE_RETENTION_MS, REFERENCE_INTERVAL_MS);
	const read = async (key = keys[0]) => JSON.parse((await redis.get(key)) ?? 'null') as Record<string, unknown> | null;

	beforeAll(async () => {
		if (process.env.NODE_ENV !== 'test') throw new Error('Synthetic Redis test requires NODE_ENV=test');
		const config = loadConfig();
		if (config.redis.host !== 'redis' || config.db.db !== 'a2o_test') throw new Error('Use the isolated chart rehearsal services');
		redis = new Redis({ host: config.redis.host, port: config.redis.port, db: config.redis.db ?? 0, password: config.redis.pass, enableOfflineQueue: false, lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 5000 });
		await redis.connect();
	});
	beforeEach(async () => { await redis.del(...keys); });
	afterAll(async () => { if (redis) { await redis.del(...keys); await redis.quit(); } });

	it('commits source snapshot with absolute seven-day expiry', async () => {
		expect(await write(now)).toBe(1);
		expect(await read(keys[1])).toMatchObject({ rank: 8, sourceFetchedAt: new Date(fetched).toISOString() });
		expect(await read(keys[1])).not.toHaveProperty('sourceFetchedMs');
		expect(await redis.pexpiretime(keys[1])).toBe(fetched + REFERENCE_RETENTION_MS);
		expect(await read()).toMatchObject({ status: 'available', nextAttemptAt: now + REFERENCE_INTERVAL_MS, failureCount: 0 });
	});
	it('duplicate source timestamp cannot renew TTL, rank or last success', async () => {
		await write(now);
		const stored = await redis.get(keys[1]);
		await write(now + 1000, 'available', [{ ...entry(99), lastSuccessAt: new Date(now + 1000).toISOString() }]);
		expect(await redis.get(keys[1])).toBe(stored);
		expect(await redis.pexpiretime(keys[1])).toBe(fetched + REFERENCE_RETENTION_MS);
		expect(await read()).toMatchObject({ checkedAt: now + 1000 });
	});
	it('atomically rejects older or equal request timestamps', async () => {
		await write(now);
		const stored = await redis.mget(...keys);
		expect(await write(now - 1, 'restricted', [])).toBe(0);
		expect(await write(now, 'available', [entry(99, fetched + 1)])).toBe(0);
		expect(await redis.mget(...keys)).toEqual(stored);
	});
	it('rejects regressed source time even from a newer request without changing attempt metadata', async () => {
		await write(now);
		const stored = await redis.mget(...keys);
		expect(await write(now + 1, 'available', [entry(5, fetched - 1)])).toBe(0);
		expect(await redis.mget(...keys)).toEqual(stored);
	});
	it('keeps previous data on restrictions, waits 24 hours, and does not renew snapshot expiry', async () => {
		await write(now);
		const stored = await redis.get(keys[1]);
		await write(now + 1, 'restricted', []);
		expect(await read()).toMatchObject({ status: 'restricted', failureCount: 1, nextAttemptAt: now + 1 + 86400000 });
		expect(await redis.get(keys[1])).toBe(stored);
		expect(await redis.pexpiretime(keys[1])).toBe(fetched + REFERENCE_RETENTION_MS);
	});
	it('uses bounded exponential failure backoff and resets after recovery', async () => {
		for (let i = 0; i < 10; i++) {
			await write(now + i, 'unavailable', []);
			expect(await read()).toMatchObject({ failureCount: i + 1, nextAttemptAt: now + i + Math.min(21600000, 900000 * 2 ** i) });
		}
		await write(now + 21600010);
		expect(await read()).toMatchObject({ status: 'available', failureCount: 0, nextAttemptAt: now + 21600010 + REFERENCE_INTERVAL_MS });
	});
	it('honors a longer Retry-After without extending snapshot retention or losing the pause at seven days', async () => {
		await write(now);
		const retry = now + 10 * 86400000;
		const diagnostic = { phase: 'page', reason: 'http_429', httpStatus: 429, retryAfterAt: new Date(retry).toISOString(), elapsedMs: 1 };
		await redis.eval(REFERENCE_WRITE_SCRIPT, 1, keys[0], now + 1, 'restricted', '[]', REFERENCE_RETENTION_MS, REFERENCE_INTERVAL_MS, 900000, JSON.stringify(diagnostic), retry);
		expect(await read()).toMatchObject({ nextAttemptAt: retry, diagnostic });
		expect(await redis.pexpiretime(keys[0])).toBe(retry + REFERENCE_INTERVAL_MS);
		expect(await redis.pexpiretime(keys[1])).toBe(fetched + REFERENCE_RETENTION_MS);
	});
	it('never lets a short Retry-After shorten restriction and clears diagnostic on success', async () => {
		await redis.eval(REFERENCE_WRITE_SCRIPT, 1, keys[0], now, 'restricted', '[]', REFERENCE_RETENTION_MS, REFERENCE_INTERVAL_MS, 900000, 'null', now + 1000);
		expect(await read()).toMatchObject({ nextAttemptAt: now + 86400000 });
		await write(now + 86400000);
		expect(await read()).toMatchObject({ status: 'available', diagnostic: null });
	});
	it('a later unavailable failure cannot shorten an existing restriction pause', async () => {
		await write(now, 'restricted', []);
		await write(now + 1000, 'unavailable', []);
		expect(await read()).toMatchObject({ status: 'unavailable', nextAttemptAt: now + 86400000 });
	});
	it('a late normal success cannot clear a concurrently committed pause', async () => {
		await write(now, 'restricted', []);
		const before = await redis.mget(...keys);
		expect(await write(now + 1000)).toBe(0);
		expect(await redis.mget(...keys)).toEqual(before);
		expect(await write(now + 86400000)).toBe(1);
	});
	it.each([0, 1, 2])('recovery CAS rejects a changed expected key %i without any other write', async changed => {
		await write(now, 'restricted', []);
		const expected = await redis.mget(...keys);
		await redis.set(keys[changed], changed === 0 ? JSON.stringify({ status: 'restricted', checkedAt: now + 1 }) : JSON.stringify(entry(9)));
		const before = await redis.mget(...keys);
		expect(await redis.eval(REFERENCE_RECOVERY_SCRIPT, 3, ...keys, JSON.stringify(expected), now + 100, JSON.stringify([entry(), entry()]), REFERENCE_RETENTION_MS, REFERENCE_INTERVAL_MS)).toBe(0);
		expect(await redis.mget(...keys)).toEqual(before);
	});
	it('recovery atomically replaces only the expected failed attempt and refuses a repeated application', async () => {
		await write(now, 'restricted', []);
		const expected = await redis.mget(...keys);
		const args = [JSON.stringify(expected), now + 100, JSON.stringify([entry(), entry()]), REFERENCE_RETENTION_MS, REFERENCE_INTERVAL_MS];
		expect(await redis.eval(REFERENCE_RECOVERY_SCRIPT, 3, ...keys, ...args)).toBe(1);
		expect(await read()).toMatchObject({ status: 'available', checkedAt: now + 100, nextAttemptAt: now + 100 + REFERENCE_INTERVAL_MS, diagnostic: null });
		const after = await redis.mget(...keys);
		expect(await redis.eval(REFERENCE_RECOVERY_SCRIPT, 3, ...keys, ...args)).toBe(0);
		expect(await redis.mget(...keys)).toEqual(after);
	});
	it('does not store a source snapshot already seven days old', async () => {
		await write(now, 'available', [entry(8, now - REFERENCE_RETENTION_MS)]);
		expect(await redis.get(keys[1])).toBeNull();
	});
	it('commits both Melon charts together and rejects partial time regression atomically', async () => {
		await write(now, 'available', [entry(), { ...entry(20), chartKey: 'melon-daily' }]);
		const stored = await redis.mget(...keys);
		expect(await write(now + 1, 'available', [entry(7, fetched + 1), { ...entry(15, fetched - 1), chartKey: 'melon-daily' }])).toBe(0);
		expect(await redis.mget(...keys)).toEqual(stored);
	});
});
