/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { ChatAttachmentError, ChatAttachmentService } from '@/core/ChatAttachmentService.js';
import { ChatService } from '@/core/ChatService.js';
import { chatAttachmentSchema } from '@/models/json-schema/chat-attachment.js';

export const meta = {
	tags: ['chat'], requireCredential: true, kind: 'read:chat',
	limit: { duration: 60_000, max: 300 }, res: chatAttachmentSchema,
	errors: { unavailable: { message: 'Attachment is unavailable.', code: 'CHAT_ATTACHMENT_UNAVAILABLE', id: '28d9883d-1f8a-4688-9622-b75b3b950d72' } },
} as const;

export const paramDef = {
	type: 'object', properties: { attachmentId: { type: 'string', format: 'misskey:id' } }, required: ['attachmentId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(service: ChatAttachmentService, chat: ChatService) {
		super(meta, paramDef, async (ps, me, token) => {
			try {
				if (!await chat.canReadChatStream(me, token ?? undefined)) throw new ApiError(meta.errors.unavailable);
				const { attachment, blob } = await service.authorizedAttachment(me.id, ps.attachmentId);
				return service.pack(attachment, blob);
			} catch (error) {
				if (error instanceof ChatAttachmentError) throw new ApiError(meta.errors.unavailable);
				throw error;
			}
		});
	}
}
