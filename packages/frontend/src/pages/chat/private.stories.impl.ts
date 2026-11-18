/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { http, HttpResponse } from 'msw';
import type { StoryObj } from '@storybook/vue3';
import PrivateChat from './private.vue';
import { userDetailed } from '../../../.storybook/fakes.js';

export const Default = { render(args) { return { components: { PrivateChat }, setup: () => ({ args }), template: '<div style="height: 700px"><PrivateChat v-bind="args" /></div>' }; }, args: { userId: 'example-user' }, parameters: { msw: { handlers: [http.post('/api/users/show', () => HttpResponse.json(userDetailed())), http.post('/api/chat/conversations', () => HttpResponse.json([])), http.post('/api/chat/history', () => HttpResponse.json([])), http.post('/api/chat/messages/user-timeline', () => HttpResponse.json([]))] } } } satisfies StoryObj<typeof PrivateChat>;
