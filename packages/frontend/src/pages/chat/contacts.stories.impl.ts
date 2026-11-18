/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { http, HttpResponse } from 'msw';
import type { StoryObj } from '@storybook/vue3';
import Contacts from './contacts.vue';

export const Default = { render() { return { components: { Contacts }, template: '<Contacts />' }; }, parameters: { msw: { handlers: ['chat/contact-groups/list', 'chat/blocking/list', 'chat/conversations', 'users/following'].map(endpoint => http.post(`/api/${endpoint}`, () => HttpResponse.json([]))) } } } satisfies StoryObj<typeof Contacts>;
