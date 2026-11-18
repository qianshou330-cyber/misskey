/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { ref } from 'vue';
import type { StoryObj } from '@storybook/vue3';
import XAttachmentComposer from './XAttachmentComposer.vue';

export const Default = { render() { return { components: { XAttachmentComposer }, setup: () => ({ files: ref([]) }), template: '<XAttachmentComposer v-model="files" userId="example-user" />' }; } } satisfies StoryObj<typeof XAttachmentComposer>;
