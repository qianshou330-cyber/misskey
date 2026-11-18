/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelNativeDownload, registerNativeDownloadAbort, saveNativeDownload } from '@/utility/native-download.js';
import type { NativeDownloadSource } from '@/utility/native-download.js';

type Message = { v: number; type: string; id: string; size?: number; seq?: number; dataBase64?: string };

function makeSource(size = 3): NativeDownloadSource {
	return { size, type: 'application/octet-stream', readChunk: vi.fn(async (start, end) => new Uint8Array(end - start).fill(42)), release: vi.fn() };
}

function installBridge(respond = true) {
	const messages: Message[] = [];
	const bridge = { onmessage: null as ((event: { data: string }) => void) | null, postMessage: vi.fn((data: string) => {
		const message = JSON.parse(data) as Message;
		messages.push(message);
		if (respond && message.type !== 'cancel') {
			bridge.onmessage?.({ data: JSON.stringify({ v: 1, id: message.id, type: message.type === 'begin' ? 'ready' : message.type === 'chunk' ? 'ack' : 'complete', seq: message.seq }) });
		}
	}) };
	vi.stubGlobal('PuboNativeDownload', bridge);
	return { bridge, messages, reply(type: string, extra: Record<string, unknown> = {}) { bridge.onmessage?.({ data: JSON.stringify({ v: 1, id: messages[0].id, type, ...extra }) }); } };
}

beforeEach(() => {
	vi.stubGlobal('location', { origin: 'https://bolubo.com' });
	vi.stubGlobal('self', window);
	vi.stubGlobal('top', window);
	vi.stubGlobal('PuboNativeDownload', undefined);
});
afterEach(() => { cancelNativeDownload(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('PUBO native private attachment saving', () => {
	it('leaves the original browser Blob download path untouched', async () => {
		const source = makeSource();
		expect(await saveNativeDownload(source, 'a.bin', new AbortController().signal, () => true)).toBe(false);
		expect(source.readChunk).not.toHaveBeenCalled();
		expect(source.release).not.toHaveBeenCalled();
	});
	it('requires a bridge update in the Android app instead of silently attempting a blob download', async () => {
		vi.stubGlobal('navigator', { userAgent: 'Android PUBOAndroid/1.0.0' });
		await expect(saveNativeDownload(makeSource(), 'a', new AbortController().signal, () => true)).rejects.toMatchObject({ code: 'unsupported' });
	});
	it.each(['http://bolubo.com', 'https://evil.example', 'https://bolubo.com.evil.example'])('never invokes a bridge on %s', async origin => {
		const { bridge } = installBridge();
		vi.stubGlobal('location', { origin });
		await expect(saveNativeDownload(makeSource(), 'a', new AbortController().signal, () => true)).rejects.toMatchObject({ code: 'unsupported' });
		expect(bridge.postMessage).not.toHaveBeenCalled();
	});
	it('rejects subframes even on the allowed origin', async () => {
		const { bridge } = installBridge();
		vi.stubGlobal('top', {});
		await expect(saveNativeDownload(makeSource(), 'a', new AbortController().signal, () => true)).rejects.toMatchObject({ code: 'unsupported' });
		expect(bridge.postMessage).not.toHaveBeenCalled();
	});
	it('sends bounded chunks in order after readiness and each acknowledgement, without URLs or credentials', async () => {
		const source = makeSource(131073);
		const { messages, bridge } = installBridge();
		expect(await saveNativeDownload(source, 'photo.png', new AbortController().signal, () => true)).toBe(true);
		expect(messages.map(message => message.type)).toEqual(['begin', 'chunk', 'chunk', 'chunk', 'finish']);
		expect(messages.filter(message => message.type === 'chunk').map(message => [message.seq, atob(message.dataBase64!).length])).toEqual([[0, 65536], [1, 65536], [2, 1]]);
		expect(Object.keys(messages[0]).sort()).toEqual(['id', 'mime', 'name', 'size', 'type', 'v']);
		expect(JSON.stringify(messages)).not.toMatch(/token|Authorization|Bearer|https:/);
		expect(source.release).toHaveBeenCalledOnce();
		expect(bridge.onmessage).toBeNull();
	});
	it('allows an empty file and finishes without a chunk', async () => {
		const { messages } = installBridge();
		await saveNativeDownload(makeSource(0), 'empty', new AbortController().signal, () => true);
		expect(messages.map(message => message.type)).toEqual(['begin', 'finish']);
	});
	it.each([-1, 50 * 1024 * 1024 + 1, NaN, 0.5])('rejects invalid size %s before opening the chooser', async size => {
		const { messages } = installBridge();
		await expect(saveNativeDownload(makeSource(size), 'a', new AbortController().signal, () => true)).rejects.toMatchObject({ code: 'size' });
		expect(messages).toEqual([]);
	});
	it('accepts exactly 50 MiB without reading it before destination selection', async () => {
		const { reply, messages } = installBridge(false);
		const source = makeSource(50 * 1024 * 1024);
		const result = saveNativeDownload(source, 'limit.bin', new AbortController().signal, () => true);
		expect(messages[0].size).toBe(50 * 1024 * 1024);
		expect(source.readChunk).not.toHaveBeenCalled();
		reply('cancelled');
		await expect(result).rejects.toMatchObject({ code: 'cancelled' });
	});
	it('keeps bytes unread until the user chooses a destination', async () => {
		const source = makeSource();
		const { reply, messages } = installBridge(false);
		const result = saveNativeDownload(source, 'a', new AbortController().signal, () => true);
		expect(source.readChunk).not.toHaveBeenCalled();
		reply('cancelled');
		await expect(result).rejects.toMatchObject({ code: 'cancelled' });
		expect(source.release).toHaveBeenCalled();
		expect(messages.map(message => message.type)).toEqual(['begin', 'cancel']);
	});
	it('cancels pending authorized fetches as soon as logout/account switching begins', () => {
		const controller = new AbortController();
		const unregister = registerNativeDownloadAbort(controller);
		cancelNativeDownload();
		expect(controller.signal.aborted).toBe(true);
		unregister();
	});
	it('also cancels an attachment fetch when the account changes before the native chooser opens', () => {
		const controller = new AbortController();
		const unregister = registerNativeDownloadAbort(controller);
		window.dispatchEvent(new StorageEvent('storage', { key: 'account' }));
		expect(controller.signal.aborted).toBe(true);
		unregister();
	});
	it.each(['pagehide', 'popstate'])('clears the active transfer on %s', async eventName => {
		const source = makeSource();
		installBridge(false);
		const result = saveNativeDownload(source, 'a', new AbortController().signal, () => true);
		window.dispatchEvent(new Event(eventName));
		await expect(result).rejects.toMatchObject({ code: 'cancelled' });
		expect(source.release).toHaveBeenCalled();
	});
	it('clears an active transfer when account storage changes in another tab', async () => {
		installBridge(false);
		const result = saveNativeDownload(makeSource(), 'a', new AbortController().signal, () => true);
		window.dispatchEvent(new StorageEvent('storage', { key: 'account' }));
		await expect(result).rejects.toMatchObject({ code: 'cancelled' });
	});
	it('aborts on unmount or explicit cancellation and releases private content', async () => {
		const source = makeSource();
		installBridge(false);
		const controller = new AbortController();
		const result = saveNativeDownload(source, 'a', controller.signal, () => true);
		controller.abort();
		await expect(result).rejects.toMatchObject({ code: 'cancelled' });
		expect(source.release).toHaveBeenCalled();
	});
	it('rechecks the account before accepting a callback', async () => {
		let sameAccount = true;
		const { reply, messages } = installBridge(false);
		const source = makeSource();
		const result = saveNativeDownload(source, 'a', new AbortController().signal, () => sameAccount);
		sameAccount = false;
		reply('ready');
		await expect(result).rejects.toMatchObject({ code: 'cancelled' });
		expect(messages.some(message => message.type === 'chunk')).toBe(false);
	});
	it('permits only one in-flight save', async () => {
		const { reply } = installBridge(false);
		const first = saveNativeDownload(makeSource(), 'a', new AbortController().signal, () => true);
		await expect(saveNativeDownload(makeSource(), 'b', new AbortController().signal, () => true)).rejects.toMatchObject({ code: 'busy' });
		reply('cancelled');
		await expect(first).rejects.toMatchObject({ code: 'cancelled' });
	});
	it('rejects out-of-order acknowledgements and cancels the native output', async () => {
		const { reply, messages } = installBridge(false);
		const result = saveNativeDownload(makeSource(), 'a', new AbortController().signal, () => true);
		reply('ready');
		await vi.waitFor(() => expect(messages.at(-1)?.type).toBe('chunk'));
		reply('ack', { seq: 7 });
		await expect(result).rejects.toMatchObject({ code: 'failed' });
		expect(messages.at(-1)?.type).toBe('cancel');
	});
	it('ignores unrelated and malformed replies without disclosing content', async () => {
		const source = makeSource();
		const { bridge, reply } = installBridge(false);
		const result = saveNativeDownload(source, 'a', new AbortController().signal, () => true);
		bridge.onmessage?.({ data: 'not json' });
		reply('ready', { id: 'another-transfer' });
		expect(source.readChunk).not.toHaveBeenCalled();
		reply('cancelled');
		await expect(result).rejects.toMatchObject({ code: 'cancelled' });
	});
	it('surfaces native write failures without displaying arbitrary native strings', async () => {
		const { reply } = installBridge(false);
		const result = saveNativeDownload(makeSource(), 'a', new AbortController().signal, () => true);
		reply('error', { code: '<img src=x onerror=alert(1)>' });
		await expect(result).rejects.toMatchObject({ code: 'failed', message: 'NATIVE_DOWNLOAD_failed' });
	});
	it('times out the chooser and cancels the partial destination', async () => {
		vi.useFakeTimers();
		const { messages } = installBridge(false);
		const result = saveNativeDownload(makeSource(), 'a', new AbortController().signal, () => true);
		const assertion = expect(result).rejects.toMatchObject({ code: 'timeout' });
		await vi.advanceTimersByTimeAsync(120000);
		await assertion;
		expect(messages.at(-1)?.type).toBe('cancel');
	});
	it('times out a missing chunk acknowledgement after 30 seconds', async () => {
		vi.useFakeTimers();
		const { reply, messages } = installBridge(false);
		const result = saveNativeDownload(makeSource(), 'a', new AbortController().signal, () => true);
		const assertion = expect(result).rejects.toMatchObject({ code: 'timeout' });
		reply('ready');
		await vi.advanceTimersByTimeAsync(0);
		expect(messages.at(-1)?.type).toBe('chunk');
		await vi.advanceTimersByTimeAsync(30000);
		await assertion;
		expect(messages.at(-1)?.type).toBe('cancel');
	});
});
