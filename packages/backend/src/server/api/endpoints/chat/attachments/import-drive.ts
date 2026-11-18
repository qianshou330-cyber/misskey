/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { ChatAttachmentError, ChatAttachmentService } from '@/core/ChatAttachmentService.js';
import { StorageQuotaExceededError } from '@/core/UserStorageQuotaService.js';
import { ChatStorageUnavailableError } from '@/core/ChatAttachmentStorageService.js';
import { chatAttachmentSchema } from '@/models/json-schema/chat-attachment.js';
import { isChatFirstMessageError } from '@/core/chat-message-state.js';
import { chatFirstMessageErrors, throwChatProError } from '../chat-pro-errors.js';

export const meta = {
	tags: ['chat'], requireCredential: true, prohibitMoved: true, kind: 'write:chat',
	limit: { duration: 60 * 60_000, max: 120 }, res: chatAttachmentSchema,
	errors: { ...chatFirstMessageErrors, rejected: { message: 'Drive file cannot be imported into private Chat.', code: 'CHAT_ATTACHMENT_REJECTED', id: '824a2ec9-c82f-4488-9c48-b632c6363fa9' } },
} as const;
export const paramDef = { type: 'object', properties: { toUserId: { type: 'string', format: 'misskey:id' }, fileId: { type: 'string', format: 'misskey:id' } }, required: ['toUserId', 'fileId'] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(service: ChatAttachmentService) {
		super(meta, paramDef, async (ps, me) => {
			try { return await service.importDrive(me.id, ps.toUserId, ps.fileId); } catch (error) {
				if (isChatFirstMessageError(error)) throwChatProError(error);
				if (error instanceof ChatAttachmentError || error instanceof StorageQuotaExceededError || error instanceof ChatStorageUnavailableError) throw new ApiError(meta.errors.rejected);
				throw error;
			}
		});
	}
}
