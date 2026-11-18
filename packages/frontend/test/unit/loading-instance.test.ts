/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn(), get: vi.fn(), set: vi.fn() }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: mocks.request }));
vi.mock('@/local-storage.js', () => ({ miLocalStorage: { getItem: mocks.get, setItem: mocks.set } }));

const meta = (name = 'PUBO') => ({ version: 'test', name, requireSetup: false, disableRegistration: false, clientOptions: { entrancePageStyle: 'simple' }, policies: { ltlAvailable: true, gtlAvailable: true } });

function provide(value: unknown, timestamp = Date.now()) {
	const el = document.createElement('script');
	el.id = 'misskey_meta';
	el.textContent = typeof value === 'string' ? value : JSON.stringify(value);
	el.dataset.generatedAt = timestamp.toString();
	document.body.append(el);
}

describe('entrance metadata loading', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.useFakeTimers();
		mocks.request.mockReset();
		mocks.get.mockReset().mockReturnValue(null);
		mocks.set.mockReset();
		document.body.innerHTML = '';
	});
	afterEach(() => { vi.useRealTimers(); });

	it.each([-86400000, 86400000])('uses local receipt time despite server skew %s, and shares the entrance refresh', async skew => {
		provide(meta(), Date.now() + skew);
		mocks.request.mockResolvedValue(meta('fresh'));
		const module = await import('@/instance.js');
		await module.fetchInstance(false, { timeoutMs: 8000 });
		expect(mocks.request).not.toHaveBeenCalled();
		const first = module.refreshEntranceInstance();
		expect(module.refreshEntranceInstance()).toBe(first);
		await first;
		await module.refreshEntranceInstance();
		expect(mocks.request).toHaveBeenCalledTimes(1);
		await module.fetchInstance(true);
		expect(mocks.request).toHaveBeenCalledTimes(2);
	});

	it('shares a pending metadata request, but allows retry when it failed', async () => {
		mocks.request.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(meta());
		const module = await import('@/instance.js');
		const common = module.fetchInstance(false, { timeoutMs: 8000 });
		expect(module.refreshEntranceInstance()).toBe(common);
		await expect(common).rejects.toThrow('offline');
		await module.refreshEntranceInstance();
		expect(mocks.request).toHaveBeenCalledTimes(2);
	});

	it('refreshes metadata when returning after the one-hour freshness window', async () => {
		provide(meta());
		mocks.request.mockResolvedValue(meta());
		const module = await import('@/instance.js');
		await module.refreshEntranceInstance();
		await vi.advanceTimersByTimeAsync(3600000);
		await module.refreshEntranceInstance();
		expect(mocks.request).toHaveBeenCalledTimes(2);
	});

	it('uses valid HTML immediately, ahead of a newer local cache', async () => {
		provide(meta());
		mocks.get.mockImplementation(key => key === 'instance' ? JSON.stringify(meta('old cache')) : String(Date.now() + 1000));
		const module = await import('@/instance.js');
		expect(module.instance.name).toBe('PUBO');
		await module.fetchInstance();
		expect(mocks.request).not.toHaveBeenCalled();
	});

	it('survives corrupt JSON and failing storage without inventing permissions', async () => {
		provide('{broken');
		mocks.get.mockImplementation(() => { throw new Error('blocked'); });
		const module = await import('@/instance.js');
		expect(module.isValidInstanceMeta(module.instance)).toBe(false);
		expect(module.instance.disableRegistration).toBeUndefined();
		expect(module.instance.policies).toBeUndefined();
	});

	it('aborts the welcome refresh at eight seconds and preserves usable metadata', async () => {
		provide(meta());
		let signal: AbortSignal;
		mocks.request.mockImplementation((_endpoint, _data, _token, value) => new Promise((_resolve, reject) => {
			signal = value;
			value.addEventListener('abort', () => reject(new Error('aborted')));
		}));
		const module = await import('@/instance.js');
		const result = module.fetchInstance(true, { timeoutMs: 8000 });
		const rejected = expect(result).rejects.toThrow('aborted');
		await vi.advanceTimersByTimeAsync(7999);
		expect(signal!.aborted).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		await rejected;
		expect(signal!.aborted).toBe(true);
		expect(module.instance.name).toBe('PUBO');
	});

	it('keeps explicit administrator refresh independent and suppresses older responses', async () => {
		const resolves: ((value: ReturnType<typeof meta>) => void)[] = [];
		mocks.request.mockImplementation(() => new Promise(resolve => resolves.push(resolve)));
		const module = await import('@/instance.js');
		const first = module.fetchInstance();
		expect(module.fetchInstance()).toBe(first);
		const forced = module.fetchInstance(true);
		expect(mocks.request).toHaveBeenCalledTimes(2);
		expect(mocks.request.mock.calls[1][3]).toBeUndefined();
		resolves[1](meta('new'));
		await forced;
		resolves[0](meta('old'));
		await first;
		expect(module.instance.name).toBe('new');
	});

	it('accepts successful refresh when cache writes fail; rejects invalid API payloads', async () => {
		mocks.set.mockImplementation(() => { throw new Error('quota'); });
		mocks.request.mockResolvedValueOnce(meta()).mockResolvedValueOnce({ clientOptions: {} });
		const module = await import('@/instance.js');
		await module.fetchInstance(true);
		expect(module.instance.name).toBe('PUBO');
		await expect(module.fetchInstance(true)).rejects.toThrow('Invalid instance metadata');
		expect(module.instance.name).toBe('PUBO');
	});

	it('does not trust a timestamp without valid cached metadata', async () => {
		mocks.get.mockImplementation(key => key === 'instanceCachedAt' ? String(Date.now()) : '{broken');
		mocks.request.mockResolvedValue(meta());
		const module = await import('@/instance.js');
		await module.fetchInstance();
		expect(mocks.request).toHaveBeenCalledTimes(1);
	});
});
