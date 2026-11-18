/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { HttpResponse, http } from 'msw';
import { commonHandlers } from '../../.storybook/mocks.js';
import MkHomeAnnouncements from './MkHomeAnnouncements.vue';
import type { StoryObj } from '@storybook/vue3';
import type { HomeAnnouncement } from '@/utility/home-announcements.js';

const announcement: HomeAnnouncement = {
	id: 'synthetic-announcement', title: 'Synthetic homepage announcement', text: 'Full announcement text',
	createdAt: '2026-10-23T00:00:00.000Z', updatedAt: null, imageUrl: null, icon: 'info', display: 'marquee',
	forYou: false, silence: true, needConfirmationToRead: false, isRead: true,
};

export const Default = {
	render() { return { components: { MkHomeAnnouncements }, template: '<div style="max-width: 800px"><MkHomeAnnouncements/></div>' }; },
	parameters: {
		layout: 'padded',
		msw: { handlers: [...commonHandlers, http.post('/api/announcements', () => HttpResponse.json([announcement]))] },
	},
} satisfies StoryObj<typeof MkHomeAnnouncements>;

export const Multiple = {
	...Default,
	parameters: { ...Default.parameters, msw: { handlers: [...commonHandlers, http.post('/api/announcements', () => HttpResponse.json([
		announcement,
		{ ...announcement, id: 'synthetic-long', title: 'Synthetic long announcement title, visible in full while scrolling or browsing with the keyboard' },
	]))] } },
} satisfies StoryObj<typeof MkHomeAnnouncements>;

export const CompactPhone = {
	...Multiple,
	render() { return { components: { MkHomeAnnouncements }, template: '<div style="width: 288px; max-width: 100%"><MkHomeAnnouncements/></div>' }; },
} satisfies StoryObj<typeof MkHomeAnnouncements>;

export const Empty = {
	...Default,
	parameters: { ...Default.parameters, msw: { handlers: [...commonHandlers, http.post('/api/announcements', () => HttpResponse.json([]))] } },
} satisfies StoryObj<typeof MkHomeAnnouncements>;
