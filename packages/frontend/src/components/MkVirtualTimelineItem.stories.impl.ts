/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable import/no-default-export */
import { onBeforeUnmount, provide } from 'vue';
import type { StoryObj } from '@storybook/vue3';
import MkVirtualTimelineItem from './MkVirtualTimelineItem.vue';
import { TimelineViewport, timelineViewportKey } from '@/utility/timeline-viewport.js';

export const Default = {
	render() {
		return {
			components: { MkVirtualTimelineItem },
			setup() {
				const viewport = new TimelineViewport();
				provide(timelineViewportKey, viewport);
				onBeforeUnmount(() => viewport.dispose());
			},
			template: '<div style="height: 400px; overflow-y: auto"><MkVirtualTimelineItem v-for="item in 100" :key="item"><div style="height: 180px; padding: 16px">{{ item }}</div></MkVirtualTimelineItem></div>',
		};
	},
} satisfies StoryObj<typeof MkVirtualTimelineItem>;
