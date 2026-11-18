/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
import type { StoryObj } from '@storybook/vue3';
import MkDeferredSection from './MkDeferredSection.vue';

export const Default = {
	render: args => ({
		components: { MkDeferredSection },
		setup: () => ({ args }),
		template: '<MkDeferredSection v-bind="args"><template #default="{ component }"><component :is="component"/></template></MkDeferredSection>',
	}),
	args: { deferred: true, loader: () => import('./MkButton.vue') },
} satisfies StoryObj<typeof MkDeferredSection>;

export const Failed = {
	...Default,
	args: { deferred: true, loader: async () => { throw new Error('Synthetic offline example'); } },
} satisfies StoryObj<typeof MkDeferredSection>;
