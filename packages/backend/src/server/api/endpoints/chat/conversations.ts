/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ChatService } from '@/core/ChatService.js';

export const meta = {
	tags: ['chat'], requireCredential: true, kind: 'read:chat',
	limit: { duration: 60_000, max: 120 },
	res: {
		type: 'array', optional: false, nullable: false,
		items: {
			type: 'object', optional: false, nullable: false, properties: {
				user: { type: 'object', optional: false, nullable: false, ref: 'UserLite' },
				lastMessage: { type: 'object', optional: false, nullable: false, ref: 'ChatMessageLiteFor1on1' },
				unreadCount: { type: 'integer', optional: false, nullable: false },
				hasLegacyUnread: { type: 'boolean', optional: false, nullable: false },
				pinnedAt: { type: 'string', format: 'date-time', optional: false, nullable: true },
				isMuted: { type: 'boolean', optional: false, nullable: false },
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object', properties: {
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
		untilId: { type: 'string', format: 'misskey:id' },
		pinned: { type: 'boolean' },
	},
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private chatService: ChatService) {
		super(meta, paramDef, async (ps, me) => {
			await this.chatService.checkChatAvailability(me.id, 'read');
			return this.chatService.userConversations(me.id, ps.limit, ps.untilId, ps.pinned);
		});
	}
}
