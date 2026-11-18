/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { beforeAll, describe, expect, test, vi } from 'vitest';
import type * as misskey from 'misskey-js';
import { api, connectStream, createAppToken, initTestDb, signup, waitFire } from '../utils.js';
import { MiAccessToken } from '@/models/AccessToken.js';

describe('Chat Pro streaming and reconnect', () => {
	let alice: misskey.entities.SignupResponse;
	let bob: misskey.entities.SignupResponse;
	beforeAll(async () => {
		alice = await signup({ username: 'chat_stream_alice' });
		bob = await signup({ username: 'chat_stream_bob' });
		await api('following/create', { userId: bob.id }, alice);
		await api('following/create', { userId: alice.id }, bob);
	});

	test('both sender devices receive the recipient read receipt', async () => {
		const message = (await api('chat/messages/create-to-user', { toUserId: bob.id, text: 'two devices' }, alice)).body;
		const received = [false, false];
		const sockets = await Promise.all(received.map((_, index) => connectStream(alice, 'chatUser', event => {
			if (event.type === 'read' && event.body.messages.some((item: { id: string; readAt: string | null }) => item.id === message.id && item.readAt)) received[index] = true;
		}, { otherId: bob.id })));
		try {
			await api('chat/messages/read', { userId: alice.id, messageIds: [message.id] }, bob);
			await vi.waitFor(() => expect(received).toEqual([true, true]));
		} finally { sockets.forEach(socket => socket.close()); }
	});

	test('old WebSocket read packets never acknowledge new messages', async () => {
		const message = (await api('chat/messages/create-to-user', { toUserId: bob.id, text: 'legacy client' }, alice)).body;
		const socket = await connectStream(bob, 'chatUser', () => {}, { otherId: alice.id });
		try {
			const invalidated = await waitFire(bob, 'main', () => socket.send(JSON.stringify({ type: 'ch', body: { id: 'a', type: 'read', body: { id: message.id } } })), event => event.type === 'chatStateChanged');
			expect(invalidated).toBe(true);
			const state = await api('chat/messages/state', { userId: alice.id, messageIds: [message.id] }, bob);
			expect(state.body.messages[0]).toMatchObject({ readAt: null, readState: 'unread' });
		} finally { socket.close(); }
	});

	test('state restores edits and tombstones missed while disconnected', async () => {
		const message = (await api('chat/messages/create-to-user', { toUserId: bob.id, text: 'before disconnect' }, alice)).body;
		await api('chat/messages/update', { messageId: message.id, text: 'edited offline', expectedRevision: 0 }, alice);
		let state = await api('chat/messages/state', { userId: alice.id, messageIds: [message.id] }, bob);
		expect(state.body.messages[0].text).toBe('edited offline');
		await api('chat/messages/delete', { messageId: message.id }, alice);
		state = await api('chat/messages/state', { userId: alice.id, messageIds: [message.id] }, bob);
		expect(state.body.messages[0].recalledAt).not.toBeNull();
		expect(state.body.messages[0].text).toBeNull();
	});

	test('the account-only main stream cannot receive private Chat payloads', async () => {
		const accountOnly = { token: await createAppToken(bob, ['read:account']) };
		const chatReader = { token: await createAppToken(bob, ['read:account', 'read:chat']) };
		const received: { type: string; body: any }[][] = [[], []];
		const sockets = await Promise.all([accountOnly, chatReader].map((user, index) => connectStream(user, 'main', event => received[index].push(event as { type: string; body: any }))));
		try {
			const message = await api('chat/messages/create-to-user', { toUserId: bob.id, text: 'private scoped stream' }, alice);
			expect(message.status).toBe(200);
			await vi.waitFor(() => expect(received[1].some(event => event.type === 'newChatMessage' && event.body.id === message.body.id)).toBe(true), { timeout: 6000 });
			expect(received[0].filter(event => ['newChatMessage', 'chatStateChanged'].includes(event.type))).toEqual([]);
		} finally { sockets.forEach(socket => socket.close()); }
	});

	test('revoking an app token stops Chat events on an already open socket', async () => {
		const token = await createAppToken(bob, ['read:account', 'read:chat']);
		const events: { channel: string; type: string; id?: string }[] = [];
		const chatSocket = await connectStream({ token }, 'chatUser', event => events.push({ channel: 'chatUser', type: event.type, id: event.body?.id }), { otherId: alice.id });
		const mainSocket = await connectStream({ token }, 'main', event => events.push({ channel: 'main', type: event.type, id: event.body?.id }));
		const controlEvents: string[] = [];
		const control = await connectStream(bob, 'main', event => { if (event.type === 'newChatMessage') controlEvents.push(event.body.id); });
		try {
			const db = await initTestDb(true);
			await db.getRepository(MiAccessToken).delete({ token });
			const message = await api('chat/messages/create-to-user', { toUserId: bob.id, text: 'after token revoked' }, alice);
			expect(message.status).toBe(200);
			await vi.waitFor(() => expect(controlEvents).toContain(message.body.id), { timeout: 6000 });
			expect(events.filter(event => event.id === message.body.id || event.type === 'chatStateChanged')).toEqual([]);
		} finally { chatSocket.close(); mainSocket.close(); control.close(); }
	});

	test('recalled content is not sent by the delayed main notification', async () => {
		const notifications: string[] = [];
		const socket = await connectStream(bob, 'main', event => {
			if (event.type === 'newChatMessage') notifications.push(event.body.id);
		});
		try {
			const message = (await api('chat/messages/create-to-user', { toUserId: bob.id, text: 'recall before notification' }, alice)).body;
			await api('chat/messages/delete', { messageId: message.id }, alice);
			await new Promise(resolve => setTimeout(resolve, 3300));
			expect(notifications).not.toContain(message.id);
		} finally { socket.close(); }
	});
});
