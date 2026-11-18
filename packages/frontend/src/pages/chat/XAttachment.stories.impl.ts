/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
import type { StoryObj } from '@storybook/vue3';
import XAttachment from './XAttachment.vue';
import { storyAttachment } from './chat.stories-fixtures.js';

export const Default = { render(args) { return { components: { XAttachment }, setup: () => ({ args }), template: '<XAttachment v-bind="args" />' }; }, args: { attachment: storyAttachment } } satisfies StoryObj<typeof XAttachment>;
export const Legacy = { ...Default, args: { attachment: { ...storyAttachment, legacyExposure: 'possible' } } } satisfies StoryObj<typeof XAttachment>;
