/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, KeepAlive, nextTick, ref } from 'vue';
import type { App } from 'vue';
import type { MusicChartKey } from '@/utility/music-charts.js';
import { useMusicChartHistory, useMusicCharts } from '@/composables/use-music-charts.js';
import { misskeyApi } from '@/utility/misskey-api.js';

vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: vi.fn() }));

describe('music chart Vue lifecycles', () => {
	let app: App | null = null;
	beforeEach(() => {
		vi.useFakeTimers();
		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
		vi.mocked(misskeyApi).mockReset();
	});
	afterEach(() => { app?.unmount(); app = null; vi.useRealTimers(); vi.restoreAllMocks(); });

	it('does not poll a disabled homepage, stops on KeepAlive deactivation and resumes once on activation', async () => {
		vi.mocked(misskeyApi).mockResolvedValue({ charts: [] });
		const enabled = ref(false);
		const visible = ref(true);
		const View = defineComponent({ setup() { useMusicCharts(enabled); return () => h('div'); } });
		app = createApp({ render: () => h(KeepAlive, () => visible.value ? h(View) : null) });
		app.mount(document.createElement('div'));
		await vi.advanceTimersByTimeAsync(60_000);
		expect(misskeyApi).not.toHaveBeenCalled();
		enabled.value = true;
		await nextTick();
		expect(misskeyApi).toHaveBeenCalledTimes(1);
		visible.value = false;
		await nextTick();
		await vi.advanceTimersByTimeAsync(120_000);
		expect(misskeyApi).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
		visible.value = true;
		await nextTick();
		expect(misskeyApi).toHaveBeenCalledTimes(2);
		enabled.value = false;
		await nextTick();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('aborts history when switching tabs and rejects late results for the previous chart', async () => {
		let resolveOld!: (value: unknown) => void;
		vi.mocked(misskeyApi).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValue({ chartKey: 'genie-realtime', maxRank: 200, from: '', to: '', points: [] });
		const key = ref<MusicChartKey>('melon-daily');
		let result!: ReturnType<typeof useMusicChartHistory>;
		app = createApp({ setup() { result = useMusicChartHistory(key); return () => h('div'); } });
		app.mount(document.createElement('div'));
		expect(misskeyApi).toHaveBeenCalledTimes(1);
		const oldSignal = vi.mocked(misskeyApi).mock.calls[0][3];
		key.value = 'genie-realtime';
		await nextTick();
		await vi.advanceTimersByTimeAsync(0);
		expect(oldSignal?.aborted).toBe(true);
		expect(result.chartHistory.value?.chartKey).toBe('genie-realtime');
		expect(result.chartHistory.value?.maxRank).toBe(200);
		resolveOld({ chartKey: 'melon-daily', maxRank: 100, points: [] });
		await vi.advanceTimersByTimeAsync(0);
		expect(result.chartHistory.value?.chartKey).toBe('genie-realtime');
		expect(result.chartHistory.value?.maxRank).toBe(200);
		app.unmount(); app = null;
		expect(vi.getTimerCount()).toBe(0);
	});
});
