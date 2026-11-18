/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { ChatContactService, chatContactErrors } from '@/core/ChatContactService.js';
import { ChatService } from '@/core/ChatService.js';
import { Endpoint } from '@/server/api/endpoint-base.js';

export const meta = {
	tags: ['chat'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:chat',
	errors: chatContactErrors,
	limit: { duration: 60_000, max: 120 },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		groupId: { type: 'string', format: 'misskey:id' },
		userId: { type: 'string', format: 'misskey:id' },
	},
	required: ['groupId', 'userId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private chatContactService: ChatContactService,
		private chatService: ChatService,
	) {
		super(meta, paramDef, async (ps, me) => {
			await this.chatService.checkChatAvailability(me.id, 'write');
			await this.chatContactService.setMember(me.id, ps.groupId, ps.userId, false);
		});
	}
}

