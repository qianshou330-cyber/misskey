/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ChatService } from '@/core/ChatService.js';

export const meta = {
	tags: ['chat'], requireCredential: true, kind: 'read:chat',
	limit: { duration: 60_000, max: 300 },
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			messages: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false, ref: 'ChatMessageLiteFor1on1' } },
			missingIds: { type: 'array', optional: false, nullable: false, items: { type: 'string', optional: false, nullable: false } },
		},
	},
} as const;

export const paramDef = {
	type: 'object', properties: {
		userId: { type: 'string', format: 'misskey:id' },
		messageIds: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: { type: 'string', format: 'misskey:id' } },
	}, required: ['userId', 'messageIds'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private chatService: ChatService) {
		super(meta, paramDef, async (ps, me) => {
			await this.chatService.checkChatAvailability(me.id, 'read');
			return this.chatService.userMessageState(me.id, ps.userId, ps.messageIds);
		});
	}
}
