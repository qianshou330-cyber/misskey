/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const account = vi.hoisted(() => ({ id: 'alice', token: 'test-only-credential', policies: { maxFileSizeMb: 100 } }));
vi.mock('@/i.js', () => ({ $i: account }));
vi.mock('@@/js/config.js', () => ({ apiUrl: 'https://example.invalid/api' }));
import { fetchChatAttachment, uploadChatAttachment } from '@/utility/chat-media.js';
import { ChatMediaBudget } from '@/utility/chat-media-budget.js';

afterEach(() => { account.id = 'alice'; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function response(bytes: number[], headers: Record<string, string> = {}) {
	return { ok: true, headers: new Headers(headers), body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(bytes)); controller.close(); } }) };
}

describe('Chat private media transport', () => {
	it.each(['file', 'voice'] as const)('preserves only whitelisted business errors from %s XHR uploads', async (kind) => {
		const active: { xhr?: { status: number; response: unknown; onload: () => void } } = {};
		vi.stubGlobal('XMLHttpRequest', class {
			public upload = {};
			public status = 400;
			public response: unknown;
			public onload = () => undefined;
			public constructor() { active.xhr = this; }
			public open(): void {}
			public setRequestHeader(): void {}
			public send(): void {}
		});
		for (const code of ['CHAT_REPLY_REQUIRED', 'CHAT_FIRST_MESSAGE_TEXT_ONLY']) {
			const request = uploadChatAttachment(new File(['test'], 'sample.webm'), 'bob', kind, () => undefined);
			active.xhr!.response = { error: { code, message: 'do not expose', extra: 'secret' } };
			active.xhr!.onload();
			await expect(request.promise).rejects.toEqual({ code });
		}
		const unknown = uploadChatAttachment(new File(['test'], 'sample.webm'), 'bob', kind, () => undefined);
		active.xhr!.response = { error: { code: 'INTERNAL_ERROR', message: 'do not expose' } };
		active.xhr!.onload();
		await expect(unknown.promise).rejects.toThrow('CHAT_ATTACHMENT_UPLOAD_FAILED');
	});
	it('exposes only bounded authorized chunks and invalidates access after release', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([1, 2, 3], { 'Content-Type': 'text/plain' })));
		const lease = await fetchChatAttachment('file', 'download', undefined, 3);
		expect(lease.type).toBe('text/plain');
		expect(Array.from(await lease.readChunk(1, 3))).toEqual([2, 3]);
		await expect(lease.readChunk(-1, 1)).rejects.toThrow('CHAT_MEDIA_BUDGET');
		await expect(lease.readChunk(0, 4)).rejects.toThrow('CHAT_MEDIA_BUDGET');
		lease.release();
		await expect(lease.readChunk(0, 1)).rejects.toThrow('CHAT_ATTACHMENT_UNAVAILABLE');
	});
	it('blocks bytes and object URLs after the current account changes', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([1, 2, 3])));
		const lease = await fetchChatAttachment('file', 'download', undefined, 3);
		account.id = 'bob';
		await expect(lease.readChunk(0, 1)).rejects.toThrow('CHAT_ATTACHMENT_UNAVAILABLE');
		expect(() => lease.createObjectURL()).toThrow('CHAT_ATTACHMENT_UNAVAILABLE');
		lease.release();
	});
	it('uses authorization headers, never credential URLs or cacheable content requests', async () => {
		const fetcher = vi.fn().mockResolvedValue(response([1, 2, 3]));
		vi.stubGlobal('fetch', fetcher);
		const lease = await fetchChatAttachment('file id', 'preview');
		expect(lease.size).toBe(3);
		expect(fetcher).toHaveBeenCalledWith('https://example.invalid/api/chat/attachments/file%20id/preview', expect.objectContaining({ headers: { Authorization: 'Bearer test-only-credential' }, cache: 'no-store', credentials: 'omit' }));
		lease.release();
	});
	it('rejects unauthorized binary access instead of displaying an error response as media', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
		await expect(fetchChatAttachment('file', 'original')).rejects.toThrow('CHAT_ATTACHMENT_UNAVAILABLE');
	});
	it('enforces the private file cap before uploading', async () => {
		const file = new File(['x'], 'large.mp3');
		Object.defineProperty(file, 'size', { value: 51 * 1024 * 1024 });
		await expect(uploadChatAttachment(file, 'bob', 'file', () => undefined).promise).rejects.toThrow('CHAT_ATTACHMENT_SIZE');
	});
	it('caps streamed original content even when Content-Length is missing', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([1, 2, 3])));
		await expect(fetchChatAttachment('file', 'original', undefined, 2)).rejects.toThrow('CHAT_MEDIA_BUDGET');
	});
	it('releases the Blob URL and its budget once when cancelled after download', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([1])));
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:private');
		const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
		const controller = new AbortController();
		const lease = await fetchChatAttachment('file', 'download', controller.signal, 1);
		expect(lease.createObjectURL()).toBe('blob:private');
		controller.abort();
		lease.release();
		expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:private');
		expect(() => lease.createObjectURL()).toThrow('CHAT_ATTACHMENT_UNAVAILABLE');
	});
	it('cancels a partial response stream instead of retaining its reservation', async () => {
		const cancel = vi.fn();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1])); }, cancel }) }));
		const controller = new AbortController();
		const fetching = fetchChatAttachment('file', 'original', controller.signal, 2);
		await Promise.resolve();
		controller.abort();
		await expect(fetching).rejects.toThrow();
		expect(cancel).toHaveBeenCalledOnce();
	});
	it('automatically starts the third media request after a shared slot completes', async () => {
		const finish: ((value: ReturnType<typeof response>) => void)[] = [];
		vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { finish.push(resolve); })));
		const first = fetchChatAttachment('first', 'original');
		const second = fetchChatAttachment('second', 'download');
		const third = fetchChatAttachment('third', 'preview');
		await Promise.resolve();
		expect(finish).toHaveLength(2);
		finish[0](response([1]));
		await vi.waitFor(() => expect(finish).toHaveLength(3));
		finish[1](response([1])); finish[2](response([1]));
		const leases = await Promise.all([first, second, third]);
		leases.forEach(lease => lease.release());
	});
});

describe('Chat media shared budget', () => {
	it('caps waiting requests and removes an aborted waiter before allocating any bytes', async () => {
		const budget = new ChatMediaBudget(1, 10, 1);
		const first = await budget.acquire(4);
		const controller = new AbortController();
		const waiting = budget.acquire(4, controller.signal);
		expect(budget.pendingRequests).toBe(1);
		expect(budget.retainedBytes).toBe(4);
		await expect(budget.acquire(1)).rejects.toThrow('CHAT_MEDIA_BUDGET');
		controller.abort();
		await expect(waiting).rejects.toThrow();
		expect(budget.pendingRequests).toBe(0);
		first.release();
		expect(budget.retainedBytes).toBe(0);
	});
	it('bounds all concurrent requests and retained payloads, with idempotent release', () => {
		const budget = new ChatMediaBudget(2, 10);
		const first = budget.reserve(4);
		const second = budget.reserve(4);
		expect(() => budget.reserve(1)).toThrow('CHAT_MEDIA_BUDGET');
		first.complete(3);
		second.complete(4);
		expect(budget.activeRequests).toBe(0);
		expect(budget.retainedBytes).toBe(7);
		expect(() => budget.reserve(4)).toThrow('CHAT_MEDIA_BUDGET');
		first.release(); first.release();
		const third = budget.reserve(6);
		expect(budget.retainedBytes).toBe(10);
		third.release(); second.release();
		expect(budget.retainedBytes).toBe(0);
		expect(budget.activeRequests).toBe(0);
	});
});
