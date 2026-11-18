/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, KeepAlive, nextTick, ref, shallowRef } from 'vue';
import type { App } from 'vue';
import type { KpopChart, KpopChartView, KpopEntry } from '@/utility/kpop-charts.js';
import type { KpopSongPage } from '@/utility/kpop-song-lookup.js';
import { lookupKpopSong } from '@/utility/kpop-song-lookup.js';
import { useKpopSelectedSong } from '@/composables/use-kpop-selected-song.js';
import { misskeyApi } from '@/utility/misskey-api.js';

vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: vi.fn() }));

function row(songId = 'selected', rank = 3): KpopEntry {
	return { songId, rank, title: `Synthetic ${songId}`, artists: [{ id: null, name: 'Synthetic artist' }], album: null, albumId: null, albumCoverUrl: null, sourceMovement: { type: 'unknown', amount: null }, groupIds: ['aespa'], previousRank: null, change: null, bestRank7d: rank };
}

function chart(overrides: Partial<KpopChartView> = {}): KpopChartView {
	return { chartKey: 'melon-top100', provider: 'melon', label: '', sourceUrl: 'https://www.melon.com/chart/index.htm', maxRank: 100, periodHours: 1, coverage: 'complete', sourceTotal: 100, expectedCount: 100, rankBasis: 'official_rank', status: 'available', checkedAt: '2026-10-23T01:00:00.000Z', lastSuccessAt: '2026-10-23T01:00:00.000Z', lastChangedAt: '2026-10-23T01:00:00.000Z', nextAttemptAt: null, diagnostic: null, sourcePeriod: null, sourceUpdatedAt: null, sourceDate: null, observedAt: '2026-10-23T01:00:00.000Z', ...overrides };
}

function page(entries: KpopEntry[] = [], chartView = chart(), hasMore = false): KpopChart {
	return { entries, chart: chartView, total: entries.length, hasMore };
}

function deferred() {
	let resolve!: (value: KpopChart) => void;
	const promise = new Promise<KpopChart>(done => { resolve = done; });
	return { promise, resolve };
}

describe('bounded K-pop song lookup', () => {
	it('finds an exact song on the second unfiltered page', async () => {
		const request = vi.fn().mockResolvedValueOnce(page([row('other')], chart(), true)).mockResolvedValueOnce(page([row()]));
		const signal = new AbortController().signal;
		const result = await lookupKpopSong('melon-top100', 'selected', request, signal);
		expect(result.entry?.songId).toBe('selected');
		expect(request.mock.calls.map(call => call[0])).toEqual([{ chartKey: 'melon-top100', offset: 0, limit: 100 }, { chartKey: 'melon-top100', offset: 100, limit: 100 }]);
	});

	it('stops after two pages and preserves preview metadata without substituting another song', async () => {
		const partial = chart({ coverage: 'preview', sourceTotal: null });
		const request = vi.fn().mockResolvedValue(page([row('other')], partial, true));
		expect(await lookupKpopSong('melon-top100', 'missing', request, new AbortController().signal)).toEqual({ entry: null, chart: partial });
		expect(request).toHaveBeenCalledTimes(2);
	});

	it('ends after an empty final page and keeps pending data distinct from a ranked song', async () => {
		const pending = chart({ observedAt: null, status: 'pending' });
		const request = vi.fn().mockResolvedValue(page([], pending));
		expect(await lookupKpopSong('melon-top100', 'missing', request, new AbortController().signal)).toEqual({ entry: null, chart: pending });
		expect(request).toHaveBeenCalledTimes(1);
	});

	it('does not request the next page after cancellation, even if the requester ignores abort', async () => {
		const controller = new AbortController();
		const pending = deferred();
		const request = vi.fn().mockReturnValue(pending.promise);
		const result = lookupKpopSong('melon-top100', 'selected', request, controller.signal);
		controller.abort();
		pending.resolve(page([], chart(), true));
		await expect(result).rejects.toMatchObject({ name: 'AbortError' });
		expect(request).toHaveBeenCalledTimes(1);
	});

	it('rejects a response for another chart', async () => {
		await expect(lookupKpopSong('melon-top100', 'selected', vi.fn().mockResolvedValue(page([row()], chart({ chartKey: 'spotify' }))), new AbortController().signal)).rejects.toThrow('Unexpected chart response');
	});

	it('rejects pages spanning different collected snapshots instead of claiming an absence', async () => {
		const request = vi.fn().mockResolvedValueOnce(page([], chart(), true)).mockResolvedValueOnce(page([], chart({ observedAt: '2026-10-23T02:00:00.000Z' })));
		await expect(lookupKpopSong('melon-top100', 'selected', request, new AbortController().signal)).rejects.toThrow('Chart changed during song lookup');
		expect(request).toHaveBeenCalledTimes(2);
	});
});

describe('selected song lifecycle', () => {
	let app: App | null = null;
	beforeEach(() => { vi.useFakeTimers(); vi.mocked(misskeyApi).mockReset(); });
	afterEach(() => { app?.unmount(); app = null; vi.useRealTimers(); vi.restoreAllMocks(); });

	function mount(currentPage = shallowRef<KpopSongPage | null>(page()), song = ref('selected'), enabled = ref(true)) {
		let result!: ReturnType<typeof useKpopSelectedSong>;
		app = createApp({ setup() { result = useKpopSelectedSong(() => 'melon-top100', song, currentPage, enabled); return () => h('div'); } });
		app.mount(document.createElement('div'));
		return { result, currentPage, song, enabled };
	}

	it('shows an existing filtered page row immediately without an additional read', () => {
		const { result } = mount(shallowRef(page([row()])));
		expect(result.entry.value?.rank).toBe(3);
		expect(result.chart.value?.chartKey).toBe('melon-top100');
		expect(misskeyApi).not.toHaveBeenCalled();
	});

	it('looks outside the current filtered page without sending filters or login credentials', async () => {
		vi.mocked(misskeyApi).mockResolvedValue(page([row()]));
		const { result } = mount(shallowRef(page([row('filtered-other')])));
		await vi.advanceTimersByTimeAsync(0);
		expect(result.entry.value?.songId).toBe('selected');
		expect(vi.mocked(misskeyApi).mock.calls[0].slice(0, 3)).toEqual(['music-charts/kpop-chart', { chartKey: 'melon-top100', offset: 0, limit: 100 }, null]);
	});

	it('aborts rapid song changes and drops a late response', async () => {
		const old = deferred();
		vi.mocked(misskeyApi).mockReturnValueOnce(old.promise).mockResolvedValue(page([row('new', 8)]));
		const { result, song } = mount();
		const signal = vi.mocked(misskeyApi).mock.calls[0][3];
		song.value = 'new'; await nextTick(); await vi.advanceTimersByTimeAsync(0);
		expect(signal?.aborted).toBe(true);
		expect(result.entry.value?.songId).toBe('new');
		old.resolve(page([row()])); await vi.advanceTimersByTimeAsync(0);
		expect(result.entry.value?.rank).toBe(8);
	});

	it('cancels on close, never polls, and performs a fresh read when reopened', async () => {
		vi.mocked(misskeyApi).mockReturnValue(new Promise(() => {}));
		const { result, enabled } = mount();
		const signal = vi.mocked(misskeyApi).mock.calls[0][3];
		enabled.value = false; await nextTick();
		expect(signal?.aborted).toBe(true);
		expect(result.loading.value).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(120_000);
		expect(misskeyApi).toHaveBeenCalledTimes(1);
		enabled.value = true; await nextTick();
		expect(misskeyApi).toHaveBeenCalledTimes(2);
	});

	it('keeps a known row across pagination but discards its rank when the collected snapshot changes', async () => {
		vi.mocked(misskeyApi).mockResolvedValue(page([], chart({ observedAt: '2026-10-23T02:00:00.000Z' })));
		const { result, currentPage } = mount(shallowRef(page([row()])));
		currentPage.value = null; await nextTick();
		currentPage.value = page([row('another-page')]); await nextTick();
		expect(result.entry.value?.songId).toBe('selected');
		expect(misskeyApi).not.toHaveBeenCalled();
		currentPage.value = page([], chart({ observedAt: '2026-10-23T02:00:00.000Z' })); await nextTick();
		expect(result.entry.value).toBeNull();
		await vi.advanceTimersByTimeAsync(0);
		expect(result.entry.value).toBeNull();
		expect(result.chart.value?.observedAt).toBe('2026-10-23T02:00:00.000Z');
		expect(misskeyApi).toHaveBeenCalledTimes(1);
	});

	it('replaces a looked-up row when the first current page arrives with a newer snapshot', async () => {
		vi.mocked(misskeyApi).mockResolvedValueOnce(page([row()])).mockResolvedValue(page([], chart({ observedAt: '2026-10-23T02:00:00.000Z' })));
		const { result, currentPage } = mount(shallowRef(null));
		await vi.advanceTimersByTimeAsync(0);
		expect(result.entry.value?.rank).toBe(3);
		currentPage.value = page([], chart({ observedAt: '2026-10-23T02:00:00.000Z' })); await nextTick();
		expect(result.entry.value).toBeNull();
		await vi.advanceTimersByTimeAsync(0);
		expect(misskeyApi).toHaveBeenCalledTimes(2);
	});

	it('does not restart a pending deep-link lookup when its first current page arrives', async () => {
		const pending = deferred();
		vi.mocked(misskeyApi).mockReturnValueOnce(pending.promise).mockResolvedValue(page([row()]));
		const { result, currentPage } = mount(shallowRef(null));
		const signal = vi.mocked(misskeyApi).mock.calls[0][3];
		currentPage.value = page([row('other')]); await nextTick();
		expect(signal?.aborted).toBe(false);
		expect(misskeyApi).toHaveBeenCalledTimes(1);
		pending.resolve(page([], chart(), true)); await vi.advanceTimersByTimeAsync(0);
		expect(result.entry.value?.songId).toBe('selected');
		expect(misskeyApi).toHaveBeenCalledTimes(2);
	});

	it('does not display an older lookup result alongside a newer first current page', async () => {
		const pending = deferred();
		vi.mocked(misskeyApi).mockReturnValueOnce(pending.promise);
		const { result, currentPage } = mount(shallowRef(null));
		currentPage.value = page([], chart({ observedAt: '2026-10-23T02:00:00.000Z' })); await nextTick();
		pending.resolve(page([row()])); await vi.advanceTimersByTimeAsync(0);
		expect(result.entry.value).toBeNull();
		expect(result.failed.value).toBe(true);
		expect(result.chart.value?.observedAt).toBe('2026-10-23T02:00:00.000Z');
		expect(misskeyApi).toHaveBeenCalledTimes(1);
	});

	it('updates a matching row from page refresh without looking up another page', async () => {
		const { result, currentPage } = mount(shallowRef(page([row()])));
		currentPage.value = page([row('selected', 1)], chart({ observedAt: '2026-10-23T02:00:00.000Z' })); await nextTick();
		expect(result.entry.value?.rank).toBe(1);
		expect(misskeyApi).not.toHaveBeenCalled();
	});

	it('fails a stalled read after 15 seconds and retries only on request', async () => {
		vi.mocked(misskeyApi).mockReturnValueOnce(new Promise(() => {})).mockResolvedValue(page([row()]));
		const { result } = mount();
		const signal = vi.mocked(misskeyApi).mock.calls[0][3];
		await vi.advanceTimersByTimeAsync(15_000);
		expect(signal?.aborted).toBe(true);
		expect(result.failed.value).toBe(true);
		expect(result.loading.value).toBe(false);
		await vi.advanceTimersByTimeAsync(120_000);
		expect(misskeyApi).toHaveBeenCalledTimes(1);
		result.retry(); await vi.advanceTimersByTimeAsync(0);
		expect(result.failed.value).toBe(false);
		expect(result.entry.value?.songId).toBe('selected');
	});

	it('reports a failed request without discarding the available chart metadata', async () => {
		vi.mocked(misskeyApi).mockRejectedValue(new Error('Synthetic network failure'));
		const { result } = mount();
		await vi.advanceTimersByTimeAsync(0);
		expect(result.failed.value).toBe(true);
		expect(result.chart.value?.coverage).toBe('complete');
		expect(result.entry.value).toBeNull();
	});

	it('aborts deactivated views and unmounts, and restarts exactly once on activation', async () => {
		vi.mocked(misskeyApi).mockReturnValue(new Promise(() => {}));
		const visible = ref(true);
		const View = defineComponent({ setup() { useKpopSelectedSong(() => 'melon-top100', () => 'selected', () => null, () => true); return () => h('div'); } });
		app = createApp({ render: () => h(KeepAlive, () => visible.value ? h(View) : null) });
		app.mount(document.createElement('div'));
		expect(misskeyApi).toHaveBeenCalledTimes(1);
		const firstSignal = vi.mocked(misskeyApi).mock.calls[0][3];
		visible.value = false; await nextTick();
		expect(firstSignal?.aborted).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
		visible.value = true; await nextTick();
		expect(misskeyApi).toHaveBeenCalledTimes(2);
		const secondSignal = vi.mocked(misskeyApi).mock.calls[1][3];
		app.unmount(); app = null;
		expect(secondSignal?.aborted).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	});
});
