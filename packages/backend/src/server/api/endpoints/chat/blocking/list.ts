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
	prohibitMoved: false,
	kind: 'read:chat',
	errors: chatContactErrors,
	limit: { duration: 60_000, max: 120 },
	res: { type: 'array', optional: false, nullable: false, items: {
		type: 'object', optional: false, nullable: false, properties: {
			id: { type: 'string', optional: false, nullable: false, format: 'id' },
			userId: { type: 'string', optional: false, nullable: false, format: 'id' },
			createdAt: { type: 'string', optional: false, nullable: false, format: 'date-time' },
		},
	} },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
		untilId: { type: 'string', format: 'misskey:id' },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private chatContactService: ChatContactService,
		private chatService: ChatService,
	) {
		super(meta, paramDef, async (ps, me) => {
			await this.chatService.checkChatAvailability(me.id, 'read');
			return this.chatContactService.listBlocked(me.id, ps.limit, ps.untilId);
		});
	}
}

