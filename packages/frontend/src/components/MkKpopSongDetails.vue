<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.details" data-testid="kpop-song-details">
	<template v-if="entry">
		<h2 :class="$style.title">{{ entry.title }}</h2>
		<p :class="$style.artists">{{ kpopArtists(entry) }}</p>
		<dl :class="$style.stats">
			<div><dt>{{ chart?.rankBasis === 'playlist_order' ? i18n.ts._musicCharts.kpopPlaylist : i18n.ts._musicCharts.currentResult }}</dt><dd>{{ rankLabel(entry.rank) }}</dd></div>
			<div><dt>{{ i18n.ts._musicCharts.change }}</dt><dd :class="{ [$style.up]: movement?.direction === 'up', [$style.down]: movement?.direction === 'down' }" :aria-label="movement?.text">{{ movement?.label }}</dd></div>
			<div><dt>{{ i18n.ts._musicCharts.kpopBest7d }}</dt><dd>{{ entry.bestRank7d == null ? i18n.ts._musicCharts.placeholder : rankLabel(entry.bestRank7d) }}</dd></div>
		</dl>
		<p :class="$style.hint">{{ movement?.basis === 'source' ? i18n.ts._musicCharts.kpopMovementSource : movement?.basis === 'comparison' ? i18n.ts._musicCharts.kpopMovementComparison : i18n.ts._musicCharts.noComparison }}</p>
	</template>
	<template v-else>
		<h2 :class="$style.title">{{ i18n.ts._musicCharts.kpopSongRecord }}</h2>
		<p v-if="lookupLoading" role="status">{{ i18n.ts._musicCharts.loading }}</p>
		<p v-else-if="lookupFailed" role="status">{{ i18n.ts._musicCharts.kpopSongLookupFailed }} <button class="_textButton" type="button" @click="emit('retryLookup')">{{ i18n.ts._musicCharts.refresh }}</button></p>
		<p v-else role="status">{{ chart?.coverage === 'preview' ? i18n.ts._musicCharts.kpopPreviewMissing : i18n.ts._musicCharts.kpopSongMissing }}</p>
	</template>
	<p v-if="previous" :class="$style.warning">{{ i18n.ts._musicCharts.kpopPrevious }}</p>
	<div v-if="chart" :class="$style.hint">
		<p>{{ kpopChartLabel(chart.chartKey) }} · {{ kpopScope(chart) }}</p>
		<p>{{ time.label }}：{{ time.value }}</p>
		<p v-if="chart.observedAt">{{ i18n.ts._musicCharts.kpopObserved }}：{{ formatMusicChartPeriod(chart.observedAt) }}</p>
		<p v-if="kpopPeriodHint(chart)">{{ kpopPeriodHint(chart) }}</p>
	</div>
	<section data-testid="kpop-history" :class="$style.history">
		<h3>{{ history?.basis === 'official_period' || (!history && chart?.sourcePeriod) ? i18n.ts._musicCharts.sevenDays : i18n.ts._musicCharts.kpopObservedHistory }}</h3>
		<p v-if="historyFailed" role="status">{{ i18n.ts._musicCharts.historyFailed }} <button class="_textButton" type="button" @click="refreshHistory">{{ i18n.ts._musicCharts.refresh }}</button></p>
		<p v-else-if="historyLoading && !history" role="status">{{ i18n.ts._musicCharts.loading }}</p>
		<MkKpopChartTrend v-if="history" :history="history" :maxRank="chart?.maxRank ?? 200" :playlist="chart?.rankBasis === 'playlist_order'" :preview="chart?.coverage === 'preview'"/>
	</section>
	<div :class="$style.links">
		<a v-if="chart" :href="chart.sourceUrl" target="_blank" rel="noopener noreferrer" class="_link">{{ i18n.ts._musicCharts.official }} <i class="ti ti-external-link" aria-hidden="true"></i></a>
		<MkA v-if="fullChartUrl" :to="fullChartUrl" class="_link">{{ i18n.ts._musicCharts.kpopFullChart }}</MkA>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import type { KpopChartKey, KpopChartView, KpopEntry } from '@/utility/kpop-charts.js';
import { kpopArtists, kpopChartLabel, kpopMovement, kpopPeriodHint, kpopScope, kpopTime } from '@/utility/kpop-charts.js';
import { useKpopResource } from '@/composables/use-kpop-charts.js';
import { formatMusicChartPeriod } from '@/utility/music-charts.js';
import MkKpopChartTrend from '@/components/MkKpopChartTrend.vue';
import { i18n } from '@/i18n.js';

const props = defineProps<{
	chartKey: KpopChartKey;
	songId: string;
	entry: KpopEntry | null;
	chart: KpopChartView | null;
	previous?: boolean;
	lookupLoading?: boolean;
	lookupFailed?: boolean;
	fullChartUrl?: string;
}>();
const emit = defineEmits<{ (event: 'retryLookup'): void }>();
const movement = computed(() => props.entry ? kpopMovement(props.entry) : null);
const time = computed(() => kpopTime(props.chart));
const { data: history, loading: historyLoading, failed: historyFailed, refresh: refreshHistory } = useKpopResource('music-charts/kpop-history', () => ({ chartKey: props.chartKey, songId: props.songId }), () => props.songId !== '');

function rankLabel(rank: number): string {
	return props.chart?.rankBasis === 'playlist_order' ? i18n.tsx._musicCharts.kpopPlaylistRank({ rank }) : i18n.tsx._musicCharts.rank({ rank });
}
</script>

<style lang="scss" module>
.details { min-width: 0; overflow-wrap: anywhere; }
.title { margin: 0; font-size: 1.15em; line-height: 1.5; }
.artists { margin: 4px 0 20px; color: var(--MI_THEME-fgTransparentWeak); }
.stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 0; }
.stats > div { padding: 12px 6px; background: var(--MI_THEME-buttonBg); border-radius: var(--MI-radius); text-align: center; }
.stats dt { font-size: .75em; color: var(--MI_THEME-fgTransparentWeak); }
.stats dd { margin: 8px 0 0; font-weight: bold; font-variant-numeric: tabular-nums; }
.hint { font-size: .8em; color: var(--MI_THEME-fgTransparentWeak); line-height: 1.6; }
.hint p { margin: 8px 0; }
.up { color: var(--MI_THEME-error); }
.down { color: var(--MI_THEME-success); }
.warning { color: var(--MI_THEME-warn); }
.history { margin-top: 24px; }
.history h3 { font-size: 1em; margin: 0 0 12px; }
.links { display: flex; flex-wrap: wrap; gap: 8px 20px; margin-top: 12px; font-size: .85em; }
.links > a { display: inline-flex; align-items: center; min-height: 44px; }
</style>
