<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader>
	<div class="_spacer _gaps" style="--MI_SPACER-w: 900px;">
		<section class="_panel" :class="$style.detail" data-testid="kpop-detail">
			<header :class="$style.header"><img :src="cover" :alt="i18n.ts._musicCharts.cover" width="44" height="44"/><div><h1>{{ i18n.ts._musicCharts.kpopTitle }}</h1><p>{{ chartKey === 'billboard-korea-global-k-songs' ? i18n.ts._musicCharts.kpopBillboardUpdate : i18n.ts._musicCharts.kpopSubtitle }}</p></div></header>
			<div :class="$style.controls">
				<label :class="$style.control"><span>{{ i18n.ts._musicCharts.kpopPlatform }}</span><select :value="kpopPlatform(chartKey).chartKey" data-testid="kpop-platform" @change="changePlatform"><option v-for="platform in kpopPlatforms" :key="platform.provider" :value="platform.chartKey">{{ platform.provider === 'tencent' ? i18n.ts._musicCharts.kpopTencentName : platform.label }}</option></select></label>
				<label :class="$style.control"><span>{{ i18n.ts._musicCharts.kpopGroup }}</span><select :value="groupId" data-testid="kpop-group" @change="selectGroup(($event.target as HTMLSelectElement).value)"><option value="">{{ i18n.ts._musicCharts.kpopAllGroups }}</option><option v-for="group in kpopGroups" :key="group.id" :value="group.id">{{ group.label }}</option></select></label>
				<label :class="[$style.control, $style.search]"><span>{{ i18n.ts._musicCharts.kpopSearch }}</span><input v-model="searchDraft" type="search" maxlength="200" data-testid="kpop-search"/></label>
			</div>
			<div v-if="kpopPlatform(chartKey).provider === 'melon'" :class="$style.tabs" :aria-label="i18n.ts._musicCharts.kpopPlatform"><button v-for="key in kpopMelonScopes" :key="key" type="button" class="_button" :class="[$style.tab, { [$style.selected]: chartKey === key }]" :aria-pressed="chartKey === key" @click="selectChart(key)">{{ kpopChartLabel(key) }}</button></div>
			<div :class="$style.body">
				<div :class="$style.titleRow"><h2>{{ kpopChartLabel(chartKey) }}</h2><MkButton small :disabled="loading" @click="refresh"><i class="ti ti-refresh" aria-hidden="true"></i>{{ i18n.ts._musicCharts.refresh }}</MkButton></div>
				<div :class="$style.facts" data-testid="kpop-chart-state" role="status">
					<strong :class="{ [$style.warning]: previous || failed }">{{ previous ? i18n.ts._musicCharts.kpopPrevious + ' · ' : '' }}{{ kpopStatus(chart, loading, failed) }}</strong>
					<span v-if="chart?.observedAt">{{ kpopScope(chart) }}</span>
					<span>{{ time.label }}：<time v-if="time.datetime" :datetime="time.datetime">{{ time.value }}</time><template v-else>{{ time.value }}</template></span>
				</div>
				<p v-if="kpopDiagnostic(chart)" :class="$style.hint" data-testid="kpop-diagnostic">{{ kpopDiagnostic(chart) }}</p>
				<p v-if="chart?.lastSuccessAt" :class="$style.hint">{{ i18n.ts._musicCharts.lastSuccessAt }}：{{ formatMusicChartPeriod(chart.lastSuccessAt) }}</p>
				<p v-if="chart?.observedAt && kpopPeriodHint(chart)" :class="$style.hint">{{ kpopPeriodHint(chart) }} · {{ i18n.ts._musicCharts.kpopObserved }}：{{ formatMusicChartPeriod(chart.observedAt) }}</p>
				<p v-if="chart?.nextAttemptAt && chart.status !== 'available'" :class="$style.hint">{{ i18n.ts._musicCharts.referenceNextAttempt }}：{{ formatMusicChartPeriod(chart.nextAttemptAt) }}</p>
				<p v-if="!chart?.observedAt && !loading" :class="$style.hint">{{ i18n.ts._musicCharts.kpopPendingFirst }}</p>
				<TransitionGroup ref="songList" tag="div" :class="$style.songs" :css="motionEnabled" :moveClass="motionEnabled ? $style.motionMove : $style.noMotion" :enterActiveClass="$style.motionEnterActive" :enterFromClass="$style.motionEnterFrom" :leaveActiveClass="$style.motionLeaveActive" :leaveToClass="$style.motionLeaveTo" :aria-busy="loading" :data-kpop-motion="motionEnabled ? 'active' : 'idle'" tabindex="-1" data-testid="kpop-song-list" @beforeLeave="beforeLeave" @afterLeave="restoreLeaving" @leaveCancelled="restoreLeaving" @beforeEnter="restoreLeaving">
					<button v-for="entry in data?.entries ?? []" :key="`${chartKey}:${entry.songId}`" type="button" class="_button" :class="[$style.song, { [$style.songSelected]: selectedSong === entry.songId }]" :aria-pressed="selectedSong === entry.songId" :aria-label="`${rankLabel(entry.rank)} · ${i18n.tsx._musicCharts.kpopSongDetails({ title: entry.title })} · ${kpopMovement(entry).text}`" :data-song="entry.songId" :data-kpop-changed="changedIds.has(entry.songId) ? '' : undefined" @click="chooseSong(entry, $event)">
						<strong :class="$style.rank" :title="rankLabel(entry.rank)" data-kpop-rank><span data-kpop-rank-value>{{ entry.rank }}</span></strong>
						<img v-if="entry.albumCoverUrl && !failedCovers.has(entry.albumCoverUrl)" :src="entry.albumCoverUrl" alt="" width="44" height="44" loading="lazy" decoding="async" referrerpolicy="no-referrer" :class="$style.album" @error="failedCovers.add(entry.albumCoverUrl)"/>
						<span v-else :class="[$style.album, $style.albumPlaceholder]" aria-hidden="true"><i class="ti ti-music"></i></span>
						<span :class="$style.songText"><strong>{{ entry.title }}</strong><span>{{ kpopArtists(entry) }}</span></span>
						<span :class="[$style.movement, { [$style.up]: kpopMovement(entry).direction === 'up', [$style.down]: kpopMovement(entry).direction === 'down' }]" :aria-label="kpopMovement(entry).text" :title="kpopMovement(entry).text">{{ kpopMovement(entry).label }}</span>
					</button>
					<p v-if="!data?.entries.length" key="empty" :class="$style.empty" role="status">{{ loading ? i18n.ts._musicCharts.loading : kpopEmpty(chart) }}</p>
				</TransitionGroup>
				<footer :class="$style.pagination"><MkButton v-if="offset > 0" small :disabled="loading" @click="offset = Math.max(0, offset - pageSize)">{{ i18n.ts._musicCharts.kpopBack }}</MkButton><span v-if="data">{{ i18n.tsx._musicCharts.kpopRecords({ count: data.total }) }}</span><MkButton v-if="data?.hasMore" small :disabled="loading" @click="offset += pageSize">{{ i18n.ts._musicCharts.kpopMore }}</MkButton></footer>
				<div :class="$style.source"><a v-if="chart" :href="chart.sourceUrl" target="_blank" rel="noopener noreferrer" class="_link">{{ i18n.ts._musicCharts.official }} <i class="ti ti-external-link" aria-hidden="true"></i></a><span>{{ i18n.ts._musicCharts.kpopObserved }} · {{ i18n.ts._musicCharts.kst }}</span></div>
			</div>
		</section>
		<section v-if="!isNarrow" class="_panel" :class="$style.history">
			<MkKpopSongDetails v-if="selectedSong" :chartKey="chartKey" :songId="selectedSong" :entry="selectedEntry" :chart="selectedChart" :previous="previous" :lookupLoading="songLoading" :lookupFailed="songFailed" @retryLookup="retrySong"/>
			<p v-else :class="$style.hint">{{ i18n.ts._musicCharts.kpopChooseSong }}</p>
		</section>
		<MkKpopSongSheet v-if="isOpen" :title="i18n.ts._musicCharts.kpopSongRecord" :returnFocusTo="returnFocusTo" @close="close">
			<MkKpopSongDetails :chartKey="chartKey" :songId="selectedSong" :entry="selectedEntry" :chart="selectedChart" :previous="previous" :lookupLoading="songLoading" :lookupFailed="songFailed" @retryLookup="retrySong"/>
		</MkKpopSongSheet>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, nextTick, onMounted, onActivated, onDeactivated, onUnmounted, reactive, ref, useTemplateRef, watch } from 'vue';
import type { KpopEntry } from '@/utility/kpop-charts.js';
import { kpopArtists, kpopChartLabel, kpopDiagnostic, kpopEmpty, kpopGroups, kpopMelonScopes, kpopMovement, kpopPeriodHint, kpopPlatform, kpopPlatforms, kpopPrevious, kpopScope, kpopStatus, kpopTime } from '@/utility/kpop-charts.js';
import { formatMusicChartPeriod } from '@/utility/music-charts.js';
import { useKpopResource } from '@/composables/use-kpop-charts.js';
import { useKpopListMotion } from '@/composables/use-kpop-list-motion.js';
import MkKpopSongDetails from '@/components/MkKpopSongDetails.vue';
import MkKpopSongSheet from '@/components/MkKpopSongSheet.vue';
import { useKpopPreferences } from '@/composables/use-kpop-preferences.js';
import { useKpopSongSheet } from '@/composables/use-kpop-song-sheet.js';
import { useKpopSelectedSong } from '@/composables/use-kpop-selected-song.js';
import { $i } from '@/i.js';
import MkButton from '@/components/MkButton.vue';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import cover from '/client-assets/a2o-lite-neon.png';

const props = defineProps<{ initialChart?: string; initialSong?: string }>();
const { chartKey, groupId, selectChart, selectPlatform, selectGroup } = useKpopPreferences(() => props.initialChart);
const { isNarrow, isOpen, returnFocusTo, open, close, reset } = useKpopSongSheet();
const searchDraft = ref('');
const query = ref('');
const offset = ref(0);
const pageSize = 50;
const selectedSong = ref(props.initialSong?.slice(0, 200) ?? '');
const failedCovers = reactive(new Set<string>());
let searchTimer: number | null = null;
let pageActive = false;
let linkedSongGeneration = 0;
const { data, loading, failed, refresh } = useKpopResource('music-charts/kpop-chart', () => ({ chartKey: chartKey.value, groupId: groupId.value || undefined, query: query.value || undefined, offset: offset.value, limit: pageSize }));
const chart = computed(() => data.value?.chart ?? null);
const songList = useTemplateRef<{ $el: HTMLElement }>('songList');
const emptyEntries: KpopEntry[] = [];
const { animate: motionEnabled, changedIds, beforeLeave, restoreLeaving } = useKpopListMotion({
	context: () => JSON.stringify([chartKey.value, groupId.value, query.value, offset.value]),
	rows: () => data.value?.entries ?? emptyEntries,
	ready: () => chart.value?.chartKey === chartKey.value && chart.value.status === 'available' && !failed.value,
	root: () => songList.value?.$el ?? null,
});
const { entry: selectedEntry, chart: selectedChart, loading: songLoading, failed: songFailed, retry: retrySong } = useKpopSelectedSong(chartKey, selectedSong, data, () => selectedSong.value !== '' && (!isNarrow.value || isOpen.value));
const previous = computed(() => kpopPrevious(chart.value, failed.value));
const time = computed(() => kpopTime(chart.value));

function changePlatform(event: Event): void { selectPlatform((event.target as HTMLSelectElement).value); }

function chooseSong(entry: KpopEntry, event: MouseEvent): void {
	linkedSongGeneration++;
	selectedSong.value = entry.songId;
	if (isNarrow.value) open(event.currentTarget as HTMLElement);
}

function rankLabel(rank: number): string { return chart.value?.rankBasis === 'playlist_order' ? i18n.tsx._musicCharts.kpopPlaylistRank({ rank }) : i18n.tsx._musicCharts.rank({ rank }); }

watch(searchDraft, value => { if (searchTimer != null) window.clearTimeout(searchTimer); searchTimer = window.setTimeout(() => { query.value = value.trim(); searchTimer = null; }, 300); });
watch([chartKey, groupId, query], () => { offset.value = 0; });
watch(chartKey, () => { reset(); selectedSong.value = ''; failedCovers.clear(); }, { flush: 'sync' });
watch(() => props.initialSong, value => {
	linkedSongGeneration++;
	selectedSong.value = value?.slice(0, 200) ?? '';
	if (value) restoreLinkedSong();
	else reset();
});
watch(() => $i?.id, () => { linkedSongGeneration++; reset(); selectedSong.value = ''; searchDraft.value = ''; query.value = ''; });

function restoreLinkedSong(): void {
	const generation = ++linkedSongGeneration;
	// Cached async pages may activate before their sheet and preference hooks.
	void nextTick(() => {
		if (!pageActive || generation !== linkedSongGeneration || !props.initialSong) return;
		selectedSong.value = props.initialSong.slice(0, 200);
		if (isNarrow.value) open(songList.value?.$el);
	});
}

function cancelSearch(): void { if (searchTimer != null) window.clearTimeout(searchTimer); searchTimer = null; }

function activate(): void { pageActive = true; query.value = searchDraft.value.trim(); restoreLinkedSong(); }

function deactivate(): void { pageActive = false; linkedSongGeneration++; cancelSearch(); }

onMounted(activate);
onActivated(activate);
onDeactivated(deactivate);
onUnmounted(deactivate);
definePage(() => ({ title: i18n.ts._musicCharts.kpopTitle, icon: 'ti ti-chart-line' }));
</script>

<style lang="scss" module>
.detail { min-width: 0; container-type: inline-size; }
.header { display: flex; align-items: center; gap: 12px; padding: 16px; }
.header img { object-fit: contain; flex: none; }
.header h1 { margin: 0; font-size: 1.2em; }
.header p { margin: 4px 0 0; color: var(--MI_THEME-fgTransparentWeak); font-size: .85em; }
.controls { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding: 0 16px 16px; }
.control { display: flex; flex-direction: column; min-width: 0; gap: 6px; font-size: .85em; }
.control input, .control select { min-width: 0; width: 100%; min-height: 44px; box-sizing: border-box; border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); padding: 8px; font: inherit; font-size: 16px; background: var(--MI_THEME-panel); color: var(--MI_THEME-fg); }
.search { grid-column: 1 / -1; }
.tabs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; padding: 8px; border-block: 1px solid var(--MI_THEME-divider); }
.tab { min-height: 44px; padding: 8px; font-size: .85em; border-radius: var(--MI-radius); overflow-wrap: anywhere; }
.selected { background: var(--MI_THEME-accentedBg); color: var(--MI_THEME-accent); font-weight: bold; }
.body { padding: 16px; }
.titleRow { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.titleRow h2, .history h2 { margin: 0; font-size: 1em; }
.facts { display: flex; flex-wrap: wrap; gap: 8px 16px; margin: 16px 0; font-size: .8em; line-height: 1.5; overflow-wrap: anywhere; color: var(--MI_THEME-fgTransparentWeak); }
.warning { color: var(--MI_THEME-warn); }
.hint { font-size: .8em; line-height: 1.6; color: var(--MI_THEME-fgTransparentWeak); }
.songs { position: relative; overflow-anchor: none; min-height: 144px; }
.song { position: relative; display: flex; align-items: center; gap: 10px; width: 100%; min-height: 72px; padding: 10px 0; box-sizing: border-box; border-bottom: 1px solid var(--MI_THEME-divider); text-align: left; }
.songSelected { background: var(--MI_THEME-accentedBg); }
.rank { position: relative; display: inline-grid; place-items: center; width: 30px; flex: none; text-align: center; font-variant-numeric: tabular-nums; }
.motionMove { transition: transform 400ms cubic-bezier(0.23, 1, 0.32, 1); }
.motionEnterActive, .motionLeaveActive { transition: opacity 200ms cubic-bezier(0, .5, .5, 1), translate 200ms cubic-bezier(0, .5, .5, 1); }
.motionEnterFrom { opacity: 0; translate: 0 6px; }
.motionLeaveTo { opacity: 0; translate: 0 -6px; }
.motionLeaveActive { position: absolute; pointer-events: none; }
.noMotion, .songs[data-kpop-motion='idle'] > * { transition: none !important; }
@media (prefers-reduced-motion: reduce) { .songs > * { transition: none !important; animation: none !important; } }
.album { width: 44px; height: 44px; object-fit: contain; flex: none; border-radius: var(--MI-radius); }
.albumPlaceholder { display: grid; place-items: center; background: var(--MI_THEME-buttonBg); }
.songText { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; overflow-wrap: anywhere; }
.songText > span { color: var(--MI_THEME-fgTransparentWeak); font-size: .8em; }
.movement { flex: 0 0 44px; width: 44px; font-variant-numeric: tabular-nums; font-size: .75em; text-align: right; color: var(--MI_THEME-fgTransparentWeak); overflow-wrap: anywhere; }
.up { color: var(--MI_THEME-error); }
.down { color: var(--MI_THEME-success); }
.empty { min-height: 144px; display: grid; place-items: center; color: var(--MI_THEME-fgTransparentWeak); font-size: .85em; }
.pagination, .source { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; font-size: .8em; margin-top: 12px; }
.source a { display: inline-flex; align-items: center; min-height: 44px; }
.history { padding: 16px; min-width: 0; }
.song:focus-visible, .tab:focus-visible, .control input:focus-visible, .control select:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: -2px; }
@container (min-width: 700px) { .tabs { grid-template-columns: repeat(4, minmax(0, 1fr)); } .controls { grid-template-columns: repeat(3, minmax(0, 1fr)); } .search { grid-column: auto; } }
@container (max-width: 350px) { .song { gap: 6px; flex-wrap: wrap; } .movement { margin-left: auto; width: auto; flex-basis: auto; } .songText { min-width: 120px; } }
</style>
