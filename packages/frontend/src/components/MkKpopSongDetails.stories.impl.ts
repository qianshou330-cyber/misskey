/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { http, HttpResponse } from 'msw';
import type { StoryObj } from '@storybook/vue3';
import MkKpopSongDetails from './MkKpopSongDetails.vue';

export const MissingSong = {
	render(args) { return { components: { MkKpopSongDetails }, setup: () => ({ args }), template: '<div style="width: 320px; max-width: 100%"><MkKpopSongDetails v-bind="args"/></div>' }; },
	args: { chartKey: 'melon-top100', songId: 'synthetic-missing', entry: null, chart: null },
	parameters: {
		layout: 'padded',
		msw: { handlers: [http.post('/api/music-charts/kpop-history', () => HttpResponse.json({ chartKey: 'melon-top100', songId: 'synthetic-missing', basis: 'observation', from: '2026-10-16T00:00:00.000Z', to: '2026-10-23T00:00:00.000Z', points: [] }))] },
	},
} satisfies StoryObj<typeof MkKpopSongDetails>;

export const LookupFailed = { ...MissingSong, args: { ...MissingSong.args, lookupFailed: true } } satisfies StoryObj<typeof MkKpopSongDetails>;
