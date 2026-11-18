/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ChatService } from '@/core/ChatService.js';
import { ChatConversationService, chatConversationErrors } from '@/core/ChatConversationService.js';
import { conversationSettingsSchema } from './show.js';

export const meta = {
	tags: ['chat'], requireCredential: true, kind: 'write:chat',
	limit: { duration: 60_000, max: 120 },
	errors: chatConversationErrors,
	res: conversationSettingsSchema,
} as const;

const properties = {
	userId: { type: 'string', format: 'misskey:id' },
	pinned: { type: 'boolean' },
	isMuted: { type: 'boolean' },
} as const;

export const paramDef = {
	type: 'object', properties, required: ['userId'],
	anyOf: [
		{ type: 'object', properties, required: ['userId', 'pinned'] },
		{ type: 'object', properties, required: ['userId', 'isMuted'] },
	],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private chatService: ChatService, private conversations: ChatConversationService) {
		super(meta, paramDef, async (ps, me) => {
			await this.chatService.checkChatAvailability(me.id, 'read');
			return this.conversations.update(me.id, ps.userId, ps);
		});
	}
}
