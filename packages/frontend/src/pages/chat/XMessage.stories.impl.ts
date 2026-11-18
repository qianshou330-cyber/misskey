/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
import type { StoryObj } from '@storybook/vue3';
import XMessage from './XMessage.vue';
import { chatMessage } from '../../../.storybook/fakes.js';

export const Default = { render(args) { return { components: { XMessage }, setup: () => ({ args }), template: '<div style="width: 360px"><XMessage v-bind="args" /></div>' }; }, args: { message: { ...chatMessage(), readTracked: true, readState: 'unread', revision: 1 } } } satisfies StoryObj<typeof XMessage>;
export const Edited = { ...Default, args: { message: { ...Default.args.message, editedAt: '2026-10-12T00:00:00.000Z', revision: 2, readAt: '2026-10-12T00:00:01.000Z', readState: 'read' } } } satisfies StoryObj<typeof XMessage>;
export const Recalled = { ...Default, args: { message: { ...Default.args.message, text: null, recalledAt: '2026-10-12T00:00:00.000Z', revision: 2 } } } satisfies StoryObj<typeof XMessage>;
export const Quoted = { ...Default, args: { privateLayout: true, message: { ...Default.args.message, replyToId: 'target', replyTo: { id: 'target', fromUserId: 'peer', text: '<b>plain text</b> in a quoted message', attachmentTypes: ['image'], revision: 2, recalledAt: null, unavailable: false } } } } satisfies StoryObj<typeof XMessage>;
export const MissingQuote = { ...Quoted, args: { privateLayout: true, message: { ...Quoted.args.message, replyTo: { id: 'target', fromUserId: null, text: null, attachmentTypes: [], revision: 0, recalledAt: null, unavailable: true } } } } satisfies StoryObj<typeof XMessage>;
