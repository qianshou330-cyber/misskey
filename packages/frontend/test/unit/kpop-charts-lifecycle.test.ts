/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, KeepAlive, nextTick, ref } from 'vue';
import type { App } from 'vue';
import type { KpopChartKey } from '@/utility/kpop-charts.js';
import { useKpopResource, useKpopSummary } from '@/composables/use-kpop-charts.js';
import { misskeyApi } from '@/utility/misskey-api.js';

vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: vi.fn() }));

describe('K-pop cached requests and Vue lifecycles', () => {
	let app: App | null = null;
	beforeEach(() => { vi.useFakeTimers(); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'); vi.mocked(misskeyApi).mockReset(); });
	afterEach(() => { app?.unmount(); app = null; vi.useRealTimers(); vi.restoreAllMocks(); });

	it('uses Melon TOP100 by default and polls only while the homepage is active', async () => {
		vi.mocked(misskeyApi).mockResolvedValue({});
		const enabled = ref(false);
		app = createApp({ setup() { useKpopSummary(enabled); return () => h('div'); } });
		app.mount(document.createElement('div'));
		await vi.advanceTimersByTimeAsync(60_000);
		expect(misskeyApi).not.toHaveBeenCalled();
		enabled.value = true; await nextTick(); await vi.advanceTimersByTimeAsync(0);
		expect(vi.mocked(misskeyApi).mock.calls[0].slice(0, 2)).toEqual(['music-charts/kpop-summary', { chartKey: 'melon-top100' }]);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(misskeyApi).toHaveBeenCalledTimes(2);
		enabled.value = false; await nextTick();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('aborts hidden work and resumes with one fresh cached read', async () => {
		vi.mocked(misskeyApi).mockImplementation(() => new Promise(() => {}));
		app = createApp({ setup() { useKpopSummary(); return () => h('div'); } });
		app.mount(document.createElement('div'));
		const firstSignal = vi.mocked(misskeyApi).mock.calls[0][3];
		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
		document.dispatchEvent(new Event('visibilitychange'));
		expect(firstSignal?.aborted).toBe(true);
		await vi.advanceTimersByTimeAsync(120_000);
		expect(misskeyApi).toHaveBeenCalledTimes(1);
		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
		document.dispatchEvent(new Event('visibilitychange'));
		expect(misskeyApi).toHaveBeenCalledTimes(2);
	});

	it('prevents late responses from replacing a newly selected platform', async () => {
		let oldResolve!: (value: unknown) => void;
		vi.mocked(misskeyApi).mockImplementationOnce(() => new Promise(resolve => { oldResolve = resolve; })).mockResolvedValue({ selected: { chartKey: 'spotify' }, entries: [] });
		let result!: ReturnType<typeof useKpopSummary>;
		app = createApp({ setup() { result = useKpopSummary(); return () => h('div'); } });
		app.mount(document.createElement('div'));
		const firstSignal = vi.mocked(misskeyApi).mock.calls[0][3];
		result.chartKey.value = 'spotify'; await nextTick(); await vi.advanceTimersByTimeAsync(0);
		expect(firstSignal?.aborted).toBe(true);
		expect(result.summary.value?.selected.chartKey).toBe('spotify');
		oldResolve({ selected: { chartKey: 'melon-top100' }, entries: [] });
		await vi.advanceTimersByTimeAsync(0);
		expect(result.summary.value?.selected.chartKey).toBe('spotify');
	});

	it('retains last data on same-selection refresh failure without fabricating a successful update', async () => {
		vi.mocked(misskeyApi).mockResolvedValueOnce({ selected: { chartKey: 'melon-top100', observedAt: '2026-10-17T00:00:00.000Z' }, entries: [] }).mockRejectedValue(new Error('synthetic failure'));
		let result!: ReturnType<typeof useKpopSummary>;
		app = createApp({ setup() { result = useKpopSummary(); return () => h('div'); } });
		app.mount(document.createElement('div'));
		await vi.advanceTimersByTimeAsync(60_000);
		expect(result.failed.value).toBe(true);
		expect(result.summary.value?.selected.observedAt).toBe('2026-10-17T00:00:00.000Z');
	});

	it('does not request history until a song is chosen and aborts when cleared', async () => {
		vi.mocked(misskeyApi).mockImplementation(() => new Promise(() => {}));
		const song = ref('');
		const key = ref<KpopChartKey>('genie-realtime');
		app = createApp({ setup() { useKpopResource('music-charts/kpop-history', () => ({ chartKey: key.value, songId: song.value }), () => !!song.value); return () => h('div'); } });
		app.mount(document.createElement('div'));
		expect(misskeyApi).not.toHaveBeenCalled();
		song.value = 'synthetic-1'; await nextTick();
		expect(misskeyApi).toHaveBeenCalledTimes(1);
		const signal = vi.mocked(misskeyApi).mock.calls[0][3];
		song.value = ''; await nextTick();
		expect(signal?.aborted).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('releases requests and timers on Deck/KeepAlive deactivation and unmount', async () => {
		vi.mocked(misskeyApi).mockResolvedValue({});
		const visible = ref(true);
		const View = defineComponent({ setup() { useKpopSummary(); return () => h('div'); } });
		app = createApp({ render: () => h(KeepAlive, () => visible.value ? h(View) : null) });
		app.mount(document.createElement('div'));
		await vi.advanceTimersByTimeAsync(0);
		visible.value = false; await nextTick(); await vi.advanceTimersByTimeAsync(120_000);
		expect(misskeyApi).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
		visible.value = true; await nextTick(); await vi.advanceTimersByTimeAsync(0);
		expect(misskeyApi).toHaveBeenCalledTimes(2);
		app.unmount(); app = null;
		expect(vi.getTimerCount()).toBe(0);
	});
});
