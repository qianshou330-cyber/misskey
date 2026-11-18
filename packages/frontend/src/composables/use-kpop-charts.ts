/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { onActivated, onDeactivated, onMounted, onUnmounted, readonly, ref, shallowRef, toValue, watch } from 'vue';
import type { MaybeRefOrGetter } from 'vue';
import type { Endpoints } from 'misskey-js';
import { useKpopPreferences } from '@/composables/use-kpop-preferences.js';
import { createMusicChartPoller } from '@/utility/music-chart-poller.js';
import { misskeyApi } from '@/utility/misskey-api.js';

type KpopEndpoint = 'music-charts/kpop-summary' | 'music-charts/kpop-chart' | 'music-charts/kpop-history';

/** Reads this instance's cache only. Source collection is never requested by this poller. */
export function useKpopResource<E extends KpopEndpoint>(endpoint: E, params: MaybeRefOrGetter<Endpoints[E]['req']>, enabled: MaybeRefOrGetter<boolean> = true) {
	const data = shallowRef<Endpoints[E]['res'] | null>(null);
	const loading = ref(false);
	const failed = ref(false);
	let active = false;
	let generation = 0;
	let release: (() => void) | null = null;
	let poller: ReturnType<typeof createMusicChartPoller<Endpoints[E]['res']>> | null = null;

	function stop(): void {
		generation++;
		release?.();
		release = null;
		poller = null;
		loading.value = false;
	}

	function start(): void {
		if (!active || !toValue(enabled) || release) return;
		const requestParams = { ...toValue(params) };
		const current = generation;
		poller = createMusicChartPoller(
			(signal) => misskeyApi(endpoint, requestParams, null, signal),
			(state) => {
				if (current !== generation) return;
				if (state.data != null) data.value = state.data;
				loading.value = state.loading;
				failed.value = state.failed;
			},
		);
		release = poller.subscribe();
	}

	function activate(): void { active = true; start(); }

	function deactivate(): void { active = false; stop(); }

	watch(() => JSON.stringify(toValue(params)), () => { stop(); data.value = null; failed.value = false; start(); });
	watch(() => toValue(enabled), value => { if (value) start(); else stop(); });
	onMounted(activate);
	onActivated(activate);
	onDeactivated(deactivate);
	onUnmounted(deactivate);
	return { data, loading: readonly(loading), failed: readonly(failed), refresh: () => poller?.refresh() };
}

export function useKpopSummary(enabled: MaybeRefOrGetter<boolean> = true) {
	const { chartKey, selectPlatform } = useKpopPreferences();
	const result = useKpopResource('music-charts/kpop-summary', () => ({ chartKey: chartKey.value }), enabled);
	return { ...result, summary: result.data, chartKey, selectPlatform };
}
