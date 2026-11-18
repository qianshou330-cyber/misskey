/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import 'reflect-metadata';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import type { AuthenticateService } from '@/server/api/AuthenticateService.js';
import type { ChatAttachmentService } from '@/core/ChatAttachmentService.js';
import type { ChatAttachmentStorageService } from '@/core/ChatAttachmentStorageService.js';
import { ChatAttachmentServerService, parseChatRange } from './ChatAttachmentServerService.js';

vi.mock('@/core/ChatAttachmentService.js', () => ({ ChatAttachmentService: class {} }));
vi.mock('@/core/ChatAttachmentStorageService.js', () => ({ ChatAttachmentStorageService: class {} }));
vi.mock('@/server/api/AuthenticateService.js', () => ({ AuthenticateService: class {} }));

describe('private Chat bytes', () => {
	const cleanup: (() => Promise<unknown>)[] = [];
	afterEach(async () => { while (cleanup.length) await cleanup.pop()!(); });

	async function setup() {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-http-test-'));
		const source = path.join(directory, 'private');
		await fs.writeFile(source, 'private bytes');
		cleanup.push(() => fs.rm(directory, { recursive: true, force: true }));
		let revoked = false;
		let tokenRotated = false;
		let appTokenRevoked = false;
		let appPermissions = ['read:chat'];
		const authenticate = { authenticate: vi.fn(async (token: string) => token === 'owner' || token === 'recipient' ? [{ id: token }, null] : token === 'third' ? [{ id: 'third' }, null] : token === 'app-valid' ? [{ id: 'recipient' }, { id: 'app-token', permission: [] }] : [{ id: 'owner' }, { permission: ['read:drive'] }]) };
		const db = { getRepository: (entity: { name: string }) => ({ findOneBy: async ({ id }: { id: string }) => {
			if (entity.name === 'MiAccessToken') return id === 'app-token' && !appTokenRevoked ? { id, userId: 'recipient', appId: 'app1' } : null;
			if (entity.name === 'MiApp') return { id, permission: appPermissions };
			return { id, token: tokenRotated ? 'new-token' : id, host: null, isSuspended: false, isDeleted: false };
		} }) };
		const attachments = { authorizedAttachment: vi.fn(async (user: string, id: string) => {
			if (revoked || id !== 'attachment1' || !['owner', 'recipient'].includes(user)) throw new Error('denied');
			return { attachment: { name: 'document.txt' }, blob: { storageKey: 'not-a-public-key', size: 13, previewSize: 13, kind: 'file' } };
		}) };
		const server = Fastify();
		const service = new ChatAttachmentServerService(db as unknown as DataSource, authenticate as unknown as AuthenticateService, attachments as unknown as ChatAttachmentService, { pathFor: () => source } as unknown as ChatAttachmentStorageService);
		server.register(service.createServer);
		await server.ready();
		cleanup.push(() => server.close());
		return { server, attachments, revoke: () => { revoked = true; }, rotateToken: () => { tokenRotated = true; }, revokeApp: () => { appTokenRevoked = true; }, revokeAppScope: () => { appPermissions = []; } };
	}

	it('requires Bearer and a Chat scope for original, preview, download and HEAD', async () => {
		const { server } = await setup();
		for (const variant of ['original', 'preview', 'download']) {
			for (const method of ['GET', 'HEAD'] as const) {
				const url = `/api/chat/attachments/attachment1/${variant}`;
				expect((await server.inject({ method, url })).statusCode).toBe(401);
				expect((await server.inject({ method, url, headers: { authorization: 'Bearer scope-less' } })).statusCode).toBe(403);
				expect((await server.inject({ method, url, headers: { authorization: 'Bearer third' } })).statusCode).toBe(404);
			}
		}
	});

	it('authorizes every request, denies revoked grants and never redirects or caches', async () => {
		const { server, attachments, revoke } = await setup();
		const options = { url: '/api/chat/attachments/attachment1/original', headers: { authorization: 'Bearer recipient' } };
		const first = await server.inject(options);
		expect(first.body).toBe('private bytes');
		expect(first.headers['cache-control']).toBe('private, no-store');
		expect(first.headers.location).toBeUndefined();
		expect(first.headers['content-length']).toBe('13');
		revoke();
		expect((await server.inject(options)).statusCode).toBe(404);
		expect(attachments.authorizedAttachment).toHaveBeenCalledTimes(2);
	});

	it('checks authorization before parsing ranges and rejects query-string credentials', async () => {
		const { server } = await setup();
		const url = '/api/chat/attachments/attachment1/original';
		expect((await server.inject({ url: `${url}?i=owner`, headers: { authorization: 'Bearer owner' } })).statusCode).toBe(401);
		const partial = await server.inject({ url, headers: { authorization: 'Bearer owner', range: 'bytes=2-5' } });
		expect(partial.statusCode).toBe(206);
		expect(partial.body).toBe('ivat');
		expect(partial.headers['content-length']).toBe('4');
		expect(partial.headers['content-range']).toBe('bytes 2-5/13');
		expect((await server.inject({ url, headers: { authorization: 'Bearer third', range: 'bytes=500-' } })).statusCode).toBe(404);
		expect((await server.inject({ url, headers: { authorization: 'Bearer owner', range: 'bytes=500-' } })).statusCode).toBe(416);
	});

	it('denies a rotated native token even if native authentication has a stale cached user', async () => {
		const { server, rotateToken } = await setup();
		const options = { url: '/api/chat/attachments/attachment1/original', headers: { authorization: 'Bearer owner' } };
		expect((await server.inject(options)).statusCode).toBe(200);
		rotateToken();
		expect((await server.inject(options)).statusCode).toBe(403);
	});

	it('uses fresh app permissions and refuses revoked app tokens regardless of cached authentication', async () => {
		const first = await setup();
		const options = { url: '/api/chat/attachments/attachment1/original', headers: { authorization: 'Bearer app-valid' } };
		// The cached app permissions are empty, but the current scope grants access.
		expect((await first.server.inject(options)).statusCode).toBe(200);
		first.revokeAppScope();
		expect((await first.server.inject(options)).statusCode).toBe(403);
		const second = await setup();
		expect((await second.server.inject(options)).statusCode).toBe(200);
		second.revokeApp();
		expect((await second.server.inject(options)).statusCode).toBe(403);
	});
});

describe('bounded private media ranges', () => {
	it('supports whole, open, suffix and clamped ranges', () => {
		expect(parseChatRange(undefined, 10)).toBeNull();
		expect(parseChatRange('bytes=2-', 10)).toEqual({ start: 2, end: 9 });
		expect(parseChatRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
		expect(parseChatRange('bytes=0-999', 10)).toEqual({ start: 0, end: 9 });
	});
	it.each(['bytes=-0', 'bytes=-', 'bytes=10-', 'bytes=3-2', 'bytes=0-1,4-5', 'items=0-3', 'bytes=9999999999999999999-'])('rejects invalid or unsupported range %s', range => {
		expect(() => parseChatRange(range, 10)).toThrow();
	});
});
