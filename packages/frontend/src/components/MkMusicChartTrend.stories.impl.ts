/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable import/no-default-export */
import type { StoryObj } from '@storybook/vue3';
import MkMusicChartTrend from './MkMusicChartTrend.vue';

export const Default = {
	render(args) {
		return { components: { MkMusicChartTrend }, setup: () => ({ args }), template: '<div style="max-width: 800px"><MkMusicChartTrend v-bind="args"/></div>' };
	},
	args: { chartHistory: { chartKey: 'bugs-realtime', maxRank: 100, from: '2026-10-08T00:00:00.000Z', to: '2026-10-15T00:00:00.000Z', points: [] } },
	parameters: { layout: 'padded' },
} satisfies StoryObj<typeof MkMusicChartTrend>;

export const SyntheticTop200 = {
	...Default,
	args: { chartHistory: { ...Default.args.chartHistory, chartKey: 'genie-realtime', maxRank: 200, points: [
		{ period: '2026-10-12T00:00:00.000Z', rank: 200, result: 'ranked' as const },
		{ period: '2026-10-12T01:00:00.000Z', rank: 150, result: 'ranked' as const },
		{ period: '2026-10-12T02:00:00.000Z', rank: null, result: 'missing' as const },
		{ period: '2026-10-12T03:00:00.000Z', rank: 101, result: 'ranked' as const },
	] } },
} satisfies StoryObj<typeof MkMusicChartTrend>;

export const SyntheticDaily = {
	...Default,
	args: { daily: true, chartHistory: { ...Default.args.chartHistory, chartKey: 'melon-daily', points: [
		{ period: '2026-10-12T15:00:00.000Z', rank: 85, result: 'ranked' as const },
		{ period: '2026-10-13T15:00:00.000Z', rank: null, result: 'missing' as const },
		{ period: '2026-10-14T15:00:00.000Z', rank: 74, result: 'ranked' as const },
	] } },
} satisfies StoryObj<typeof MkMusicChartTrend>;

export const SyntheticGaps = {
	...Default,
	args: { chartHistory: { ...Default.args.chartHistory, points: [
		{ period: '2026-10-12T00:00:00.000Z', rank: 50, result: 'ranked' as const },
		{ period: '2026-10-12T01:00:00.000Z', rank: 45, result: 'ranked' as const },
		{ period: '2026-10-12T02:00:00.000Z', rank: null, result: 'missing' as const },
		{ period: '2026-10-12T03:00:00.000Z', rank: 39, result: 'ranked' as const },
		{ period: '2026-10-12T04:00:00.000Z', rank: 41, result: 'ranked' as const },
	] } },
} satisfies StoryObj<typeof MkMusicChartTrend>;
