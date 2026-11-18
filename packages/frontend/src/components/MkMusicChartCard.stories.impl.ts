/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { shallowRef } from 'vue';
import MkMusicChartCard from './MkMusicChartCard.vue';
import MkButton from './MkButton.vue';
import type { StoryObj } from '@storybook/vue3';
import type { KpopChartView, KpopEntry, KpopSummary } from '@/utility/kpop-charts.js';
import { i18n } from '@/i18n.js';

const syntheticChart: KpopChartView = {
	chartKey: 'melon-top100', provider: 'melon', label: 'Melon TOP100', sourceUrl: 'https://www.melon.com/chart/index.htm', maxRank: 100, periodHours: 1,
	coverage: 'complete', sourceTotal: 100, expectedCount: 100, rankBasis: 'official_rank', status: 'available', diagnostic: null,
	checkedAt: '2026-10-17T13:00:00.000Z', lastSuccessAt: '2026-10-17T13:00:00.000Z', lastChangedAt: '2026-10-17T13:00:00.000Z', nextAttemptAt: '2026-10-17T14:00:00.000Z',
	sourcePeriod: '2026-10-17T13:00:00.000Z', sourceUpdatedAt: '2026-10-17T13:00:00.000Z', sourceDate: '2026-10-17', observedAt: '2026-10-17T13:00:00.000Z',
};
const syntheticEntries: KpopEntry[] = [
	{ songId: 'synthetic-1', rank: 1, title: 'Synthetic first song', artists: [{ id: 'synthetic-artist-1', name: 'A2O LITE' }], album: null, albumId: null, albumCoverUrl: null, groupIds: ['a2o-lite'], sourceMovement: { type: 'up', amount: 2 }, previousRank: 3, change: 2, bestRank7d: 1 },
	{ songId: 'synthetic-2', rank: 7, title: 'Synthetic second song', artists: [{ id: 'synthetic-artist-2', name: 'Hearts2Hearts' }], album: null, albumId: null, albumCoverUrl: null, groupIds: ['hearts2hearts'], sourceMovement: { type: 'unknown', amount: null }, previousRank: null, change: null, bestRank7d: 7 },
];
const syntheticSummary: KpopSummary = { charts: [syntheticChart], groups: [{ id: 'a2o-lite', label: 'A2O LITE' }], selected: syntheticChart, entries: syntheticEntries };
export const Default = {
	render(args) { return { components: { MkMusicChartCard }, setup: () => ({ args }), template: '<div style="max-width: 800px"><MkMusicChartCard v-bind="args"/></div>' }; },
	args: { summary: syntheticSummary, chartKey: 'melon-top100' }, parameters: { layout: 'padded' },
} satisfies StoryObj<typeof MkMusicChartCard>;
export const Loading = { ...Default, args: { summary: null, loading: true } } satisfies StoryObj<typeof MkMusicChartCard>;
export const Pending = { ...Default, args: { summary: null } } satisfies StoryObj<typeof MkMusicChartCard>;
export const Failure = { ...Default, args: { summary: syntheticSummary, failed: true } } satisfies StoryObj<typeof MkMusicChartCard>;
export const Previous = { ...Default, args: { summary: { ...syntheticSummary, selected: { ...syntheticChart, status: 'restricted' as const } } } } satisfies StoryObj<typeof MkMusicChartCard>;
export const Preview = { ...Default, args: { chartKey: 'spotify', summary: { ...syntheticSummary, selected: { ...syntheticChart, chartKey: 'spotify' as const, provider: 'spotify' as const, sourceTotal: 50, expectedCount: 30, maxRank: 50, coverage: 'preview' as const, rankBasis: 'playlist_order' as const, sourcePeriod: null, sourceUpdatedAt: null, sourceDate: null } } } } satisfies StoryObj<typeof MkMusicChartCard>;
export const CompactPhone = {
	...Default,
	render(args) { return { components: { MkMusicChartCard }, setup: () => ({ args }), template: '<div style="width: 288px; max-width: 100%"><MkMusicChartCard v-bind="args"/></div>' }; },
} satisfies StoryObj<typeof MkMusicChartCard>;
export const RankChange = {
	...Default,
	render() {
		return {
			components: { MkMusicChartCard, MkButton },
			setup() {
				const summary = shallowRef(syntheticSummary);
				const update = (): void => {
					const entries = summary.value.entries.slice().reverse().map((entry, index) => ({ ...entry, rank: index === 0 ? 1 : 7 }));
					summary.value = { ...syntheticSummary, entries };
				};
				return { summary, update, i18n };
			},
			template: '<div style="width: 288px; max-width: 100%"><MkMusicChartCard :summary="summary"/><MkButton @click="update">{{ i18n.ts._musicCharts.refresh }}</MkButton></div>',
		};
	},
} satisfies StoryObj<typeof MkMusicChartCard>;
