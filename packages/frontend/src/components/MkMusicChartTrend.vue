<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<figure :class="$style.root">
	<div v-if="hasRank" :class="$style.canvas">
		<canvas ref="canvasEl" role="img" :aria-label="i18n.ts._musicCharts.sevenDays"></canvas>
	</div>
	<p v-else :class="$style.empty">{{ i18n.ts._musicCharts.noHistory }}</p>
	<figcaption :class="$style.caption">{{ i18n.ts._musicCharts.historyHint }}</figcaption>
	<details v-if="observations.length" :class="$style.records">
		<summary>{{ i18n.ts._musicCharts.table }}</summary>
		<div :class="$style.tableWrap">
			<table>
				<thead><tr><th scope="col">{{ i18n.ts._musicCharts.period }}</th><th scope="col">{{ i18n.ts._musicCharts.rankAxis }}</th></tr></thead>
				<tbody><tr v-for="point in observations" :key="point.period"><td><time :datetime="point.period">{{ formatMusicChartPeriod(point.period, daily) }}</time></td><td>{{ musicChartRankLabel(point) }}</td></tr></tbody>
			</table>
		</div>
	</details>
</figure>
</template>

<script lang="ts" setup>
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, useTemplateRef, watch } from 'vue';
import { Chart, LineController, LineElement, PointElement, LinearScale, Tooltip } from 'chart.js';
import type { MusicChartHistory } from '@/utility/music-charts.js';
import { formatMusicChartPeriod, musicChartPoints } from '@/utility/music-charts.js';
import { musicChartRankLabel } from '@/utility/music-chart-labels.js';
import { i18n } from '@/i18n.js';
import { themeManager } from '@/theme.js';

const props = defineProps<{ chartHistory: MusicChartHistory; daily?: boolean }>();
const canvasEl = useTemplateRef('canvasEl');
const observations = computed(() => props.chartHistory.points.filter(point => point.result !== 'missing').toReversed());
const hasRank = computed(() => musicChartPoints(props.chartHistory).some(point => point.y != null));
let chart: Chart<'line', { x: number; y: number | null }[]> | null = null;
let active = false;
let generation = 0;

Chart.register(LineController, LineElement, PointElement, LinearScale, Tooltip);

function destroy(): void { chart?.destroy(); chart = null; }

async function renderChart(): Promise<void> {
	const current = ++generation;
	destroy();
	await nextTick();
	if (!active || current !== generation || !canvasEl.value || !hasRank.value) return;
	const style = getComputedStyle(canvasEl.value);
	const color = style.getPropertyValue('--MI_THEME-fg').trim();
	chart = new Chart(canvasEl.value, {
		type: 'line',
		data: { datasets: [{
			data: musicChartPoints(props.chartHistory),
			borderColor: style.getPropertyValue('--MI_THEME-accent').trim(),
			backgroundColor: style.getPropertyValue('--MI_THEME-accent').trim(),
			borderWidth: 2,
			pointRadius: 3,
			spanGaps: false,
			tension: 0,
		}] },
		options: {
			responsive: true,
			maintainAspectRatio: false,
			animation: false,
			color,
			parsing: false,
			scales: {
				x: { type: 'linear', min: Date.parse(props.chartHistory.from), max: Date.parse(props.chartHistory.to), grid: { display: false }, ticks: { color, maxTicksLimit: 7, callback: value => formatMusicChartPeriod(new Date(Number(value)).toISOString(), true)?.slice(5) ?? '' } },
				y: { type: 'linear', reverse: true, min: 1, max: props.chartHistory.maxRank, grid: { color: style.getPropertyValue('--MI_THEME-divider').trim() }, ticks: { color, precision: 0, maxTicksLimit: 6 }, title: { display: true, text: i18n.ts._musicCharts.rankAxis, color } },
			},
			plugins: {
				legend: { display: false },
				tooltip: { callbacks: {
					title: items => items[0]?.parsed.x != null ? formatMusicChartPeriod(new Date(items[0].parsed.x).toISOString(), props.daily) ?? '' : '',
					label: item => i18n.tsx._musicCharts.rank({ rank: item.parsed.y ?? '' }),
				} },
			},
		},
	});
}

function activate(): void {
	if (active) return;
	active = true;
	themeManager.on('themeChanged', renderChart);
	void renderChart();
}

function deactivate(): void {
	active = false;
	generation++;
	themeManager.off('themeChanged', renderChart);
	destroy();
}

watch(() => props.chartHistory, renderChart);
onMounted(activate);
onActivated(activate);
onDeactivated(deactivate);
onUnmounted(deactivate);
</script>

<style lang="scss" module>
.root { margin: 0; }
.canvas { height: 240px; position: relative; }
.caption, .empty { font-size: .85em; line-height: 1.7; color: var(--MI_THEME-fgTransparentWeak); }
.caption { margin-top: 16px; }
.empty { display: grid; place-items: center; min-height: 180px; margin: 0; }
.records { margin-top: 16px; font-size: .85em; }
.records summary { cursor: pointer; padding: 8px 0; }
.tableWrap { max-height: 320px; overflow: auto; }
.tableWrap table { width: 100%; border-collapse: collapse; text-align: left; }
.tableWrap th, .tableWrap td { padding: 8px; border-bottom: 1px solid var(--MI_THEME-divider); }
</style>
