<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<section class="_panel" :class="$style.root" :aria-label="i18n.ts._musicCharts.kpopTitle" data-testid="music-chart-card">
	<header :class="$style.header">
		<img :src="cover" :alt="i18n.ts._musicCharts.cover" :class="$style.cover" width="44" height="44"/>
		<div :class="$style.heading"><h2>{{ i18n.ts._musicCharts.kpopTitle }}</h2><p :title="kpopChartLabel(chartKey)"><template v-if="chartKey !== 'billboard-korea-global-k-songs'">{{ i18n.ts._musicCharts.hourlyUpdate }} · </template>{{ kpopChartLabel(chartKey) }}</p></div>
		<MkA :to="detailsUrl" :class="$style.details">{{ i18n.ts._musicCharts.compactDetails }}<i class="ti ti-chevron-right" aria-hidden="true"></i></MkA>
	</header>
	<TransitionGroup ref="songList" tag="div" :class="$style.songs" :css="motionEnabled" :moveClass="motionEnabled ? $style.motionMove : $style.noMotion" :enterActiveClass="$style.motionEnterActive" :enterFromClass="$style.motionEnterFrom" :leaveActiveClass="$style.motionLeaveActive" :leaveToClass="$style.motionLeaveTo" :aria-busy="loading" :data-kpop-motion="motionEnabled ? 'active' : 'idle'" tabindex="-1" data-testid="kpop-home-songs" @beforeLeave="beforeLeave" @afterLeave="restoreLeaving" @leaveCancelled="restoreLeaving" @beforeEnter="restoreLeaving">
		<MkA v-for="entry in entries" :key="`${chartKey}:${entry.songId}`" :to="`${detailsUrl}&song=${encodeURIComponent(entry.songId)}`" :class="$style.song" :aria-label="`${rankLabel(entry.rank)} · ${i18n.tsx._musicCharts.kpopSongDetails({ title: entry.title })} · ${kpopMovement(entry).text}`" :aria-haspopup="isNarrow ? 'dialog' : undefined" :data-song="entry.songId" :data-kpop-changed="changedIds.has(entry.songId) ? '' : undefined" @click.capture="songClick($event, entry)">
			<strong :class="$style.rank" :title="rankLabel(entry.rank)" data-kpop-rank><span data-kpop-rank-value>{{ entry.rank }}</span></strong>
			<div :class="$style.songText"><span :class="$style.songTitle">{{ entry.title }}</span><span :class="$style.artist">{{ kpopArtists(entry) }}</span></div>
			<span :class="[$style.movement, { [$style.up]: kpopMovement(entry).direction === 'up', [$style.down]: kpopMovement(entry).direction === 'down' }]" :aria-label="kpopMovement(entry).text" :title="kpopMovement(entry).text"><span aria-hidden="true">{{ kpopMovement(entry).label }}</span></span>
		</MkA>
		<p v-if="!entries.length" key="empty" :class="$style.empty" role="status">{{ loading ? i18n.ts._musicCharts.loading : kpopEmpty(chart) }}</p>
	</TransitionGroup>
	<footer :class="$style.footer">
		<select :value="kpopPlatform(chartKey).chartKey" :class="$style.platform" :aria-label="i18n.ts._musicCharts.kpopPlatform" data-testid="kpop-home-platform" @change="changePlatform">
			<option v-for="platform in kpopPlatforms" :key="platform.provider" :value="platform.chartKey">{{ platform.provider === 'tencent' ? i18n.ts._musicCharts.kpopTencentName : platform.label }}</option>
		</select>
		<div :class="$style.meta" role="status" :title="`${time.label}：${time.value}`">
			<span :class="{ [$style.warning]: previous || failed }">{{ previous ? i18n.ts._musicCharts.kpopPrevious + ' · ' : '' }}{{ compactStatus }}</span>
			<span v-if="scope">{{ scope }}</span>
			<span>{{ i18n.ts._musicCharts.kpopLastSuccess }} {{ lastSuccess }}</span>
		</div>
	</footer>
<MkKpopSongSheet v-if="isOpen" :title="i18n.ts._musicCharts.kpopSongRecord" :returnFocusTo="returnFocusTo" @close="close">
	<MkKpopSongDetails :chartKey="chartKey" :songId="selectedSong" :entry="songEntry" :chart="songChart" :previous="previous" :lookupLoading="songLoading" :lookupFailed="songFailed" :fullChartUrl="`${detailsUrl}&song=${encodeURIComponent(selectedSong)}`" @retryLookup="retrySong"/>
</MkKpopSongSheet>
</section>
</template>

<script lang="ts" setup>
import { computed, ref, useTemplateRef, watch } from 'vue';
import type { KpopChartKey, KpopEntry, KpopSummary } from '@/utility/kpop-charts.js';
import { useKpopListMotion } from '@/composables/use-kpop-list-motion.js';
import { kpopArtists, kpopChartLabel, kpopEmpty, kpopMovement, kpopPlatform, kpopPlatforms, kpopPrevious, kpopStatus, kpopTime, kpopTopTwo } from '@/utility/kpop-charts.js';
import { i18n } from '@/i18n.js';
import { formatMusicChartPeriod } from '@/utility/music-charts.js';
import cover from '/client-assets/a2o-lite-neon.png';
import { useKpopSongSheet } from '@/composables/use-kpop-song-sheet.js';
import { useKpopSelectedSong } from '@/composables/use-kpop-selected-song.js';
import MkKpopSongSheet from '@/components/MkKpopSongSheet.vue';
import MkKpopSongDetails from '@/components/MkKpopSongDetails.vue';
import { $i } from '@/i.js';

const props = withDefaults(defineProps<{
	summary: KpopSummary | null;
	chartKey?: KpopChartKey;
	loading?: boolean;
	failed?: boolean;
}>(), { chartKey: 'melon-top100', loading: false, failed: false });
const emit = defineEmits<{ (event: 'update:chartKey', value: KpopChartKey): void }>();
const chart = computed(() => props.summary?.selected ?? null);
const entries = computed(() => kpopTopTwo(props.summary?.entries ?? []));
const selectedSong = ref('');
const { isNarrow, isOpen, returnFocusTo, open, close, reset } = useKpopSongSheet();
const page = computed(() => props.summary ? { chart: props.summary.selected, entries: props.summary.entries } : null);
const { entry: songEntry, chart: songChart, loading: songLoading, failed: songFailed, retry: retrySong } = useKpopSelectedSong(() => props.chartKey, selectedSong, page, isOpen);
watch(() => [props.chartKey, $i?.id], () => { reset(); selectedSong.value = ''; });

function songClick(event: MouseEvent, entry: KpopEntry): void {
	if (!isNarrow.value || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
	event.preventDefault();
	event.stopImmediatePropagation();
	selectedSong.value = entry.songId;
	open(event.currentTarget as HTMLElement);
}

const songList = useTemplateRef<{ $el: HTMLElement }>('songList');
const { animate: motionEnabled, changedIds, beforeLeave, restoreLeaving } = useKpopListMotion({
	context: () => props.chartKey,
	rows: () => entries.value,
	ready: () => chart.value?.chartKey === props.chartKey && chart.value.status === 'available' && !props.failed,
	root: () => songList.value?.$el ?? null,
});
const previous = computed(() => kpopPrevious(chart.value, props.failed));
const scope = computed(() => {
	const selected = chart.value;
	if (!selected?.observedAt) return '';
	const preview = selected.coverage === 'preview' ? selected.sourceTotal != null ? i18n.tsx._musicCharts.kpopPreviewShort({ count: selected.expectedCount, total: selected.sourceTotal }) : i18n.tsx._musicCharts.kpopPreviewLimit({ count: selected.expectedCount }) : '';
	return [preview, selected.rankBasis === 'playlist_order' ? i18n.ts._musicCharts.kpopPlaylist : ''].filter(Boolean).join(' · ');
});
const compactStatus = computed(() => !props.failed && chart.value?.status === 'restricted' ? i18n.ts._musicCharts.kpopRestrictedShort : kpopStatus(chart.value, props.loading, props.failed));
const lastSuccess = computed(() => formatMusicChartPeriod(chart.value?.lastSuccessAt ?? null)?.slice(5) ?? i18n.ts._musicCharts.placeholder);
const time = computed(() => kpopTime(chart.value));
const detailsUrl = computed(() => `/music-charts/kpop?chart=${props.chartKey}`);

function changePlatform(event: Event): void {
	const key = (event.target as HTMLSelectElement).value;
	const platform = kpopPlatforms.find(item => item.chartKey === key);
	if (platform) emit('update:chartKey', platform.chartKey);
}

function rankLabel(rank: number): string {
	return chart.value?.rankBasis === 'playlist_order' ? i18n.tsx._musicCharts.kpopPlaylistRank({ rank }) : i18n.tsx._musicCharts.rank({ rank });
}

</script>

<style lang="scss" module>
.root { container-type: inline-size; padding: 10px 12px; text-align: left; }
.header { display: flex; align-items: center; min-height: 44px; gap: 8px; }
.cover { flex: none; width: 44px; height: 44px; object-fit: contain; border-radius: var(--MI-radius); }
.heading { flex: 1; min-width: 0; }
.heading h2 { margin: 0; font-size: 1.071429rem; line-height: 1.4; overflow-wrap: anywhere; }
.heading p { margin: 2px 0 0; font-size: .785714rem; line-height: 1.4; color: var(--MI_THEME-fgTransparentWeak); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.details { display: inline-flex; flex: none; align-items: center; gap: 2px; min-height: 44px; min-width: 44px; justify-content: end; font-size: .857143rem; color: var(--MI_THEME-accent); }
.songs { position: relative; overflow-anchor: none; display: grid; min-height: 64px; margin: 4px 0; grid-template-rows: repeat(2, minmax(32px, auto)); }
.song { position: relative; display: flex; align-items: center; min-width: 0; gap: 8px; }
.rank { position: relative; display: inline-grid; place-items: center; min-width: 26px; font-size: 1rem; font-variant-numeric: tabular-nums; text-align: center; }
.motionMove { transition: transform 400ms cubic-bezier(0.23, 1, 0.32, 1); }
.motionEnterActive, .motionLeaveActive { transition: opacity 200ms cubic-bezier(0, .5, .5, 1), translate 200ms cubic-bezier(0, .5, .5, 1); }
.motionEnterFrom { opacity: 0; translate: 0 6px; }
.motionLeaveTo { opacity: 0; translate: 0 -6px; }
.motionLeaveActive { position: absolute; pointer-events: none; }
.noMotion, .songs[data-kpop-motion='idle'] > * { transition: none !important; }
@media (prefers-reduced-motion: reduce) { .songs > * { transition: none !important; animation: none !important; } }
.songText { min-width: 0; flex: 1; display: flex; align-items: baseline; gap: 8px; }
.songTitle { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .928571rem; }
.artist { flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .785714rem; color: var(--MI_THEME-fgTransparentWeak); }
.movement { min-width: 40px; flex: none; font-size: .785714rem; font-variant-numeric: tabular-nums; text-align: center; color: var(--MI_THEME-fgTransparentWeak); }
.up { color: var(--MI_THEME-error); }
.down { color: var(--MI_THEME-success); }
.empty { grid-row: 1 / -1; display: grid; align-items: center; margin: 0; font-size: .857143rem; line-height: 1.5; color: var(--MI_THEME-fgTransparentWeak); }
.footer { display: flex; align-items: center; gap: 12px; min-height: 44px; }
.platform { flex: 0 1 126px; width: 126px; min-width: 0; height: 44px; padding: 0 8px; color: var(--MI_THEME-fg); background: var(--MI_THEME-buttonBg); border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); font: inherit; font-size: .857143rem; }
.meta { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: end; font-size: .75rem; line-height: 1.3; color: var(--MI_THEME-fgTransparentWeak); overflow-wrap: anywhere; }
.warning { color: var(--MI_THEME-warn); }
.details:focus-visible, .song:focus-visible, .platform:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 2px; }
@container (max-width: 299px) { .songText { display: block; } .songTitle, .artist { display: block; line-height: 1.25; } }
</style>
