/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import type * as Misskey from 'misskey-js';
import { MiChatMessage } from '@/models/ChatMessage.js';
import { MiChatLegacyUnread } from '@/models/ChatLegacyUnread.js';
import { api, castAsError, connectStream, initTestDb, signup } from '../utils.js';

describe('Private Chat daily features', () => {
	let alice: Misskey.entities.SignupResponse;
	let bob: Misskey.entities.SignupResponse;
	let carol: Misskey.entities.SignupResponse;

	beforeAll(async () => {
		alice = await signup({ username: 'chat_daily_alice' });
		bob = await signup({ username: 'chat_daily_bob' });
		carol = await signup({ username: 'chat_daily_carol' });
		for (const user of [alice, bob, carol]) expect((await api('i/update', { chatScope: 'everyone' }, user)).status).toBe(200);
	}, 120000);

	async function send(from = alice, to = bob, text = 'daily message', extra: { replyToId?: string | null; clientMessageId?: string } = {}) {
		const result = await api('chat/messages/create-to-user', { toUserId: to.id, text, ...extra }, from);
		expect(result.status).toBe(200);
		return result.body;
	}

	test('reference summaries follow edits and recall, stay one level and do not mark messages read', async () => {
		const target = await send(alice, bob, '😀'.repeat(201));
		const reply = await send(bob, alice, 'reply', { replyToId: target.id });
		expect(reply.replyToId).toBe(target.id);
		expect(reply.replyTo).toMatchObject({ id: target.id, fromUserId: alice.id, text: '😀'.repeat(200), revision: 0, unavailable: false });
		expect(Object.keys(reply.replyTo!).sort()).toEqual(['attachmentTypes', 'fromUserId', 'id', 'recalledAt', 'revision', 'text', 'unavailable']);
		const nested = await send(alice, bob, 'one level', { replyToId: reply.id });
		expect(nested.replyTo).not.toHaveProperty('replyTo');
		expect((await api('chat/messages/update', { messageId: target.id, expectedRevision: 0, text: 'current edit' }, alice)).status).toBe(200);
		let state = await api('chat/messages/state', { userId: alice.id, messageIds: [reply.id, target.id] }, bob);
		expect(state.body.messages.find(item => item.id === reply.id)?.replyTo).toMatchObject({ text: 'current edit', revision: 1 });
		expect(state.body.messages.find(item => item.id === target.id)?.readAt).toBeNull();
		expect((await api('chat/messages/delete', { messageId: target.id }, alice)).status).toBe(204);
		state = await api('chat/messages/state', { userId: alice.id, messageIds: [reply.id] }, bob);
		expect(state.body.messages[0].replyTo).toMatchObject({ text: null, attachmentTypes: [], revision: 2, unavailable: false });
		expect(state.body.messages[0].replyTo?.recalledAt).not.toBeNull();
	});

	test('new replies reject other conversations, missing and recalled targets; nonce retries preserve the exact reference', async () => {
		const target = await send();
		const foreign = await send(alice, carol, 'other conversation');
		const clientMessageId = randomUUID();
		const first = await send(bob, alice, 'retry reply', { replyToId: target.id, clientMessageId });
		const retry = await send(bob, alice, 'retry reply', { replyToId: target.id, clientMessageId });
		expect(retry.id).toBe(first.id);
		for (const replyToId of [foreign.id, carol.id]) {
			const denied = await api('chat/messages/create-to-user', { toUserId: alice.id, text: 'invalid reference', replyToId }, bob);
			expect(castAsError(denied.body).error.code).toBe('REPLY_TARGET_UNAVAILABLE');
		}
		for (const replyToId of [foreign.id, null]) {
			const conflict = await api('chat/messages/create-to-user', { toUserId: alice.id, text: 'retry reply', replyToId, clientMessageId }, bob);
			expect(castAsError(conflict.body).error.code).toBe('IDEMPOTENCY_CONFLICT');
		}
		await api('chat/messages/delete', { messageId: target.id }, alice);
		expect((await send(bob, alice, 'retry reply', { replyToId: target.id, clientMessageId })).id).toBe(first.id);
		const recalled = await api('chat/messages/create-to-user', { toUserId: alice.id, text: 'new reply', replyToId: target.id }, bob);
		expect(castAsError(recalled.body).error.code).toBe('REPLY_TARGET_UNAVAILABLE');
	});

	test('unavailable/corrupt references never expose another conversation author or text', async () => {
		const reply = await send();
		const foreign = await send(alice, carol, 'must stay private');
		const db = await initTestDb(true);
		try {
			await db.getRepository(MiChatMessage).update(reply.id, { replyToId: foreign.id });
			const state = await api('chat/messages/state', { userId: alice.id, messageIds: [reply.id] }, bob);
			expect(state.body.messages[0].replyTo).toEqual({ id: foreign.id, fromUserId: null, text: null, attachmentTypes: [], revision: 0, recalledAt: null, unavailable: true });
		} finally { await db.destroy(); }
	});

	test('context returns only the nearest twenty each side and neither previews nor context acknowledge reads', async () => {
		const messages = await Promise.all(Array.from({ length: 45 }, (_, index) => send(carol, bob, `context ${index}`)));
		messages.sort((a, b) => a.id.localeCompare(b.id));
		const target = messages[22];
		const context = await api('chat/messages/context', { userId: carol.id, messageId: target.id }, bob);
		expect(context.status).toBe(200);
		expect(context.body.hasOlder).toBe(true);
		expect(context.body.hasNewer).toBe(true);
		expect(context.body.messages.map(item => item.id)).toEqual(messages.slice(2, 43).map(item => item.id).reverse());
		expect(context.body.messages.every(item => item.readAt == null)).toBe(true);
		const foreign = await api('chat/messages/context', { userId: carol.id, messageId: target.id }, alice);
		expect(castAsError(foreign.body).error.code).toBe('NO_SUCH_MESSAGE');
		const mismatchedPeer = await api('chat/messages/context', { userId: alice.id, messageId: target.id }, bob);
		expect(castAsError(mismatchedPeer.body).error.code).toBe('NO_SUCH_MESSAGE');
		const first = await api('chat/messages/context', { userId: carol.id, messageId: messages[0].id }, bob);
		expect(first.body.hasOlder).toBe(false);
		expect(first.body.hasNewer).toBe(true);
		expect(first.body.messages).toHaveLength(21);
	});

	test('eleven concurrent pins admit exactly ten, preserve legacy ordering and keep normal pagination disjoint', async () => {
		const owner = await signup({ username: 'chat_daily_pin_owner' });
		const peers: Misskey.entities.SignupResponse[] = [];
		const lastMessages: Misskey.entities.ChatMessageLiteFor1on1[] = [];
		for (let index = 0; index < 11; index++) {
			const peer = await signup({ username: `chat_daily_pin_${index}` });
			await api('i/update', { chatScope: 'everyone' }, peer);
			peers.push(peer);
			lastMessages.push(await send(owner, peer, `pin ${index}`));
		}
		const results = await Promise.all(peers.map(peer => api('chat/conversation-settings/update', { userId: peer.id, pinned: true }, owner)));
		expect(results.filter(result => result.status === 200)).toHaveLength(10);
		expect(results.filter(result => result.status !== 200).map(result => castAsError(result.body).error.code)).toEqual(['CHAT_PIN_LIMIT']);
		let pinned = await api('chat/conversations', { pinned: true }, owner);
		expect(pinned.body).toHaveLength(10);
		const normal = await api('chat/conversations', { pinned: false, limit: 1 }, owner);
		expect(normal.body).toHaveLength(1);
		expect(pinned.body.some(row => row.user.id === normal.body[0].user.id)).toBe(false);
		expect((await api('chat/conversations', { pinned: false, untilId: normal.body[0].lastMessage.id, limit: 1 }, owner)).body).toEqual([]);
		const legacy = await api('chat/conversations', { limit: 20 }, owner);
		expect(legacy.body.map(row => row.lastMessage.id)).toEqual(lastMessages.map(message => message.id).sort().reverse());
		const earliest = pinned.body[pinned.body.length - 1];
		await api('chat/conversation-settings/update', { userId: earliest.user.id, pinned: false }, owner);
		await api('chat/conversation-settings/update', { userId: earliest.user.id, pinned: true }, owner);
		pinned = await api('chat/conversations', { pinned: true }, owner);
		expect(pinned.body[0].user.id).toBe(earliest.user.id);
		expect((await api('chat/conversation-settings/show', { userId: owner.id }, peers[0])).body).toEqual({ pinnedAt: null, isMuted: false });
	}, 120000);

	test('settings notify both owner devices only and reject empty pins', async () => {
		const newcomer = await signup({ username: 'chat_daily_empty' });
		const denied = await api('chat/conversation-settings/update', { userId: bob.id, pinned: true }, newcomer);
		expect(castAsError(denied.body).error.code).toBe('NO_SUCH_CHAT_CONVERSATION');
		const received: string[][] = [[], [], []];
		const sockets = await Promise.all([alice, alice, bob].map((user, index) => connectStream(user, 'main', event => {
			if (event.type === 'chatStateChanged') received[index].push(event.body.userId);
		})));
		try {
			const changed = await api('chat/conversation-settings/update', { userId: bob.id, pinned: true, isMuted: true }, alice);
			expect(changed.status).toBe(200);
			await vi.waitFor(() => expect(received.slice(0, 2).map(events => events.includes(bob.id))).toEqual([true, true]));
			await new Promise(resolve => setTimeout(resolve, 100));
			expect(received[2]).toEqual([]);
			expect((await api('chat/conversation-settings/show', { userId: alice.id }, bob)).body).toEqual({ pinnedAt: null, isMuted: false });
		} finally { sockets.forEach(socket => socket.close()); }
	});

	test('mute preserves real unread and legacy state while excluding both from notification aggregates', async () => {
		await api('chat/read-all', {}, bob);
		await api('chat/conversation-settings/update', { userId: alice.id, isMuted: true }, bob);
		const message = await send();
		const db = await initTestDb(true);
		try {
			await db.getRepository(MiChatLegacyUnread).upsert({ userId: bob.id, otherId: alice.id, hasUnread: true, messageId: null }, ['userId', 'otherId']);
			const muted = await api('chat/unread-summary', {}, bob);
			expect(muted.body).toMatchObject({ unreadCount: 1, hasLegacyUnread: true, notificationUnreadCount: 0, hasNotificationLegacyUnread: false });
			const conversations = await api('chat/conversations', {}, bob);
			expect(conversations.body.find(row => row.user.id === alice.id)).toMatchObject({ isMuted: true, unreadCount: 1, hasLegacyUnread: true });
			await api('chat/conversation-settings/update', { userId: alice.id, isMuted: false }, bob);
			expect((await api('chat/unread-summary', {}, bob)).body).toMatchObject({ unreadCount: 1, hasLegacyUnread: true, notificationUnreadCount: 1, hasNotificationLegacyUnread: true });
			expect((await api('chat/messages/state', { userId: alice.id, messageIds: [message.id] }, bob)).body.messages[0].readAt).toBeNull();
		} finally { await db.destroy(); }
	});

	test('mute/unmute during the delay and sends created muted never backfill main alerts', async () => {
		const alerts: string[] = [];
		const socket = await connectStream(bob, 'main', event => { if (event.type === 'newChatMessage') alerts.push(event.body.id); });
		try {
			await api('chat/conversation-settings/update', { userId: alice.id, isMuted: false }, bob);
			const pending = await send(alice, bob, 'mute during delay');
			await api('chat/conversation-settings/update', { userId: alice.id, isMuted: true }, bob);
			const createdMuted = await send(alice, bob, 'created while muted');
			await api('chat/conversation-settings/update', { userId: alice.id, isMuted: false }, bob);
			const control = await send(alice, bob, 'unmuted control');
			await vi.waitFor(() => expect(alerts).toContain(control.id), { timeout: 8000 });
			expect(alerts).not.toContain(pending.id);
			expect(alerts).not.toContain(createdMuted.id);
		} finally { socket.close(); }
	});
});
