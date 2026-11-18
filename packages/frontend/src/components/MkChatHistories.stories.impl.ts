/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { http, HttpResponse } from 'msw';
import type { StoryObj } from '@storybook/vue3';
import MkChatHistories from './MkChatHistories.vue';
import { chatMessage, userLite } from '../../.storybook/fakes.js';

export const Default = {
	render() { return { components: { MkChatHistories }, template: '<div style="width: 320px"><MkChatHistories /></div>' }; },
	parameters: { msw: { handlers: [
		http.post('/api/chat/conversations', async ({ request }) => {
			const params = await request.json() as { pinned?: boolean };
			return HttpResponse.json(params.pinned ? [
				{ user: userLite('bob', 'bob', null), lastMessage: chatMessage(false, 'message-bob', 'Pinned, muted conversation'), unreadCount: 12, hasLegacyUnread: false, pinnedAt: '2026-10-22T00:00:00.000Z', isMuted: true },
			] : [
				{ user: userLite('carol', 'carol', null), lastMessage: chatMessage(false, 'message-carol', 'Historical message'), unreadCount: 0, hasLegacyUnread: true, pinnedAt: null, isMuted: false },
			]);
		}),
		http.post('/api/chat/history', () => HttpResponse.json([chatMessage(true)])),
		http.post('/api/chat/conversation-settings/show', () => HttpResponse.json({ pinnedAt: '2026-10-22T00:00:00.000Z', isMuted: true })),
	] } },
} satisfies StoryObj<typeof MkChatHistories>;
