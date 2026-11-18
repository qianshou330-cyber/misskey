/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable import/no-default-export */
import type { StoryObj } from '@storybook/vue3';
import MkKpopChartTrend from './MkKpopChartTrend.vue';

export const Default = {
	render(args) { return { components: { MkKpopChartTrend }, setup: () => ({ args }), template: '<MkKpopChartTrend v-bind="args"/>' }; },
	args: { maxRank: 100, history: { chartKey: 'melon-top100', songId: 'synthetic-1', basis: 'observation', from: '2026-10-10T00:00:00.000Z', to: '2026-10-17T00:00:00.000Z', points: [] } },
	parameters: { layout: 'padded' },
} satisfies StoryObj<typeof MkKpopChartTrend>;
export const ObservedGaps = { ...Default, args: { ...Default.args, history: { ...Default.args.history, points: [
	{ observedAt: '2026-10-16T00:00:00.000Z', sourcePeriod: null, sourceUpdatedAt: null, rank: 5, result: 'ranked' as const, gapBefore: false },
	{ observedAt: '2026-10-16T02:00:00.000Z', sourcePeriod: null, sourceUpdatedAt: null, rank: 3, result: 'ranked' as const, gapBefore: true },
	{ observedAt: '2026-10-16T03:00:00.000Z', sourcePeriod: null, sourceUpdatedAt: null, rank: null, result: 'unknown' as const, gapBefore: false },
] } } } satisfies StoryObj<typeof MkKpopChartTrend>;
