/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { ChatAttachmentError, ChatAttachmentService } from '@/core/ChatAttachmentService.js';
import { StorageQuotaExceededError } from '@/core/UserStorageQuotaService.js';
import { ChatVoiceRejectedError } from '@/core/ChatVoiceService.js';
import { ChatStorageUnavailableError } from '@/core/ChatAttachmentStorageService.js';
import { chatAttachmentSchema } from '@/models/json-schema/chat-attachment.js';
import { isChatFirstMessageError } from '@/core/chat-message-state.js';
import { chatFirstMessageErrors, throwChatProError } from '../chat-pro-errors.js';

export const meta = {
	tags: ['chat'], requireCredential: true, requireFile: true, prohibitMoved: true, kind: 'write:chat',
	limit: { duration: 60 * 60_000, max: 120 },
	res: chatAttachmentSchema,
	errors: {
		...chatFirstMessageErrors,
		rejected: { message: 'Attachment rejected. Check its size, type, recipient and available storage.', code: 'CHAT_ATTACHMENT_REJECTED', id: '86056b0f-7848-4bfa-93e6-dac55371ac39' },
		storageUnavailable: { message: 'Private Chat storage is unavailable.', code: 'CHAT_STORAGE_UNAVAILABLE', id: '7df34b20-8c5b-4712-a2c6-5394717ab26c' },
	},
} as const;
export const paramDef = {
	type: 'object', properties: {
		toUserId: { type: 'string', format: 'misskey:id' },
		name: { type: 'string', maxLength: 200 },
		kind: { type: 'string', enum: ['file', 'voice'], default: 'file' },
	}, required: ['toUserId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(service: ChatAttachmentService) {
		super(meta, paramDef, async (ps, me, _token, file, cleanup) => {
			try {
				return await service.create(me.id, ps.toUserId, file!.path, ps.name ?? file!.name ?? 'attachment', ps.kind);
			} catch (error) {
				if (isChatFirstMessageError(error)) throwChatProError(error);
				if (error instanceof ChatStorageUnavailableError) throw new ApiError(meta.errors.storageUnavailable);
				if (error instanceof ChatAttachmentError || error instanceof StorageQuotaExceededError || error instanceof ChatVoiceRejectedError) throw new ApiError(meta.errors.rejected);
				throw error;
			} finally { cleanup?.(); }
		});
	}
}
