/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
import type { StoryObj } from '@storybook/vue3';
import XVoiceMessage from './XVoiceMessage.vue';
import { storyAttachment } from './chat.stories-fixtures.js';

export const Default = { render(args) { return { components: { XVoiceMessage }, setup: () => ({ args }), template: '<XVoiceMessage v-bind="args" />' }; }, args: { attachment: { ...storyAttachment, kind: 'voice', name: 'voice.mp3', mime: 'audio/mpeg', durationMs: 42000, peaks: [0.1, 0.5, 0.2, 0.8] } } } satisfies StoryObj<typeof XVoiceMessage>;
