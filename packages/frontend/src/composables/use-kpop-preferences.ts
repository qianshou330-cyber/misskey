/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { onActivated, onDeactivated, onMounted, onUnmounted, ref, toValue, watch } from 'vue';
import type { MaybeRefOrGetter } from 'vue';
import type { KpopChartKey, KpopGroupId } from '@/utility/kpop-charts.js';
import type { KpopMelonChartKey, KpopPreferences } from '@/utility/kpop-chart-preferences.js';
import { $i } from '@/i.js';
import { createKpopPreferenceStore, isKpopChartKey, isKpopGroupId, isKpopMelonChartKey, kpopPreferenceStorageKey } from '@/utility/kpop-chart-preferences.js';

const preferenceStore = createKpopPreferenceStore(() => window.localStorage);

/** URL selection is transient; only explicit user setters write local preferences. */
export function useKpopPreferences(initialChart?: MaybeRefOrGetter<string | undefined>) {
	let accountId = $i?.id ?? null;
	const saved = preferenceStore.read(accountId);
	const initial = toValue(initialChart);
	let linkOverride = isKpopChartKey(initial);
	const chartKey = ref<KpopChartKey>(linkOverride ? initial as KpopChartKey : saved.chartKey);
	const groupId = ref<KpopGroupId | ''>(saved.groupId);
	const lastMelonChart = ref<KpopMelonChartKey>(saved.lastMelonChart);
	let release: (() => void) | null = null;

	function apply(value: KpopPreferences): void {
		if (!linkOverride) chartKey.value = value.chartKey;
		groupId.value = value.groupId;
		lastMelonChart.value = value.lastMelonChart;
	}

	function refresh(): void { apply(preferenceStore.read(accountId)); }

	function onStorage(event: StorageEvent): void {
		if (event.key == null || event.key === kpopPreferenceStorageKey(accountId)) refresh();
	}

	function activate(): void {
		if (release) return;
		// A cached RouterView can be revisited through the same explicit URL.
		// Re-entering that route restores its link selection without saving it.
		const linkedChart = toValue(initialChart);
		linkOverride = isKpopChartKey(linkedChart);
		if (linkOverride) chartKey.value = linkedChart as KpopChartKey;
		refresh();
		release = preferenceStore.subscribe((changedAccount, value) => { if (changedAccount === accountId) apply(value); });
		window.addEventListener('storage', onStorage);
	}

	function deactivate(): void {
		release?.();
		release = null;
		window.removeEventListener('storage', onStorage);
	}

	function selectChart(key: string): void {
		if (!isKpopChartKey(key)) return;
		linkOverride = false;
		apply(preferenceStore.update(accountId, { chartKey: key }));
	}

	function selectPlatform(key: string): void {
		if (!isKpopChartKey(key)) return;
		selectChart(isKpopMelonChartKey(key) ? preferenceStore.read(accountId).lastMelonChart : key);
	}

	function selectGroup(id: string): void {
		if (!isKpopGroupId(id)) return;
		apply(preferenceStore.update(accountId, { groupId: id }));
	}

	watch(() => toValue(initialChart), value => {
		linkOverride = isKpopChartKey(value);
		chartKey.value = linkOverride ? value as KpopChartKey : preferenceStore.read(accountId).chartKey;
	});
	watch(() => $i?.id ?? null, value => {
		accountId = value;
		const currentInitial = toValue(initialChart);
		linkOverride = isKpopChartKey(currentInitial);
		if (linkOverride) chartKey.value = currentInitial as KpopChartKey;
		refresh();
	}, { flush: 'sync' });
	onMounted(activate);
	onActivated(activate);
	onDeactivated(deactivate);
	onUnmounted(deactivate);
	return { chartKey, groupId, lastMelonChart, selectChart, selectPlatform, selectGroup };
}
