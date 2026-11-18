/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ChatService } from '@/core/ChatService.js';
import { ChatConversationService } from '@/core/ChatConversationService.js';

export const conversationSettingsSchema = {
	type: 'object', optional: false, nullable: false, properties: {
		pinnedAt: { type: 'string', format: 'date-time', optional: false, nullable: true },
		isMuted: { type: 'boolean', optional: false, nullable: false },
	},
} as const;

export const meta = {
	tags: ['chat'], requireCredential: true, kind: 'read:chat',
	limit: { duration: 60_000, max: 120 },
	res: conversationSettingsSchema,
} as const;

export const paramDef = {
	type: 'object', properties: { userId: { type: 'string', format: 'misskey:id' } }, required: ['userId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private chatService: ChatService, private conversations: ChatConversationService) {
		super(meta, paramDef, async (ps, me) => {
			await this.chatService.checkChatAvailability(me.id, 'read');
			return this.conversations.get(me.id, ps.userId);
		});
	}
}
