/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ChatService } from '@/core/ChatService.js';
import { chatProErrors, throwChatProError } from '../chat-pro-errors.js';

export const meta = {
	tags: ['chat'], requireCredential: true, prohibitMoved: true, kind: 'write:chat',
	limit: { duration: 60000, max: 60 }, errors: chatProErrors,
	res: { type: 'object', optional: false, nullable: false, ref: 'ChatMessageLiteFor1on1' },
} as const;

export const paramDef = {
	type: 'object', properties: {
		messageId: { type: 'string', format: 'misskey:id' },
		text: { type: 'string', minLength: 1, maxLength: 2000 },
		expectedRevision: { type: 'integer', minimum: 0 },
	}, required: ['messageId', 'text', 'expectedRevision'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private chatService: ChatService) {
		super(meta, paramDef, async (ps, me) => {
			await this.chatService.checkChatAvailability(me.id, 'write');
			try {
				return await this.chatService.updateUserMessage(me.id, ps.messageId, ps.text, ps.expectedRevision);
			} catch (error) { throwChatProError(error); }
		});
	}
}
