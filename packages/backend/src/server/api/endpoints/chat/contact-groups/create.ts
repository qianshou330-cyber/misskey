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
	res: { type: 'object', optional: false, nullable: false, properties: {
		id: { type: 'string', optional: false, nullable: false, format: 'id' },
		name: { type: 'string', optional: false, nullable: false },
		userIds: { type: 'array', optional: false, nullable: false, items: { type: 'string', optional: false, nullable: false, format: 'id' } },
	} },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		name: { type: 'string', minLength: 1, maxLength: 100 },
	},
	required: ['name'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private chatContactService: ChatContactService,
		private chatService: ChatService,
	) {
		super(meta, paramDef, async (ps, me) => {
			await this.chatService.checkChatAvailability(me.id, 'write');
			return this.chatContactService.createGroup(me.id, ps.name);
		});
	}
}

