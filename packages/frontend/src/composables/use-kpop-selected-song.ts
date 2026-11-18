/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { onActivated, onDeactivated, onMounted, onUnmounted, readonly, ref, shallowRef, toValue, watch } from 'vue';
import type { MaybeRefOrGetter } from 'vue';
import type { KpopChartKey, KpopChartView, KpopEntry } from '@/utility/kpop-charts.js';
import type { KpopSongPage } from '@/utility/kpop-song-lookup.js';
import { kpopSongSnapshot, lookupKpopSong } from '@/utility/kpop-song-lookup.js';
import { misskeyApi } from '@/utility/misskey-api.js';

/** Resolve the current row immediately, and search at most two cached pages for a deep link. */
export function useKpopSelectedSong(
	chartKey: MaybeRefOrGetter<KpopChartKey>,
	songId: MaybeRefOrGetter<string>,
	page: MaybeRefOrGetter<KpopSongPage | null>,
	enabled: MaybeRefOrGetter<boolean>,
) {
	const entry = shallowRef<KpopEntry | null>(null);
	const chart = shallowRef<KpopChartView | null>(null);
	const loading = ref(false);
	const failed = ref(false);
	let active = false;
	let selection = '';
	let pageSnapshot: string | null = null;
	let attempted = false;
	let generation = 0;
	let controller: AbortController | null = null;
	let timeout: number | null = null;

	function stop(): void {
		generation++;
		controller?.abort();
		controller = null;
		if (timeout != null) window.clearTimeout(timeout);
		timeout = null;
		loading.value = false;
	}

	function reconcile(): void {
		const key = toValue(chartKey);
		const song = toValue(songId);
		const nextSelection = `${key}\u0000${song}`;
		if (selection !== nextSelection) {
			stop();
			selection = nextSelection;
			pageSnapshot = null;
			attempted = false;
			entry.value = null;
			chart.value = null;
			failed.value = false;
		}

		const currentPage = toValue(page);
		if (currentPage?.chart.chartKey === key) {
			const snapshot = kpopSongSnapshot(currentPage.chart);
			const changedSnapshot = pageSnapshot != null
				? pageSnapshot !== snapshot
				: chart.value != null && kpopSongSnapshot(chart.value) !== snapshot;
			if (changedSnapshot) {
				stop();
				entry.value = null;
				attempted = false;
				failed.value = false;
			}
			pageSnapshot = snapshot;
			chart.value = currentPage.chart;
			const row = currentPage.entries.find(candidate => candidate.songId === song);
			if (row) {
				stop();
				entry.value = row;
				attempted = true;
				failed.value = false;
				return;
			}
		}

		if (!active || !toValue(enabled) || !song) {
			stop();
			attempted = false;
			return;
		}
		if (attempted) return;
		attempted = true;
		loading.value = true;
		failed.value = false;
		const current = generation;
		controller = new AbortController();
		const signal = controller.signal;
		timeout = window.setTimeout(() => {
			if (current !== generation) return;
			stop();
			failed.value = true;
		}, 15_000);
		void lookupKpopSong(key, song, (params, requestSignal) => misskeyApi('music-charts/kpop-chart', params, null, requestSignal), signal).then(result => {
			if (current !== generation) return;
			if (result.chart != null && pageSnapshot != null && kpopSongSnapshot(result.chart) !== pageSnapshot) {
				failed.value = true;
				return;
			}
			entry.value = result.entry;
			chart.value = result.chart;
		}, () => {
			if (current === generation && !signal.aborted) failed.value = true;
		}).finally(() => {
			if (current !== generation) return;
			if (timeout != null) window.clearTimeout(timeout);
			timeout = null;
			controller = null;
			loading.value = false;
		});
	}

	function activate(): void { active = true; reconcile(); }

	function deactivate(): void { active = false; stop(); attempted = false; }

	function retry(): void { stop(); attempted = false; reconcile(); }

	watch([() => toValue(chartKey), () => toValue(songId), () => toValue(page), () => toValue(enabled)], reconcile, { immediate: true });
	onMounted(activate);
	onActivated(activate);
	onDeactivated(deactivate);
	onUnmounted(deactivate);
	return { entry, chart, loading: readonly(loading), failed: readonly(failed), retry };
}
