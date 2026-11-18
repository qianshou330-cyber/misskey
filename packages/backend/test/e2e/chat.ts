/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, test } from 'vitest';
import type * as misskey from 'misskey-js';
import { MiChatMessage } from '@/models/ChatMessage.js';
import { MiChatAttachment } from '@/models/ChatAttachment.js';
import { MiChatAttachmentBlob } from '@/models/ChatAttachmentBlob.js';
import { MiChatLegacyUnread } from '@/models/ChatLegacyUnread.js';
import { IdService } from '@/core/IdService.js';
import { loadConfig } from '@/config.js';
import { api, castAsError, initTestDb, signup, uploadFile } from '../utils.js';

describe('Chat Pro one-to-one state', () => {
	let alice: misskey.entities.SignupResponse;
	let bob: misskey.entities.SignupResponse;
	let carol: misskey.entities.SignupResponse;

	beforeAll(async () => {
		alice = await signup({ username: 'chat_alice' });
		bob = await signup({ username: 'chat_bob' });
		carol = await signup({ username: 'chat_carol' });
		await api('following/create', { userId: bob.id }, alice);
		await api('following/create', { userId: alice.id }, bob);
	});

	async function send(text: string, clientMessageId = randomUUID()) {
		const response = await api('chat/messages/create-to-user', { toUserId: bob.id, text, clientMessageId }, alice);
		expect(response.status).toBe(200);
		return response.body;
	}

	test('retries, including concurrent first sends, create exactly one row', async () => {
		const clientMessageId = randomUUID();
		const [first, second] = await Promise.all([send('same message', clientMessageId), send('same message', clientMessageId)]);
		expect(first.id).toBe(second.id);
		const conflict = await api('chat/messages/create-to-user', { toUserId: bob.id, text: 'different', clientMessageId }, alice);
		expect(castAsError(conflict.body).error.code).toBe('IDEMPOTENCY_CONFLICT');
	});

	test('fetching a timeline does not acknowledge delivery as reading', async () => {
		const message = await send('not yet visible');
		await api('chat/messages/user-timeline', { userId: alice.id }, bob);
		const state = await api('chat/messages/state', { userId: bob.id, messageIds: [message.id] }, alice);
		expect(state.body.messages[0]).toMatchObject({ readTracked: true, readAt: null, readState: 'unread' });
		const read = await api('chat/messages/read', { userId: alice.id, messageIds: [message.id] }, bob);
		expect(read.body.messages[0].readState).toBe('read');
		const duplicate = await api('chat/messages/read', { userId: alice.id, messageIds: [message.id] }, bob);
		expect(duplicate.body.messages[0].readAt).toBe(read.body.messages[0].readAt);
		expect(duplicate.body.messages[0].revision).toBe(read.body.messages[0].revision);
	});

	test('a receipt never changes the content revision or causes an edit conflict', async () => {
		const message = await send('read while editing');
		const read = await api('chat/messages/read', { userId: alice.id, messageIds: [message.id] }, bob);
		expect(read.body.messages[0].revision).toBe(message.revision);
		const allMessage = await send('read-all while editing');
		await api('chat/read-all', {}, bob);
		const allState = await api('chat/messages/state', { userId: bob.id, messageIds: [allMessage.id] }, alice);
		expect(allState.body.messages[0]).toMatchObject({ revision: allMessage.revision, readState: 'read' });
		const edited = await api('chat/messages/update', { messageId: message.id, text: 'edit after reading', expectedRevision: message.revision! }, alice);
		expect(edited.status).toBe(200);
		expect(edited.body).toMatchObject({ revision: message.revision! + 1, readAt: read.body.messages[0].readAt });
	});

	test('third parties and senders cannot forge a recipient receipt', async () => {
		const message = await send('private');
		const forged = await api('chat/messages/read', { userId: alice.id, messageIds: [message.id] }, carol);
		expect(forged.body.messages).toEqual([]);
		const own = await api('chat/messages/read', { userId: bob.id, messageIds: [message.id] }, alice);
		expect(own.body.messages).toEqual([]);
		const hidden = await api('chat/messages/state', { userId: alice.id, messageIds: [message.id] }, carol);
		expect(hidden.body).toEqual({ messages: [], missingIds: [message.id] });
	});

	test('one unread summary reconciles precise counts without reading messages', async () => {
		await api('chat/read-all', {}, bob);
		const first = await send('summary first');
		const second = await send('summary second');
		let summary = await api('chat/unread-summary', {}, bob);
		expect(summary.body).toEqual({ unreadCount: 2, hasLegacyUnread: false, hasUnreadRoom: false, notificationUnreadCount: 2, hasNotificationLegacyUnread: false });
		await api('chat/messages/read', { userId: alice.id, messageIds: [first.id] }, bob);
		summary = await api('chat/unread-summary', {}, bob);
		expect(summary.body.unreadCount).toBe(1);
		await api('chat/messages/delete', { messageId: second.id }, alice);
		summary = await api('chat/unread-summary', {}, bob);
		expect(summary.body.unreadCount).toBe(0);
	});

	test('unrelated users cannot add or remove reactions to a private message', async () => {
		const message = await send('reaction permissions');
		const foreign = { messageId: message.id, reaction: '👍' };
		expect((await api('chat/messages/react', foreign, carol)).status).not.toBe(204);
		expect((await api('chat/messages/unreact', foreign, carol)).status).not.toBe(204);
		expect((await api('chat/messages/react', foreign, bob)).status).toBe(204);
		expect((await api('chat/messages/unreact', foreign, bob)).status).toBe(204);
		await api('chat/messages/delete', { messageId: message.id }, alice);
		expect((await api('chat/messages/react', foreign, bob)).status).not.toBe(204);
	});

	test('only one concurrent edit wins and a recalled message never comes back', async () => {
		const message = await send('before');
		const changes = await Promise.all(['one', 'two'].map(text => api('chat/messages/update', { messageId: message.id, text, expectedRevision: 0 }, alice)));
		expect(changes.filter(response => response.status === 200)).toHaveLength(1);
		expect(changes.filter(response => response.status !== 200).map(response => castAsError(response.body).error.code)).toEqual(['MESSAGE_CONFLICT']);
		await api('chat/messages/delete', { messageId: message.id }, alice);
		await api('chat/messages/delete', { messageId: message.id }, alice);
		const state = await api('chat/messages/state', { userId: alice.id, messageIds: [message.id] }, bob);
		expect(state.body.messages[0].recalledAt).not.toBeNull();
		expect(state.body.messages[0].text).toBeNull();
		const edit = await api('chat/messages/update', { messageId: message.id, text: 'revive', expectedRevision: state.body.messages[0].revision! }, alice);
		expect(castAsError(edit.body).error.code).toBe('MESSAGE_NOT_EDITABLE');
	});

	test('ownership and read batch limits are enforced', async () => {
		const message = await send('mine');
		expect((await api('chat/messages/delete', { messageId: message.id }, bob)).status).not.toBe(204);
		expect((await api('chat/messages/update', { messageId: message.id, text: 'stolen', expectedRevision: 0 }, bob)).status).not.toBe(200);
		expect((await api('chat/messages/read', { userId: alice.id, messageIds: Array.from({ length: 101 }, (_, i) => 'test' + i) }, bob)).status).toBe(400);
	});

	test('legacy private file sends require an upgrade before creating messages or importing Drive files', async () => {
		const upload = await uploadFile(alice);
		expect(upload.status).toBe(200);
		const priorNonce = randomUUID();
		await send('existing text nonce', priorNonce);
		const db = await initTestDb(true);
		try {
			const before = {
				messages: await db.getRepository(MiChatMessage).countBy({ fromUserId: alice.id }),
				attachments: await db.getRepository(MiChatAttachment).countBy({ ownerId: alice.id }),
				blobs: await db.getRepository(MiChatAttachmentBlob).countBy({ ownerId: alice.id }),
			};
			for (const params of [
				{ fileId: upload.body.id },
				{ fileId: upload.body.id, text: 'legacy with text' },
				{ fileId: upload.body.id, attachmentIds: [upload.body.id] },
				{ fileId: upload.body.id, text: 'existing text nonce', clientMessageId: priorNonce },
			]) {
				const response = await api('chat/messages/create-to-user', { toUserId: bob.id, ...params }, alice);
				expect(response.status).toBe(400);
				expect(castAsError(response.body).error.code).toBe('CHAT_CLIENT_UPGRADE_REQUIRED');
			}
			expect(await db.getRepository(MiChatMessage).countBy({ fromUserId: alice.id })).toBe(before.messages);
			expect(await db.getRepository(MiChatAttachment).countBy({ ownerId: alice.id })).toBe(before.attachments);
			expect(await db.getRepository(MiChatAttachmentBlob).countBy({ ownerId: alice.id })).toBe(before.blobs);
		} finally { await db.destroy(); }
	});

	test('explicitly imported private attachments retain safe old-client placeholders and exposure metadata', async () => {
		const upload = await uploadFile(alice);
		expect(upload.status).toBe(200);
		const imported = await api('chat/attachments/import-drive', { toUserId: bob.id, fileId: upload.body.id }, alice);
		expect(imported.status).toBe(200);
		const response = await api('chat/messages/create-to-user', { toUserId: bob.id, attachmentIds: [imported.body.id], clientMessageId: randomUUID() }, alice);
		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({ file: null, fileId: null, privateAttachmentFallback: true });
		expect(response.body.text).toBe('Private attachment. Update your client to view it.');
		expect(response.body.attachments).toHaveLength(1);
		expect(response.body.attachments![0].legacyExposure).toBe('possible');
		expect(JSON.stringify(response.body)).not.toContain(upload.body.url);
		const detail = await api('chat/messages/show', { messageId: response.body.id }, bob);
		expect(detail.body).toMatchObject({ file: null, fileId: null, privateAttachmentFallback: true });
	});

	test('Chat blocking preserves follows, rejects sends and edit bypasses, and allows recall', async () => {
		const message = await send('before chat block');
		await api('chat/blocking/create', { userId: alice.id }, bob);
		try {
			const following = await api('users/show', { userId: bob.id }, alice);
			expect(following.body.isFollowing).toBe(true);
			const blocked = await api('chat/messages/create-to-user', { toUserId: bob.id, text: 'blocked' }, alice);
			expect(castAsError(blocked.body).error.code).toBe('CHAT_BLOCKED');
			const edited = await api('chat/messages/update', { messageId: message.id, text: 'bypass', expectedRevision: 0 }, alice);
			expect(castAsError(edited.body).error.code).toBe('CHAT_BLOCKED');
			expect((await api('chat/messages/delete', { messageId: message.id }, alice)).status).toBe(204);
		} finally {
			await api('chat/blocking/delete', { userId: alice.id }, bob);
		}
	});

	test('native blocking remains effective after a conversation was approved', async () => {
		await send('conversation approved');
		await api('blocking/create', { userId: alice.id }, bob);
		try {
			const blocked = await api('chat/messages/create-to-user', { toUserId: bob.id, text: 'cannot bypass native block' }, alice);
			expect(castAsError(blocked.body).error.code).toBe('RECIPIENT_UNAVAILABLE');
		} finally {
			await api('blocking/delete', { userId: alice.id }, bob);
			await api('following/create', { userId: bob.id }, alice);
			await api('following/create', { userId: alice.id }, bob);
		}
	});

	test('read-all preserves unknown historical receipts; a new visible read records the current time', async () => {
		const message = await send('legacy fixture');
		const db = await initTestDb(true);
		await db.getRepository(MiChatMessage).update(message.id, { readTracked: false });
		await api('chat/read-all', {}, bob);
		let state = await api('chat/messages/state', { userId: alice.id, messageIds: [message.id] }, bob);
		expect(state.body.messages[0]).toMatchObject({ readState: 'unknown', readAt: null });
		await api('chat/messages/read', { userId: alice.id, messageIds: [message.id] }, bob);
		state = await api('chat/messages/state', { userId: alice.id, messageIds: [message.id] }, bob);
		expect(state.body.messages[0].readState).toBe('read');
	});

	test('viewing an older historical page does not clear the latest legacy unread flag', async () => {
		const older = await send('older legacy');
		const latest = await send('latest legacy');
		const db = await initTestDb(true);
		await db.getRepository(MiChatMessage).update([older.id, latest.id], { readTracked: false });
		await db.getRepository(MiChatLegacyUnread).upsert({ userId: bob.id, otherId: alice.id, messageId: latest.id, hasUnread: true }, ['userId', 'otherId']);
		await api('chat/messages/read', { userId: alice.id, messageIds: [older.id] }, bob);
		let conversations = await api('chat/conversations', {}, bob);
		expect(conversations.body.find(conversation => conversation.user.id === alice.id)?.hasLegacyUnread).toBe(true);
		await api('chat/messages/read', { userId: alice.id, messageIds: [latest.id] }, bob);
		conversations = await api('chat/conversations', {}, bob);
		expect(conversations.body.find(conversation => conversation.user.id === alice.id)?.hasLegacyUnread).toBe(false);
	});

	test('editing expires after 24 hours while recall stays available', async () => {
		const message = await send('old message fixture');
		const oldId = new IdService(loadConfig()).gen(Date.now() - 48 * 60 * 60 * 1000);
		const db = await initTestDb(true);
		await db.getRepository(MiChatMessage).update(message.id, { id: oldId });
		const edit = await api('chat/messages/update', { messageId: oldId, text: 'too late', expectedRevision: 0 }, alice);
		expect(castAsError(edit.body).error.code).toBe('EDIT_WINDOW_EXPIRED');
		expect((await api('chat/messages/delete', { messageId: oldId }, alice)).status).toBe(204);
	});

	test('the native group create, timeline and delete flow remains compatible', async () => {
		const room = await api('chat/rooms/create', { name: 'Existing group' }, alice);
		expect(room.status).toBe(200);
		const message = await api('chat/messages/create-to-room', { toRoomId: room.body.id, text: 'native group message' }, alice);
		expect(message.status).toBe(200);
		const history = await api('chat/messages/room-timeline', { roomId: room.body.id }, alice);
		expect(history.body.some(item => item.id === message.body.id)).toBe(true);
		expect((await api('chat/messages/delete', { messageId: message.body.id }, alice)).status).toBe(204);
	});

	test('native group fileId messages retain their existing Drive attachment behavior', async () => {
		const room = await api('chat/rooms/create', { name: 'Existing group attachment' }, alice);
		expect(room.status).toBe(200);
		const upload = await uploadFile(alice);
		expect(upload.status).toBe(200);
		const message = await api('chat/messages/create-to-room', { toRoomId: room.body.id, fileId: upload.body.id }, alice);
		expect(message.status).toBe(200);
		expect(message.body.fileId).toBe(upload.body.id);
		expect(message.body.file?.id).toBe(upload.body.id);
		const timeline = await api('chat/messages/room-timeline', { roomId: room.body.id }, alice);
		expect(timeline.body.find(item => item.id === message.body.id)?.file?.id).toBe(upload.body.id);
		expect((await api('chat/messages/delete', { messageId: message.body.id }, alice)).status).toBe(204);
	});
});
