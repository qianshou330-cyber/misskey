/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMusicChartPoller } from '@/utility/music-chart-poller.js';

describe('homepage music chart polling', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
	});
	afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

	it('shares one request and timer between active consumers, releasing the last consumer stops polling', async () => {
		const load = vi.fn().mockResolvedValue('first');
		const state = vi.fn();
		const poller = createMusicChartPoller(load, state);
		const first = poller.subscribe();
		const second = poller.subscribe();
		expect(load).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(load).toHaveBeenCalledTimes(2);
		first(); first();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(load).toHaveBeenCalledTimes(3);
		second();
		await vi.advanceTimersByTimeAsync(120_000);
		expect(load).toHaveBeenCalledTimes(3);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('does not start hidden, aborts on hide and refreshes immediately on return', async () => {
		const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
		const load = vi.fn<(signal: AbortSignal) => Promise<string>>().mockImplementation(() => new Promise(() => {}));
		const poller = createMusicChartPoller(load, vi.fn());
		const release = poller.subscribe();
		await vi.advanceTimersByTimeAsync(120_000);
		expect(load).not.toHaveBeenCalled();
		visibility.mockReturnValue('visible');
		document.dispatchEvent(new Event('visibilitychange'));
		expect(load).toHaveBeenCalledTimes(1);
		visibility.mockReturnValue('hidden');
		document.dispatchEvent(new Event('visibilitychange'));
		expect(load.mock.calls[0][0].aborted).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
		visibility.mockReturnValue('visible');
		document.dispatchEvent(new Event('visibilitychange'));
		expect(load).toHaveBeenCalledTimes(2);
		release();
	});

	it('ignores late responses after release or visibility replacement', async () => {
		let resolveOld!: (value: string) => void;
		const load = vi.fn().mockImplementationOnce(() => new Promise<string>(resolve => { resolveOld = resolve; })).mockResolvedValue('new');
		const state = vi.fn();
		const poller = createMusicChartPoller(load, state);
		const release = poller.subscribe();
		release();
		const releaseNew = poller.subscribe();
		await vi.advanceTimersByTimeAsync(0);
		resolveOld('obsolete');
		await vi.advanceTimersByTimeAsync(0);
		expect(state).toHaveBeenLastCalledWith({ data: 'new', loading: false, failed: false });
		expect(state.mock.calls.some(([value]) => value.data === 'obsolete')).toBe(false);
		releaseNew();
	});

	it('bounds hung requests, avoids overlap, and can retry after a timeout', async () => {
		const load = vi.fn<(signal: AbortSignal) => Promise<string>>().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue('recovered');
		const state = vi.fn();
		const poller = createMusicChartPoller(load, state);
		const release = poller.subscribe();
		poller.refresh();
		expect(load).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(15_000);
		expect(load.mock.calls[0][0].aborted).toBe(true);
		expect(state).toHaveBeenLastCalledWith({ data: null, loading: false, failed: true });
		poller.refresh();
		await vi.advanceTimersByTimeAsync(0);
		expect(state).toHaveBeenLastCalledWith({ data: 'recovered', loading: false, failed: false });
		release();
	});

	it('retains the previous observation when a refresh fails', async () => {
		const load = vi.fn().mockResolvedValueOnce('known').mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue('recovered');
		const state = vi.fn();
		const poller = createMusicChartPoller(load, state);
		const release = poller.subscribe();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(state).toHaveBeenLastCalledWith({ data: 'known', loading: false, failed: true });
		await vi.advanceTimersByTimeAsync(60_000);
		expect(state).toHaveBeenLastCalledWith({ data: 'recovered', loading: false, failed: false });
		release();
	});
});
