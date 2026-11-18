/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { onActivated, onDeactivated, onMounted, onUnmounted, readonly, ref, shallowReadonly, shallowRef, toValue, watch } from 'vue';
import type { MaybeRefOrGetter } from 'vue';
import type { MusicChartHistory, MusicChartKey, MusicChartSummary } from '@/utility/music-charts.js';
import { createMusicChartPoller } from '@/utility/music-chart-poller.js';
import { misskeyApi } from '@/utility/misskey-api.js';

const summary = shallowRef<MusicChartSummary | null>(null);
const loading = ref(false);
const failed = ref(false);
const poller = createMusicChartPoller(
	(signal) => misskeyApi('music-charts/summary', {}, null, signal),
	(state) => {
		summary.value = state.data;
		loading.value = state.loading;
		failed.value = state.failed;
	},
);

export function useMusicCharts(enabled: MaybeRefOrGetter<boolean> = true) {
	let active = false;
	let release: (() => void) | null = null;

	function sync(): void {
		if (active && toValue(enabled)) {
			release ??= poller.subscribe();
		} else {
			release?.();
			release = null;
		}
	}

	function activate(): void { active = true; sync(); }

	function deactivate(): void { active = false; sync(); }

	watch(() => toValue(enabled), sync);
	onMounted(activate);
	onActivated(activate);
	onDeactivated(deactivate);
	onUnmounted(deactivate);
	return { summary: shallowReadonly(summary), loading: readonly(loading), failed: readonly(failed), refresh: poller.refresh };
}

export function useMusicChartHistory(chartKey: MaybeRefOrGetter<MusicChartKey>) {
	const chartHistory = shallowRef<MusicChartHistory | null>(null);
	const historyLoading = ref(false);
	const historyFailed = ref(false);
	let active = false;
	let generation = 0;
	let release: (() => void) | null = null;
	let currentPoller: ReturnType<typeof createMusicChartPoller<MusicChartHistory>> | null = null;

	function reset(): void {
		generation++;
		release?.();
		release = null;
		currentPoller = null;
	}

	function subscribe(): void {
		if (!active || release) return;
		const key = toValue(chartKey);
		const current = generation;
		currentPoller = createMusicChartPoller(
			(signal) => misskeyApi('music-charts/history', { chartKey: key }, null, signal),
			(state) => {
				if (current !== generation) return;
				chartHistory.value = state.data;
				historyLoading.value = state.loading;
				historyFailed.value = state.failed;
			},
		);
		release = currentPoller.subscribe();
	}

	function activate(): void { active = true; subscribe(); }

	function deactivate(): void { active = false; reset(); historyLoading.value = false; }

	watch(() => toValue(chartKey), () => {
		reset();
		chartHistory.value = null;
		historyFailed.value = false;
		historyLoading.value = false;
		subscribe();
	});
	onMounted(activate);
	onActivated(activate);
	onDeactivated(deactivate);
	onUnmounted(deactivate);
	return { chartHistory, historyLoading, historyFailed, refreshHistory: () => currentPoller?.refresh() };
}
