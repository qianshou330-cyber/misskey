/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import { ChatOutbox } from '@/utility/chat-outbox.js';
import { CHAT_OUTBOX_TTL } from '@/utility/chat-outbox-storage.js';

describe('Chat reliable outbox', () => {
	it.each(['CHAT_REPLY_REQUIRED', 'CHAT_FIRST_MESSAGE_TEXT_ONLY'] as const)('keeps %s on the original manual retry without retaining server details', async (code) => {
		const send = vi.fn().mockRejectedValueOnce({ code, message: 'private server details', stack: 'secret' }).mockResolvedValueOnce({ id: 'accepted' });
		const queue = new ChatOutbox(send, () => undefined, () => undefined);
		await queue.enqueue({ clientMessageId: 'nonce', toUserId: 'peer', text: 'keep this draft' });
		expect(queue.items[0]).toMatchObject({ status: 'failed', failureCode: code });
		expect(JSON.stringify(queue.items)).not.toContain('private server details');
		const createdAt = queue.items[0].createdAt;
		queue.confirm('different-incoming-reply');
		await Promise.resolve();
		expect(send).toHaveBeenCalledOnce();
		expect(queue.items[0].createdAt).toBe(createdAt);
		await queue.retry('nonce');
		expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);
		expect(queue.items).toHaveLength(0);
	});
	it('drops an obsolete business hint when an explicit retry instead fails on the network', async () => {
		const send = vi.fn().mockRejectedValueOnce({ code: 'CHAT_REPLY_REQUIRED' }).mockRejectedValueOnce(new Error('offline'));
		const queue = new ChatOutbox(send, () => undefined, () => undefined);
		await queue.enqueue({ clientMessageId: 'nonce', toUserId: 'peer', text: 'draft' });
		await queue.retry('nonce');
		expect(queue.items[0]).toMatchObject({ status: 'failed', failureCode: undefined });
	});
	it('freezes the quoted target with the original text and nonce after an offline send', async () => {
		const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ id: 'accepted' });
		const queue = new ChatOutbox(send, () => undefined, () => undefined);
		const draft = { clientMessageId: 'nonce', toUserId: 'peer', text: 'reply body', replyToId: 'target' };
		await queue.enqueue(draft);
		draft.replyToId = 'different'; draft.text = 'new draft';
		await queue.retry('nonce');
		expect(send.mock.calls[1][0]).toMatchObject({ clientMessageId: 'nonce', replyToId: 'target', text: 'reply body' });
	});
	it('retries the original snapshot with the same nonce after a timeout', async () => {
		const send = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ id: 'server-id' });
		const accepted = vi.fn();
		const queue = new ChatOutbox(send, () => undefined, accepted);
		const draft = { clientMessageId: 'nonce', toUserId: 'user', text: 'original', attachmentIds: ['file'] };
		queue.enqueue(draft);
		draft.text = 'new typing';
		draft.attachmentIds.push('different');
		await vi.waitFor(() => expect(queue.items[0].status).toBe('failed'));
		await queue.retry('nonce');
		expect(send.mock.calls[1][0]).toEqual({ clientMessageId: 'nonce', toUserId: 'user', text: 'original', attachmentIds: ['file'] });
		expect(queue.items).toHaveLength(0);
		expect(accepted).toHaveBeenCalledOnce();
	});
	it('does not issue duplicate simultaneous requests and accepts a stream acknowledgement', async () => {
		let finish!: (value: unknown) => void;
		const send = vi.fn(() => new Promise(resolve => { finish = resolve; }));
		const queue = new ChatOutbox(send, () => undefined, () => undefined);
		queue.enqueue({ clientMessageId: 'nonce', toUserId: 'user', text: 'hello' });
		await queue.retry('nonce');
		expect(send).toHaveBeenCalledOnce();
		queue.confirm('nonce');
		finish({ id: 'id' });
		await Promise.resolve();
		expect(queue.items).toHaveLength(0);
	});
	it('marks 24-hour failures expired without losing text or sending the same attachment again', async () => {
		const send = vi.fn().mockRejectedValue(new Error('offline'));
		const changed = vi.fn();
		const queue = new ChatOutbox(send, changed, () => undefined);
		await queue.enqueue({ clientMessageId: 'nonce', toUserId: 'user', text: 'keep for copying', attachmentIds: ['file'] });
		const now = Date.now();
		queue.items[0].createdAt = new Date(now - CHAT_OUTBOX_TTL).toISOString();
		expect(queue.expire(now)).toBe(1);
		expect(queue.items[0].status).toBe('expired');
		expect(queue.items[0].snapshot.text).toBe('keep for copying');
		expect(queue.expire(now)).toBe(0);
		expect(await queue.retry('nonce')).toBe(false);
		expect(send).toHaveBeenCalledOnce();
	});
	it('checks expiry at retry even if the UI timer has not run', async () => {
		const send = vi.fn();
		const queue = new ChatOutbox(send, () => undefined, () => undefined);
		queue.items = [{ snapshot: { clientMessageId: 'nonce', toUserId: 'user', text: 'draft' }, createdAt: new Date(Date.now() - CHAT_OUTBOX_TTL).toISOString(), status: 'failed' }];
		expect(await queue.retry('nonce')).toBe(false);
		expect(queue.items[0].status).toBe('expired');
		expect(send).not.toHaveBeenCalled();
	});
	it('returns a settled discarded snapshot for attachment cleanup and frees queue capacity', async () => {
		const send = vi.fn().mockRejectedValue(new Error('offline'));
		const queue = new ChatOutbox(send, () => undefined, () => undefined);
		await queue.enqueue({ clientMessageId: 'nonce', toUserId: 'user', text: 'draft', attachmentIds: ['file'] });
		const original = queue.items[0].snapshot;
		const discarded = queue.discard('nonce');
		expect(discarded).toEqual(original);
		discarded!.attachmentIds!.push('changed outside queue');
		expect(original.attachmentIds).toEqual(['file']);
		expect(queue.items).toHaveLength(0);
		expect(queue.discard('nonce')).toBeNull();
		expect(await queue.retry('nonce')).toBe(false);
	});
	it('does not expire or discard in-flight sends and never resurrects a stream-confirmed failure', async () => {
		let fail!: (error: Error) => void;
		const send = vi.fn(() => new Promise((_resolve, reject) => { fail = reject; }));
		const queue = new ChatOutbox(send, () => undefined, () => undefined);
		const pending = queue.enqueue({ clientMessageId: 'nonce', toUserId: 'user', text: 'draft' });
		queue.items[0].createdAt = new Date(Date.now() - CHAT_OUTBOX_TTL).toISOString();
		expect(queue.expire()).toBe(0);
		expect(queue.discard('nonce')).toBeNull();
		queue.confirm('nonce');
		fail(new Error('late timeout'));
		expect(await pending).toBe(true);
		expect(queue.items).toHaveLength(0);
	});
	it('expires a request that crosses the TTL while waiting for a failed response', async () => {
		let fail!: (error: Error) => void;
		const queue = new ChatOutbox(() => new Promise((_resolve, reject) => { fail = reject; }), () => undefined, () => undefined);
		const pending = queue.enqueue({ clientMessageId: 'nonce', toUserId: 'user', text: 'draft' });
		queue.items[0].createdAt = new Date(Date.now() - CHAT_OUTBOX_TTL).toISOString();
		fail(new Error('timeout'));
		expect(await pending).toBe(false);
		expect(queue.items[0].status).toBe('expired');
		expect(queue.discard('nonce')?.text).toBe('draft');
	});
	it('stops retrying unavailable attachment IDs but leaves network and permission errors retryable', async () => {
		for (const [code, expected] of [['ATTACHMENTS_UNAVAILABLE', 'expired'], ['PERMISSION_DENIED', 'failed'], ['ROLE_PERMISSION_DENIED', 'failed']]) {
			const send = vi.fn().mockRejectedValue({ code });
			const queue = new ChatOutbox(send, () => undefined, () => undefined);
			await queue.enqueue({ clientMessageId: 'nonce', toUserId: 'user', text: 'draft', attachmentIds: ['file'] });
			expect(queue.items[0].status).toBe(expected);
			if (expected === 'expired') { expect(await queue.retry('nonce')).toBe(false); expect(send).toHaveBeenCalledOnce(); }
		}
	});
});
