/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { MiUser } from '@/models/User.js';
import type { MiLocalUser } from '@/models/User.js';
import { MiAccessToken } from '@/models/AccessToken.js';
import { MiApp } from '@/models/App.js';
import { MiNativePushSubscription } from '@/models/NativePushSubscription.js';
import { NativePushService } from '@/core/NativePushService.js';
import type { NativePushRegistration } from '@/core/NativePushService.js';
import type { NativePushQueue } from '@/core/QueueModule.js';
import { IdService } from '@/core/IdService.js';
import { loadConfig } from '@/config.js';
import { api, castAsError, initTestDb, signup } from '../utils.js';

describe('Native push API and PostgreSQL registration ordering', () => {
	const config = loadConfig();
	const ids = new IdService(config);
	let database: DataSource;
	let directory: string;
	let service: NativePushService;
	let alice: MiLocalUser;
	let bob: MiLocalUser;
	let credential: Awaited<ReturnType<typeof signup>>;
	const queue = { add: vi.fn() } as unknown as NativePushQueue;
	const input = (revision = 1): NativePushRegistration & { bundleId: 'com.bolubo.native' } => ({ installationId: randomUUID(), deviceToken: randomBytes(32).toString('hex'), environment: 'development', bundleId: 'com.bolubo.native', revision });

	beforeAll(async () => {
		if (process.env.NODE_ENV !== 'test' || !['127.0.0.1', 'db'].includes(config.db.host)) throw new Error('Isolated test database required');
		credential = await signup({ username: 'native_push_alice' });
		const second = await signup({ username: 'native_push_bob' });
		database = await initTestDb(true);
		alice = await database.getRepository(MiUser).findOneByOrFail({ id: credential.id }) as MiLocalUser;
		bob = await database.getRepository(MiUser).findOneByOrFail({ id: second.id }) as MiLocalUser;
		directory = await mkdtemp(join(tmpdir(), 'pubo-apns-e2e-'));
		const privateKeyFile = join(directory, 'synthetic.p8');
		const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
		await writeFile(privateKeyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
		service = new NativePushService({ ...config, nativePush: { enabled: true, teamId: 'TESTTEAM01', keyId: 'TESTKEY001', bundleId: 'com.bolubo.native', environment: 'development', privateKeyFile } }, database, queue, ids);
	});
	beforeEach(async () => { await database.getRepository(MiNativePushSubscription).clear(); });
	afterAll(async () => { await database?.destroy(); if (directory) await rm(directory, { recursive: true, force: true }); });

	test('HTTP capabilities stay disabled; guests, malformed input and registrations are rejected', async () => {
		const meta = await api('meta', {});
		expect(meta.body.nativePushAvailable).toBe(false);
		const guest = await api('native-push/register', input());
		expect(guest.status).toBe(401);
		const denied = await api('native-push/register', input(), credential);
		expect(castAsError(denied.body).error.code).toBe('NATIVE_PUSH_DISABLED');
		const invalid = await api('native-push/unregister', { ...input(), revision: -1 }, credential);
		expect(invalid.status).toBe(400);
		const invalidInstallation = await api('native-push/unregister', { ...input(), installationId: 'not-an-installation' }, credential);
		expect(invalidInstallation.status).toBe(400);
		const disabledCleanup = await api('native-push/unregister', input(2), credential);
		expect(disabledCleanup.status).toBe(204);
	});

	test('same exact operation is idempotent; different data at the same revision is rejected', async () => {
		const first = input();
		const [a, b] = await Promise.all([service.register(alice, null, first), service.register(alice, null, first)]);
		expect(a).toEqual(b);
		expect(await database.getRepository(MiNativePushSubscription).count()).toBe(1);
		await expect(service.register(alice, null, { ...first, deviceToken: randomBytes(32).toString('hex') })).rejects.toMatchObject({ code: 'NATIVE_PUSH_STALE_OPERATION' });
	});

	test('a newer unregister wins both simultaneous and delayed first registration', async () => {
		const first = input(10);
		await Promise.allSettled([service.register(alice, null, first), service.unregister(alice.id, { ...first, revision: 11 })]);
		const row = await database.getRepository(MiNativePushSubscription).findOneByOrFail({ installationId: first.installationId });
		expect(row).toMatchObject({ enabled: false, revision: 11, deviceToken: null });
		await expect(service.register(alice, null, first)).rejects.toMatchObject({ code: 'NATIVE_PUSH_STALE_OPERATION' });
		const transit = input(20);
		await service.unregister(alice.id, { ...transit, revision: 21 });
		await expect(service.register(alice, null, transit)).rejects.toMatchObject({ code: 'NATIVE_PUSH_STALE_OPERATION' });
	});

	test('a late old-account unregister cannot disable the newer account binding', async () => {
		const first = input(30);
		await service.register(alice, null, first);
		const next = await service.register(bob, null, { ...first, revision: 32 });
		await service.unregister(alice.id, { ...first, revision: 31 });
		expect(await database.getRepository(MiNativePushSubscription).findOneByOrFail({ id: next.subscriptionId })).toMatchObject({ userId: bob.id, enabled: true, revision: 32 });
	});

	test('expired or disabled rows cannot bypass the final ten-device limit', async () => {
		const old = input();
		await service.register(alice, null, old);
		await service.unregister(alice.id, { ...old, revision: 2 });
		for (let index = 0; index < 10; index++) await service.register(alice, null, input());
		await expect(service.register(alice, null, { ...old, revision: 3 })).rejects.toMatchObject({ code: 'NATIVE_PUSH_DEVICE_LIMIT' });
		expect(await database.getRepository(MiNativePushSubscription).countBy({ enabled: true })).toBe(10);
	});

	test('the next account can cancel registration before it replaces an existing binding', async () => {
		const first = input(40);
		const existing = await service.register(alice, null, first);
		await service.unregister(bob.id, { ...first, revision: 43 });
		await expect(service.register(bob, null, { ...first, revision: 42 })).rejects.toMatchObject({ code: 'NATIVE_PUSH_STALE_OPERATION' });
		await expect(service.register(alice, null, { ...first, revision: 41 })).rejects.toMatchObject({ code: 'NATIVE_PUSH_STALE_OPERATION' });
		expect((await database.getRepository(MiNativePushSubscription).findOneByOrFail({ id: existing.subscriptionId })).enabled).toBe(true);
		await service.register(bob, null, { ...first, revision: 44 });
		expect(await database.getRepository(MiNativePushSubscription).countBy({ enabled: true })).toBe(1);
	});

	test('the same physical device replaces its old installation without consuming another slot', async () => {
		const first = input();
		await service.register(alice, null, first);
		for (let index = 0; index < 9; index++) await service.register(alice, null, input());
		await service.register(alice, null, { ...first, installationId: randomUUID() });
		expect(await database.getRepository(MiNativePushSubscription).countBy({ enabled: true })).toBe(10);
		await expect(service.register(alice, null, first)).rejects.toMatchObject({ code: 'NATIVE_PUSH_STALE_OPERATION' });
	});

	test('a fresh registration has a new identity and stale APNs invalidation cannot disable it', async () => {
		const first = input();
		const a = await service.register(alice, null, first);
		const b = await service.register(alice, null, { ...first, revision: 2 });
		expect(a.subscriptionId).not.toBe(b.subscriptionId);
		await database.getRepository(MiNativePushSubscription).update({ id: a.subscriptionId, revision: 1 }, { enabled: false });
		expect((await database.getRepository(MiNativePushSubscription).findOneByOrFail({ id: b.subscriptionId })).enabled).toBe(true);
	});

	test('legacy app authorization reads current stored credentials and permissions', async () => {
		const appId = ids.gen();
		await database.getRepository(MiApp).insert({ id: appId, userId: alice.id, secret: randomBytes(32).toString('hex'), name: 'Synthetic native test', description: 'isolated', permission: ['read:notifications', 'write:notifications'] });
		const id = ids.gen();
		await database.getRepository(MiAccessToken).insert({ id, userId: alice.id, appId, token: randomBytes(32).toString('hex'), hash: randomBytes(32).toString('hex'), permission: [] });
		const partial = { id, permission: ['read:notifications', 'write:notifications'] } as MiAccessToken;
		await service.register(alice, partial, input());
		await database.getRepository(MiApp).update(appId, { permission: ['write:notifications'] });
		await expect(service.register(alice, partial, input())).rejects.toMatchObject({ code: 'NATIVE_PUSH_SCOPE_REQUIRED' });
		await database.getRepository(MiAccessToken).delete(id);
		await expect(service.register(alice, partial, input())).rejects.toMatchObject({ code: 'NATIVE_PUSH_SCOPE_REQUIRED' });
	});
});
