/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable import/no-default-export */
import { ref } from 'vue';
import type { StoryObj } from '@storybook/vue3';
import MkKpopSongSheet from './MkKpopSongSheet.vue';

export const Default = {
	render(args) {
		return {
			components: { MkKpopSongSheet },
			setup() { return { args, shown: ref(true) }; },
			template: '<MkKpopSongSheet v-if="shown" v-bind="args" @close="shown = false"><p>Song · Artist</p><p>↑3</p><p>7 days</p></MkKpopSongSheet>',
		};
	},
	args: { title: 'Song details' },
	parameters: { layout: 'fullscreen', viewport: { defaultViewport: 'mobile1' } },
} satisfies StoryObj<typeof MkKpopSongSheet>;

export const LongTitle = { ...Default, args: { title: 'A synthetic song title that wraps on a narrow phone viewport without hiding the close button' } } satisfies StoryObj<typeof MkKpopSongSheet>;
