/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_OUTBOX_TTL, chatOutboxKey, clearChatOutboxAccount, parseChatOutbox, saveChatOutbox } from '@/utility/chat-outbox-storage.js';
import { ChatOutbox } from '@/utility/chat-outbox.js';

beforeEach(() => window.sessionStorage.clear());

describe('Chat outbox reload recovery', () => {
	it.each(['CHAT_REPLY_REQUIRED', 'CHAT_FIRST_MESSAGE_TEXT_ONLY'] as const)('restores the safe %s hint without extending TTL or automatically sending', async (failureCode) => {
		const now = Date.now();
		const key = chatOutboxKey('alice', 'bob');
		const item = { snapshot: { clientMessageId: 'nonce', toUserId: 'bob', text: 'keep this' }, createdAt: new Date(now).toISOString(), status: 'failed' as const, failureCode };
		saveChatOutbox(window.sessionStorage, key, [item]);
		const send = vi.fn();
		const queue = new ChatOutbox(send, () => undefined, () => undefined);
		queue.items = parseChatOutbox(window.sessionStorage.getItem(key), 'bob', now + 1000);
		expect(queue.items[0]).toMatchObject(item);
		expect(send).not.toHaveBeenCalled();
		queue.expire(now + CHAT_OUTBOX_TTL);
		expect(queue.items[0].status).toBe('expired');
		expect(await queue.retry('nonce')).toBe(false);
		expect(send).not.toHaveBeenCalled();
	});
	it('rejects unrecognized or object-shaped persisted errors without dropping a valid draft', () => {
		const key = chatOutboxKey('alice', 'bob');
		const item = { snapshot: { clientMessageId: 'nonce', toUserId: 'bob', text: 'draft' }, createdAt: new Date().toISOString(), status: 'failed' as const };
		for (const failureCode of ['SECRET_SERVER_MESSAGE', { code: 'CHAT_REPLY_REQUIRED', token: 'secret' }]) {
			const restored = parseChatOutbox(JSON.stringify([{ ...item, failureCode }]), 'bob');
			expect(restored[0].failureCode).toBeUndefined();
			expect(restored[0].snapshot.text).toBe('draft');
			saveChatOutbox(window.sessionStorage, key, restored);
			expect(window.sessionStorage.getItem(key)).not.toContain('secret');
			expect(window.sessionStorage.getItem(key)).not.toContain('SECRET_SERVER_MESSAGE');
		}
	});
	it('persists only a bounded quoted target ID and rejects malformed quoted IDs', () => {
		const now = Date.now();
		const key = chatOutboxKey('alice', 'bob');
		const item = { snapshot: { clientMessageId: 'nonce', toUserId: 'bob', text: 'reply body', replyToId: 'quoted' }, createdAt: new Date(now).toISOString(), status: 'failed' as const };
		saveChatOutbox(window.sessionStorage, key, [item]);
		expect(parseChatOutbox(window.sessionStorage.getItem(key), 'bob', now)[0].snapshot).toMatchObject(item.snapshot);
		expect(parseChatOutbox(JSON.stringify([{ ...item, snapshot: { ...item.snapshot, replyToId: { token: 'no' } } }]), 'bob', now)).toEqual([]);
		expect(parseChatOutbox(JSON.stringify([{ ...item, snapshot: { ...item.snapshot, replyToId: 'a'.repeat(65) } }]), 'bob', now)).toEqual([]);
	});
	it('restores the same immutable nonce as failed without sending automatically', async () => {
		const now = Date.now();
		const key = chatOutboxKey('alice', 'bob');
		const original = { snapshot: { clientMessageId: 'nonce', toUserId: 'bob', text: 'original', attachmentIds: ['file'] }, createdAt: new Date(now).toISOString(), status: 'sending' as const };
		expect(saveChatOutbox(window.sessionStorage, key, [original])).toBe(true);
		const send = vi.fn().mockResolvedValue({ id: 'accepted' });
		const queue = new ChatOutbox(send, () => undefined, () => undefined);
		queue.items = parseChatOutbox(window.sessionStorage.getItem(key), 'bob', now);
		expect(queue.items[0].status).toBe('failed');
		expect(send).not.toHaveBeenCalled();
		await queue.retry('nonce');
		expect(send).toHaveBeenCalledWith(original.snapshot);
	});
	it('preserves 24-hour records as expired, rejects another recipient, bounds items and strips extra fields', () => {
		const now = Date.now();
		const item = { snapshot: { clientMessageId: 'nonce', toUserId: 'bob', text: 'hello', secret: 'must-not-persist' }, createdAt: new Date(now).toISOString(), token: 'must-not-persist' };
		expect(parseChatOutbox(JSON.stringify([item]), 'carol', now)).toEqual([]);
		const expired = parseChatOutbox(JSON.stringify([item]), 'bob', now + CHAT_OUTBOX_TTL);
		expect(expired).toHaveLength(1);
		expect(expired[0].status).toBe('expired');
		expect(expired[0].snapshot.text).toBe('hello');
		const restored = parseChatOutbox(JSON.stringify(Array.from({ length: 25 }, (_, index) => ({ ...item, snapshot: { ...item.snapshot, clientMessageId: String(index) } }))), 'bob', now);
		expect(restored).toHaveLength(20);
		expect(JSON.stringify(restored)).not.toContain('must-not-persist');
	});
	it('keeps expired recovery text in memory without extending its session-storage lifetime or retrying it', async () => {
		const key = chatOutboxKey('alice', 'bob');
		const snapshot = { clientMessageId: 'nonce', toUserId: 'bob', text: 'copy this', attachmentIds: ['gone'] };
		const item = { snapshot, createdAt: new Date().toISOString(), status: 'expired' as const };
		window.sessionStorage.setItem(key, JSON.stringify([item]));
		const send = vi.fn();
		const queue = new ChatOutbox(send, () => undefined, () => undefined);
		queue.items = parseChatOutbox(window.sessionStorage.getItem(key), 'bob');
		expect(saveChatOutbox(window.sessionStorage, key, queue.items)).toBe(true);
		expect(window.sessionStorage.getItem(key)).toBeNull();
		expect(queue.items[0].status).toBe('expired');
		expect(await queue.retry('nonce')).toBe(false);
		expect(send).not.toHaveBeenCalled();
		expect(queue.discard('nonce')).toEqual(snapshot);
	});
	it('removes aged stored records even before the UI has marked them expired', () => {
		const key = chatOutboxKey('alice', 'bob');
		const item = { snapshot: { clientMessageId: 'nonce', toUserId: 'bob', text: 'old draft' }, createdAt: new Date(Date.now() - CHAT_OUTBOX_TTL).toISOString(), status: 'failed' as const };
		window.sessionStorage.setItem(key, JSON.stringify([item]));
		expect(saveChatOutbox(window.sessionStorage, key, [item])).toBe(true);
		expect(window.sessionStorage.getItem(key)).toBeNull();
		expect(item.snapshot.text).toBe('old draft');
	});
	it('handles storage denial without discarding the memory snapshot and clears only the signed-out account', () => {
		const items = [{ snapshot: { clientMessageId: 'nonce', toUserId: 'bob', text: 'draft' }, createdAt: new Date().toISOString(), status: 'failed' as const }];
		expect(saveChatOutbox({ setItem: () => { throw new Error('denied'); } } as unknown as Storage, 'key', items)).toBe(false);
		expect(items[0].snapshot.text).toBe('draft');
		window.sessionStorage.setItem(chatOutboxKey('alice', 'bob'), '[]');
		window.sessionStorage.setItem(chatOutboxKey('carol', 'bob'), '[]');
		clearChatOutboxAccount('alice');
		expect(window.sessionStorage.getItem(chatOutboxKey('alice', 'bob'))).toBeNull();
		expect(window.sessionStorage.getItem(chatOutboxKey('carol', 'bob'))).toBe('[]');
	});
});
