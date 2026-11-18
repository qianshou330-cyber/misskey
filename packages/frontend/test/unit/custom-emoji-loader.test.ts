/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { entities } from 'misskey-js';
import { CustomEmojiLoader } from '@/utility/custom-emoji-loader.js';

type Emoji = entities.EmojiSimple;

function emoji(name: string, url = `https://example.test/${name}.webp`): Emoji {
	return { name, aliases: [name], url, category: 'test' };
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
	return { promise, resolve, reject };
}

async function flush() {
	for (let index = 0; index < 12; index++) await Promise.resolve();
}

function fixture() {
	let current: Emoji[] = [];
	const dependencies = {
		readCache: vi.fn(async (): Promise<{ emojis: unknown; fetchedAt: unknown }> => ({ emojis: undefined, fetchedAt: undefined })),
		writeCache: vi.fn(async (_emojis: Emoji[], _fetchedAt: number, _isCurrent: () => boolean) => {}),
		request: vi.fn(async (_force: boolean, _signal: AbortSignal): Promise<{ emojis: unknown }> => ({ emojis: [emoji('fresh')] })),
		changed: vi.fn((emojis: Emoji[]) => { current = emojis; }),
	};
	return { loader: new CustomEmojiLoader(dependencies), dependencies, current: () => current };
}

describe('optional custom emoji loading', () => {
	beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-30T08:00:00Z')); });
	afterEach(() => { vi.useRealTimers(); });

	it('constructs without touching storage or HTTP', () => {
		const { dependencies, current } = fixture();
		expect(dependencies.readCache).not.toHaveBeenCalled();
		expect(dependencies.request).not.toHaveBeenCalled();
		expect(current()).toEqual([]);
	});

	it.each([{ emojis: [] }, { emojis: [emoji('cached')] }])('uses a valid fresh cache, including an empty list', async ({ emojis }) => {
		const { loader, dependencies, current } = fixture();
		dependencies.readCache.mockResolvedValue({ emojis, fetchedAt: Date.now() - 5000 });
		await loader.fetch();
		expect(current()).toEqual(emojis);
		expect(dependencies.request).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each([
		{ emojis: undefined, fetchedAt: 1793347199000 },
		{ emojis: [{ name: 'broken' }], fetchedAt: 1793347199000 },
		{ emojis: [emoji('cached')], fetchedAt: undefined },
		{ emojis: [emoji('cached')], fetchedAt: '1793347199000' },
		{ emojis: [emoji('cached')], fetchedAt: NaN },
		{ emojis: [emoji('cached')], fetchedAt: Infinity },
		{ emojis: [emoji('cached')], fetchedAt: 0 },
		{ emojis: [emoji('cached')], fetchedAt: 1793350800000 },
		{ emojis: [emoji('cached')], fetchedAt: 1793336400000 },
	])('refreshes absent, malformed, expired or future-dated cache %#', async cache => {
		const { loader, dependencies, current } = fixture();
		dependencies.readCache.mockResolvedValue(cache);
		await loader.fetch();
		expect(dependencies.request).toHaveBeenCalledOnce();
		expect(dependencies.request.mock.calls[0][0]).toBe(false);
		expect(current()).toEqual([emoji('fresh')]);
	});

	it('continues after cache read failure', async () => {
		const { loader, dependencies, current } = fixture();
		dependencies.readCache.mockRejectedValue(new Error('storage denied'));
		await loader.fetch();
		expect(current()).toEqual([emoji('fresh')]);
	});

	it('bounds the cache read at one second and ignores its late result', async () => {
		const { loader, dependencies, current } = fixture();
		const cache = deferred<{ emojis: unknown; fetchedAt: unknown }>();
		dependencies.readCache.mockReturnValue(cache.promise);
		const loading = loader.fetch();
		await vi.advanceTimersByTimeAsync(999);
		expect(dependencies.request).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		await loading;
		cache.resolve({ emojis: [emoji('old')], fetchedAt: Date.now() });
		await flush();
		expect(current()).toEqual([emoji('fresh')]);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('shares concurrent ordinary requests and aborts a hung request at eight seconds', async () => {
		const { loader, dependencies, current } = fixture();
		dependencies.request.mockReturnValue(new Promise(() => {}));
		const loading = loader.fetch();
		const outcome = loading.catch(error => error);
		expect(loader.fetch()).toBe(loading);
		await flush();
		await vi.advanceTimersByTimeAsync(7999);
		expect(dependencies.request.mock.calls[0][1].aborted).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		expect((await outcome).name).toBe('TimeoutError');
		expect(dependencies.request.mock.calls[0][1].aborted).toBe(true);
		expect(current()).toEqual([]);
		expect(dependencies.writeCache).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('retains stale cached emojis and timestamp after a failed request', async () => {
		const { loader, dependencies, current } = fixture();
		dependencies.readCache.mockResolvedValue({ emojis: [emoji('cached')], fetchedAt: Date.now() - 7200000 });
		dependencies.request.mockRejectedValue(new Error('offline'));
		await expect(loader.fetch()).rejects.toThrow('offline');
		expect(current()).toEqual([emoji('cached')]);
		expect(dependencies.writeCache).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('rejects an invalid response without replacing the cache or marking success', async () => {
		const { loader, dependencies, current } = fixture();
		dependencies.readCache.mockResolvedValue({ emojis: [emoji('cached')], fetchedAt: Date.now() - 7200000 });
		dependencies.request.mockResolvedValue({ emojis: [{ name: 'invalid' }] });
		await expect(loader.fetch()).rejects.toThrow('Invalid emoji response');
		expect(current()).toEqual([emoji('cached')]);
		expect(dependencies.writeCache).not.toHaveBeenCalled();
	});

	it('force refresh replaces an ordinary request and ignores the older response', async () => {
		const { loader, dependencies, current } = fixture();
		const old = deferred<{ emojis: unknown }>();
		const fresh = deferred<{ emojis: unknown }>();
		dependencies.request.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
		const first = loader.fetch().catch(error => error);
		await flush();
		const force = loader.fetch(true);
		expect(loader.fetch()).toBe(force);
		expect(loader.fetch(true)).toBe(force);
		expect((await first).name).toBe('AbortError');
		expect(dependencies.request.mock.calls.map(call => call[0])).toEqual([false, true]);
		fresh.resolve({ emojis: [emoji('new')] });
		await force;
		old.resolve({ emojis: [emoji('old')] });
		await flush();
		expect(current()).toEqual([emoji('new')]);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('force bypasses a fresh cache and exposes a real failure', async () => {
		const { loader, dependencies, current } = fixture();
		dependencies.readCache.mockResolvedValue({ emojis: [emoji('cached')], fetchedAt: Date.now() });
		await loader.fetch();
		dependencies.request.mockRejectedValue(new Error('force failed'));
		await expect(loader.fetch(true)).rejects.toThrow('force failed');
		expect(dependencies.request.mock.calls[0][0]).toBe(true);
		expect(current()).toEqual([emoji('cached')]);
	});

	it('late cache cannot overwrite a fast force result', async () => {
		const { loader, dependencies, current } = fixture();
		const cache = deferred<{ emojis: unknown; fetchedAt: unknown }>();
		dependencies.readCache.mockReturnValue(cache.promise);
		await loader.fetch(true);
		cache.resolve({ emojis: [emoji('old')], fetchedAt: Date.now() });
		await flush();
		expect(current()).toEqual([emoji('fresh')]);
	});

	it('replays add, update and delete events during cache and HTTP loading', async () => {
		const { loader, dependencies, current } = fixture();
		const cache = deferred<{ emojis: unknown; fetchedAt: unknown }>();
		const response = deferred<{ emojis: unknown }>();
		dependencies.readCache.mockReturnValue(cache.promise);
		dependencies.request.mockReturnValue(response.promise);
		const loading = loader.fetch();
		loader.add(emoji('added'));
		loader.update([emoji('updated', 'https://example.test/new.webp')]);
		loader.remove([emoji('deleted')]);
		cache.resolve({ emojis: [emoji('updated'), emoji('deleted')], fetchedAt: 0 });
		await flush();
		expect(current().map(item => item.name)).toEqual(['updated', 'added']);
		loader.add(emoji('during-http'));
		response.resolve({ emojis: [emoji('updated'), emoji('deleted'), emoji('base')] });
		await loading;
		expect(current().map(item => item.name)).toEqual(['updated', 'base', 'added', 'during-http']);
		expect(current()[0].url).toBe('https://example.test/new.webp');
	});

	it('does not persist a partial stream-only snapshot before cache hydration', () => {
		const { loader, dependencies } = fixture();
		loader.add(emoji('added'));
		loader.update([emoji('updated')]);
		loader.remove([emoji('deleted')]);
		expect(dependencies.writeCache).not.toHaveBeenCalled();
	});

	it('treats write failures as optional and permits later writes', async () => {
		const { loader, dependencies, current } = fixture();
		dependencies.writeCache.mockRejectedValueOnce(new Error('disk unavailable'));
		await loader.fetch();
		await flush();
		loader.add(emoji('next'));
		await flush();
		expect(current().map(item => item.name)).toEqual(['next', 'fresh']);
		expect(dependencies.writeCache).toHaveBeenCalledTimes(2);
	});

	it('serializes writes and skips obsolete queued snapshots', async () => {
		const { loader, dependencies } = fixture();
		const firstWrite = deferred<void>();
		dependencies.writeCache.mockReturnValueOnce(firstWrite.promise);
		await loader.fetch();
		await flush();
		loader.add(emoji('second'));
		loader.add(emoji('third'));
		await flush();
		expect(dependencies.writeCache).toHaveBeenCalledTimes(1);
		expect(dependencies.writeCache.mock.calls[0][2]()).toBe(false);
		firstWrite.resolve();
		await flush();
		expect(dependencies.writeCache).toHaveBeenCalledTimes(2);
		expect(dependencies.writeCache.mock.calls[1][0].map(item => item.name)).toEqual(['third', 'second', 'fresh']);
	});

	it('does not apply a response that arrives after its timeout', async () => {
		const { loader, dependencies, current } = fixture();
		const response = deferred<{ emojis: unknown }>();
		dependencies.request.mockReturnValue(response.promise);
		const loading = loader.fetch().catch(error => error);
		await flush();
		await vi.advanceTimersByTimeAsync(8000);
		expect((await loading).name).toBe('TimeoutError');
		response.resolve({ emojis: [emoji('late')] });
		await flush();
		expect(current()).toEqual([]);
		expect(dependencies.writeCache).not.toHaveBeenCalled();
	});
});
