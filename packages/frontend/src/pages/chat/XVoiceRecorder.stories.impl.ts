/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
import type { StoryObj } from '@storybook/vue3';
import XVoiceRecorder from './XVoiceRecorder.vue';

export const Default = { render() { return { components: { XVoiceRecorder }, template: '<XVoiceRecorder />' }; } } satisfies StoryObj<typeof XVoiceRecorder>;
