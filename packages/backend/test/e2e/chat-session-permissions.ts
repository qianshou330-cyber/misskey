/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { randomUUID } from 'node:crypto';
import { Blob, FormData } from 'node-fetch';
import { beforeAll, describe, expect, test } from 'vitest';
import type * as Misskey from 'misskey-js';
import { loadConfig } from '@/config.js';
import { IdService } from '@/core/IdService.js';
import { generateNativeUserToken } from '@/misc/token.js';
import { MiAccessToken } from '@/models/AccessToken.js';
import { MiApp } from '@/models/App.js';
import { MiChatMessage } from '@/models/ChatMessage.js';
import { MiRole } from '@/models/Role.js';
import { MiRoleAssignment } from '@/models/RoleAssignment.js';
import { MiUser } from '@/models/User.js';
import { api, createAppToken, initTestDb, relativeFetch, signup } from '../utils.js';
import type { UserToken } from '../utils.js';

describe('Chat HTTP current session permissions', () => {
	let alice: Misskey.entities.SignupResponse;
	let bob: Misskey.entities.SignupResponse;

	beforeAll(async () => {
		alice = await signup({ username: 'chat_session_alice' });
		bob = await signup({ username: 'chat_session_bob' });
		for (const user of [alice, bob]) expect((await api('i/update', { chatScope: 'everyone' }, user)).status).toBe(200);
	});

	async function read(user: UserToken) {
		return api('chat/unread-summary', {}, user);
	}

	async function send(user: UserToken, clientMessageId = randomUUID()) {
		return api('chat/messages/create-to-user', { toUserId: bob.id, text: 'session permission fixture', clientMessageId }, user);
	}

	function expectScopeDenied(response: { status: number; body: unknown }) {
		expect(response.status).toBe(403);
		expect(response.body).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
	}

	test('rechecks each legacy app scope after cached authentication without conflating read and write', async () => {
		const session = { token: await createAppToken(alice, ['read:chat', 'write:chat']) };
		const app = await api('app/create', { name: 'Chat session fixture', description: 'Isolated cached permission test', permission: ['read:chat', 'write:chat'] }, alice);
		expect(app.status).toBe(200);
		const db = await initTestDb(true);
		try {
			const access = await db.getRepository(MiAccessToken).findOneByOrFail({ token: session.token });
			await db.getRepository(MiAccessToken).update(access.id, { appId: app.body.id });
			// Warm both the legacy app cache and the account cache before revoking.
			expect((await read(session)).status).toBe(200);
			expect((await send(session)).status).toBe(200);
			await db.getRepository(MiApp).update(app.body.id, { permission: ['write:chat'] });
			expectScopeDenied(await read(session));
			expectScopeDenied(await api('chat/history', {}, session));
			expect((await send(session)).status).toBe(200);
			await db.getRepository(MiApp).update(app.body.id, { permission: ['read:chat'] });
			expect((await read(session)).status).toBe(200);
			const deniedNonce = randomUUID();
			expectScopeDenied(await send(session, deniedNonce));
			expectScopeDenied(await api('chat/contact-groups/create', { name: 'denied' }, session));
			expect(await db.getRepository(MiChatMessage).existsBy({ fromUserId: alice.id, clientMessageId: deniedNonce })).toBe(false);
			// Multipart uploads pass the same dispatcher guard as JSON endpoints.
			const body = new FormData();
			body.set('i', session.token);
			body.set('toUserId', bob.id);
			body.set('file', new Blob(['private attachment fixture'], { type: 'text/plain' }), 'fixture.txt');
			const upload = await relativeFetch('api/chat/attachments/create', { method: 'POST', body });
			expectScopeDenied({ status: upload.status, body: await upload.json() });
			await db.getRepository(MiAccessToken).delete(access.id);
			expect((await read(session)).status).toBe(401);
		} finally {
			await db.getRepository(MiAccessToken).delete({ token: session.token });
			await db.getRepository(MiApp).delete(app.body.id);
			await db.destroy();
		}
	});

	test('rotated native credentials stop Chat reads and writes for body and bearer authentication', async () => {
		for (const bearer of [false, true]) {
			const session = { token: alice.token, bearer };
			expect((await read(session)).status).toBe(200);
			expect((await send(session)).status).toBe(200);
		}
		const db = await initTestDb(true);
		const current = { token: generateNativeUserToken(), bearer: true };
		try {
			await db.getRepository(MiUser).update(alice.id, { token: current.token });
			for (const bearer of [false, true]) {
				const session = { token: alice.token, bearer };
				expectScopeDenied(await read(session));
				expectScopeDenied(await send(session));
			}
			expect((await read(current)).status).toBe(200);
			expect((await send(current)).status).toBe(200);
		} finally {
			await db.getRepository(MiUser).update(alice.id, { token: alice.token });
			await db.destroy();
		}
	});

	test('current account suspension and deletion flags stop cached Chat sessions', async () => {
		expect((await read(alice)).status).toBe(200);
		const db = await initTestDb(true);
		try {
			for (const flag of ['isSuspended', 'isDeleted'] as const) {
				await db.getRepository(MiUser).update(alice.id, { [flag]: true });
				expectScopeDenied(await read(alice));
				expectScopeDenied(await send(alice));
				await db.getRepository(MiUser).update(alice.id, { [flag]: false });
			}
		} finally {
			await db.getRepository(MiUser).update(alice.id, { isSuspended: false, isDeleted: false });
			await db.destroy();
		}
	});

	test('fresh readonly roles preserve read-all and room members while rejecting writes', async () => {
		const room = await api('chat/rooms/create', { name: 'Chat readonly session fixture' }, alice);
		expect(room.status).toBe(200);
		const session = { token: await createAppToken(alice, ['read:chat', 'write:chat']) };
		expect((await read(session)).status).toBe(200);
		expect((await send(session)).status).toBe(200);
		const db = await initTestDb(true);
		const ids = new IdService(loadConfig());
		const roleId = ids.gen();
		try {
			// Direct fixture changes deliberately bypass cache invalidation broadcasts.
			await db.getRepository(MiRole).insert({ id: roleId, name: 'Chat readonly fixture', description: '', updatedAt: new Date(), lastUsedAt: new Date(), policies: { chatAvailability: { useDefault: false, priority: 2, value: 'readonly' } } });
			await db.getRepository(MiRoleAssignment).insert({ id: ids.gen(), roleId, userId: alice.id, expiresAt: null });
			expect((await read(session)).status).toBe(200);
			expect((await api('chat/read-all', {}, session)).status).toBe(204);
			expect((await api('chat/rooms/members', { roomId: room.body.id }, session)).status).toBe(200);
			expect((await send(session)).status).toBeGreaterThanOrEqual(400);
			expect((await api('chat/contact-groups/create', { name: 'readonly denied' }, session)).status).toBeGreaterThanOrEqual(400);
			await db.getRepository(MiRole).update(roleId, { policies: { chatAvailability: { useDefault: false, priority: 2, value: 'unavailable' } } });
			expect((await read(session)).status).toBeGreaterThanOrEqual(400);
			expect((await api('chat/read-all', {}, session)).status).toBeGreaterThanOrEqual(400);
		} finally {
			await db.getRepository(MiRole).delete(roleId);
			await db.getRepository(MiAccessToken).delete({ token: session.token });
			await db.destroy();
		}
	});

	test('non-Chat account and social APIs keep their existing scopes', async () => {
		const session = { token: await createAppToken(alice, ['read:account', 'write:notes']), bearer: true };
		expect((await api('i', {}, session)).status).toBe(200);
		expect((await api('notes/create', { text: 'non-Chat permission fixture' }, session)).status).toBe(200);
		expectScopeDenied(await read(session));
		expectScopeDenied(await send(session));
	});
});
