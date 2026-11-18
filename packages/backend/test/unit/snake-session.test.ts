/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import 'reflect-metadata';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveSnakeGameConfig } from '@/config.js';
import type { Config } from '@/config.js';
import type { MiLocalUser } from '@/models/User.js';
import { isSnakeGameEnabled, issueSnakeSession, readSnakeTicketSecret } from '@/misc/snake-session.js';
import SnakeSessionEndpoint, { meta, paramDef } from '@/server/api/endpoints/games/snake/session.js';
import { MetaEntityService } from '@/core/entities/MetaEntityService.js';
import { ApiCallService } from '@/server/api/ApiCallService.js';
import Logger from '@/logger.js';
import { packedMetaLiteSchema } from '@/models/json-schema/meta.js';

const user = { id: 'snakeUser01', username: 'snake_user', name: '测试用户', isSuspended: false, movedToUri: null } as MiLocalUser;
const secret = Buffer.from(Array.from({ length: 32 }, (_value, index) => index + 1));
let directory: string;
let config: Config;

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'pubo-snake-unit-'));
	const ticketSecretFile = join(directory, 'secret');
	await writeFile(ticketSecretFile, secret);
	config = { snakeGame: { enabled: true, ticketSecretFile } } as Config;
});

afterEach(async () => {
	vi.useRealTimers();
	await rm(directory, { recursive: true, force: true });
});

describe('Snake ticket configuration and dynamic availability', () => {
	it('is disabled by default and only literal true enables environment overrides', async () => {
		expect(resolveSnakeGameConfig(undefined, {}).enabled).toBe(false);
		for (const value of ['', 'false', '1', 'TRUE']) {
			expect(resolveSnakeGameConfig({ enabled: true }, { PUBO_SNAKE_ENABLED: value }).enabled).toBe(false);
		}
		expect(resolveSnakeGameConfig({ enabled: false }, { PUBO_SNAKE_ENABLED: 'true' }).enabled).toBe(true);
		expect(await isSnakeGameEnabled({})).toBe(false);
	});

	it('environment paths override YAML without exposing or mutating it', () => {
		const source = { enabled: false, ticketSecretFile: '/old/key', enabledFile: '/old/gate' };
		expect(resolveSnakeGameConfig(source, { PUBO_SNAKE_ENABLED: 'true', PUBO_SNAKE_TICKET_SECRET_FILE: '/new/key', PUBO_SNAKE_ENABLED_FILE: '/new/gate' })).toEqual({ enabled: true, ticketSecretFile: '/new/key', enabledFile: '/new/gate' });
		expect(source).toEqual({ enabled: false, ticketSecretFile: '/old/key', enabledFile: '/old/gate' });
		expect(resolveSnakeGameConfig(source, { PUBO_SNAKE_TICKET_SECRET_FILE: '' }).ticketSecretFile).toBe('');
	});

	it('requires a readable absolute regular file containing at least32raw bytes', async () => {
		for (const path of [undefined, '', 'relative-key', join(directory, 'missing'), directory]) {
			expect(await isSnakeGameEnabled({ snakeGame: { enabled: true, ticketSecretFile: path } })).toBe(false);
		}
		for (const size of [0, 31, 4097]) {
			await writeFile(config.snakeGame!.ticketSecretFile!, Buffer.alloc(size));
			expect(await isSnakeGameEnabled(config)).toBe(false);
		}
	});

	it('preserves raw binary secret bytes including whitespace', async () => {
		const raw = Buffer.concat([Buffer.from('\n '), secret, Buffer.from('\n')]);
		await writeFile(config.snakeGame!.ticketSecretFile!, raw);
		expect(await readSnakeTicketSecret(config)).toEqual(raw);
		const result = await issueSnakeSession(config, user);
		const [payload, signature] = result!.ticket.split('.');
		expect(signature).toBe(createHmac('sha256', raw).update(payload).digest('base64url'));
	});

	it('requires exact enabled newline and reevaluates gate removal without restart', async () => {
		config.snakeGame!.enabledFile = join(directory, 'gate');
		expect(await isSnakeGameEnabled(config)).toBe(false);
		for (const body of ['enabled', 'enabled\r\n', 'disabled', 'enabled\nextra', 'Enabled\n']) {
			await writeFile(config.snakeGame!.enabledFile!, body);
			expect(await isSnakeGameEnabled(config)).toBe(false);
		}
		await writeFile(config.snakeGame!.enabledFile!, 'enabled\n');
		expect(await isSnakeGameEnabled(config)).toBe(true);
		await rm(config.snakeGame!.enabledFile!);
		expect(await isSnakeGameEnabled(config)).toBe(false);
	});

	it('configured false remains off even when both files are valid', async () => {
		config.snakeGame = { ...config.snakeGame, enabled: false, enabledFile: join(directory, 'gate') };
		await writeFile(config.snakeGame.enabledFile!, 'enabled\n');
		expect(await issueSnakeSession(config, user)).toBeNull();
	});

	it('missing secret disables the game even with a valid gate', async () => {
		config.snakeGame!.enabledFile = join(directory, 'gate');
		await writeFile(config.snakeGame!.enabledFile!, 'enabled\n');
		await rm(config.snakeGame!.ticketSecretFile!);
		expect(await isSnakeGameEnabled(config)).toBe(false);
	});
});

describe('Authenticated Snake session issuance', () => {
	it('issues exact signed identity, random one-use ID and60second expiry', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-10-28T12:00:00.789Z'));
		const endpoint = new SnakeSessionEndpoint(config);
		const result = await endpoint.exec({ name: 'forged', sub: 'someone-else', i: 'not-used-here' }, user, null);
		const [payload, signature] = result.ticket.split('.');
		expect(result.ticket).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
		expect(signature).toBe(createHmac('sha256', secret).update(payload).digest('base64url'));
		const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
		expect(claims).toEqual({ v: 1, aud: 'pubo-snake', sub: user.id, name: user.name, jti: expect.stringMatching(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/), iat: 1793188800, exp: 1793188860 });
		expect(result).toEqual({ ticket: expect.any(String), expiresAt: '2026-10-28T12:01:00.000Z', socketPath: '/games/snake/socket.io/' });
		const second = await endpoint.exec({}, user, null);
		expect(second.ticket).not.toBe(result.ticket);
	});

	it('uses the account username when display name is empty', async () => {
		const result = await issueSnakeSession(config, { ...user, name: '' });
		expect(JSON.parse(Buffer.from(result!.ticket.split('.')[0], 'base64url').toString()).name).toBe(user.username);
	});

	it('returns one generic documented unavailable error with no path details', async () => {
		const endpoint = new SnakeSessionEndpoint({ snakeGame: { enabled: true, ticketSecretFile: join(directory, 'private-missing') } } as Config);
		await expect(endpoint.exec({}, user, null)).rejects.toMatchObject({ code: 'SNAKE_GAME_UNAVAILABLE', message: 'Snake game is unavailable.', info: undefined });
		expect(meta).toMatchObject({ requireCredential: true, kind: 'read:account', prohibitMoved: true, limit: { max: 12, duration: 60000, minInterval: 1000 } });
		expect(meta).not.toHaveProperty('allowGet');
		expect(meta).not.toHaveProperty('cacheSec');
		expect(paramDef.properties).toEqual({});
	});
});

function createApiService(account: MiLocalUser | null, permissions?: string[]) {
	const endpoint = new SnakeSessionEndpoint(config);
	const exec = vi.fn(endpoint.exec);
	const limiter = { limit: vi.fn(async () => null) };
	const service = new ApiCallService(
		{ enableIpLogging: false } as never,
		{ enableIpRateLimit: false } as never,
		{} as never,
		{ authenticate: vi.fn(async () => [account, permissions ? { permission: permissions } : null]) } as never,
		limiter as never,
		{ getUserPolicies: vi.fn(async () => ({ rateLimitFactor: 1 })) } as never,
		{} as never,
		{ logger: new Logger('snake-unit') } as never,
		{ startSpan: (_name: string, callback: () => unknown) => callback(), captureMessage: vi.fn() } as never,
	);
	const reply = { code: vi.fn(), header: vi.fn(), send: vi.fn() };
	const call = () => service.handleRequest({ name: 'games/snake/session', meta, params: paramDef, exec } as never, { method: 'POST', body: {}, query: {}, headers: {}, ip: '127.0.0.1' } as never, reply as never);
	return { service, reply, call, exec, limiter };
}

describe('Snake uses the existing API authentication pipeline', () => {
	it.each([
		['guest', null, undefined, 'CREDENTIAL_REQUIRED'],
		['suspended', { ...user, isSuspended: true }, undefined, 'YOUR_ACCOUNT_SUSPENDED'],
		['moved', { ...user, movedToUri: 'https://example.org/users/elsewhere' }, undefined, 'YOUR_ACCOUNT_MOVED'],
		['missing scope', user, ['read:notes'], 'PERMISSION_DENIED'],
	] as const)('denies %s before issuing a ticket', async (_description, account, scopes, code) => {
		const fixture = createApiService(account, scopes ? [...scopes] : undefined);
		try {
			await fixture.call();
			expect(fixture.reply.send).toHaveBeenCalledWith({ error: expect.objectContaining({ code }) });
			expect(fixture.exec).not.toHaveBeenCalled();
		} finally {
			fixture.service.dispose();
		}
	});

	it('accepts read:account scope and applies the registered user rate limit', async () => {
		const fixture = createApiService(user, ['read:account']);
		try {
			await fixture.call();
			expect(fixture.limiter.limit).toHaveBeenCalledWith({ ...meta.limit, key: 'games/snake/session' }, user.id, 1);
			expect(fixture.reply.send).toHaveBeenCalledWith({ ticket: expect.any(String), expiresAt: expect.any(String), socketPath: '/games/snake/socket.io/' });
		} finally {
			fixture.service.dispose();
		}
	});
});

describe('Snake public metadata', () => {
	it('packs the same fresh boolean into lite and detailed metadata without secret fields', async () => {
		const query = { where: vi.fn().mockReturnThis(), andWhere: vi.fn().mockReturnThis(), getMany: vi.fn(async () => []) };
		const instance = { policies: {}, rootUserId: user.id };
		const service = new MetaEntityService(config, instance as never, { createQueryBuilder: () => query } as never, { fetch: async () => ({ username: 'proxy' }) } as never);
		const lite = await service.pack();
		const detailed = await service.packDetailed();
		expect(lite.snakeGameEnabled).toBe(true);
		expect(detailed.snakeGameEnabled).toBe(true);
		expect(JSON.stringify(lite)).not.toContain(config.snakeGame!.ticketSecretFile);
		expect(lite).not.toHaveProperty('snakeGame');
		await rm(config.snakeGame!.ticketSecretFile!);
		expect((await service.pack()).snakeGameEnabled).toBe(false);
		expect((await service.packDetailed()).snakeGameEnabled).toBe(false);
		expect(packedMetaLiteSchema.properties.snakeGameEnabled).toEqual({ type: 'boolean', optional: false, nullable: false });
	});
});
