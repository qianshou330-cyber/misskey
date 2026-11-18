/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { HttpResponse, http } from 'msw';
import { onUnmounted } from 'vue';
import { commonHandlers } from '../../.storybook/mocks.js';
import MkHomeAnnouncementEditor from './MkHomeAnnouncementEditor.vue';
import type { StoryObj } from '@storybook/vue3';
import { $i } from '@/i.js';

const announcement = { id: 'synthetic-home-announcement', title: 'Synthetic announcement', text: 'Synthetic body for editing.', createdAt: '2026-10-23T00:00:00Z', updatedAt: null, imageUrl: null, icon: 'info', display: 'marquee', forYou: false, silence: true, needConfirmationToRead: false };

export const Default = {
	render() {
		return {
			components: { MkHomeAnnouncementEditor },
			setup() {
				const previous = $i?.isAdmin;
				if ($i) $i.isAdmin = true;
				onUnmounted(() => { if ($i) $i.isAdmin = previous ?? false; });
				return { initialId: announcement.id };
			},
			template: '<MkHomeAnnouncementEditor :initialId="initialId"/>',
		};
	},
	parameters: { layout: 'centered', msw: { handlers: [...commonHandlers,
		http.post('/api/announcements', () => HttpResponse.json([announcement])),
		http.post('/api/admin/announcements/update', () => new HttpResponse(null, { status: 204 })),
	] } },
} satisfies StoryObj<typeof MkHomeAnnouncementEditor>;

export const SaveFailure = {
	...Default,
	parameters: { ...Default.parameters, msw: { handlers: [...commonHandlers,
		http.post('/api/announcements', () => HttpResponse.json([announcement])),
		http.post('/api/admin/announcements/update', () => HttpResponse.json({ error: { code: 'INTERNAL_ERROR' } }, { status: 500 })),
	] } },
} satisfies StoryObj<typeof MkHomeAnnouncementEditor>;
