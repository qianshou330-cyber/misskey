/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { ChatAttachmentError, ChatAttachmentService } from '@/core/ChatAttachmentService.js';

export const meta = {
	tags: ['chat'], requireCredential: true, kind: 'write:chat',
	limit: { duration: 60_000, max: 120 },
	errors: { attached: { message: 'Recall the message to remove an attached file.', code: 'CHAT_ATTACHMENT_ALREADY_BOUND', id: '965b333a-1cb5-4edc-a454-e75d2a1e7bbb' } },
} as const;
export const paramDef = { type: 'object', properties: { attachmentId: { type: 'string', format: 'misskey:id' } }, required: ['attachmentId'] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(service: ChatAttachmentService) {
		super(meta, paramDef, async (ps, me) => {
			try { await service.cancel(me.id, ps.attachmentId); } catch (error) {
				if (error instanceof ChatAttachmentError) throw new ApiError(meta.errors.attached);
				throw error;
			}
		});
	}
}
