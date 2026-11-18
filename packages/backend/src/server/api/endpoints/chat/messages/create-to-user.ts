/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import ms from 'ms';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { GetterService } from '@/server/api/GetterService.js';
import { ApiError } from '@/server/api/error.js';
import { ChatService } from '@/core/ChatService.js';
import { ChatAttachmentService } from '@/core/ChatAttachmentService.js';
import { chatProErrors, throwChatProError } from '../chat-pro-errors.js';

export const meta = {
	tags: ['chat'],

	requireCredential: true,

	prohibitMoved: true,

	kind: 'write:chat',

	limit: {
		duration: ms('1hour'),
		max: 500,
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'ChatMessageLiteFor1on1',
	},

	errors: {
		...chatProErrors,
		clientUpgradeRequired: {
			message: 'Update your client to send private Chat attachments using attachmentIds. Legacy fileId sends are not supported.',
			code: 'CHAT_CLIENT_UPGRADE_REQUIRED',
			id: '12c5f017-0a02-40f2-8299-4575fdf3920e',
		},
		recipientIsYourself: {
			message: 'You can not send a message to yourself.',
			code: 'RECIPIENT_IS_YOURSELF',
			id: '17e2ba79-e22a-4cbc-bf91-d327643f4a7e',
		},

		noSuchUser: {
			message: 'No such user.',
			code: 'NO_SUCH_USER',
			id: '11795c64-40ea-4198-b06e-3c873ed9039d',
		},

		noSuchFile: {
			message: 'No such file.',
			code: 'NO_SUCH_FILE',
			id: '4372b8e2-185d-4146-8749-2f68864a3e5f',
		},

		contentRequired: {
			message: 'Content required. You need to set text or attachmentIds.',
			code: 'CONTENT_REQUIRED',
			id: '25587321-b0e6-449c-9239-f8925092942c',
		},

		youHaveBeenBlocked: {
			message: 'You cannot send a message because you have been blocked by this user.',
			code: 'YOU_HAVE_BEEN_BLOCKED',
			id: 'c15a5199-7422-4968-941a-2a462c478f7d',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		text: { type: 'string', nullable: true, maxLength: 2000 },
		fileId: { type: 'string', format: 'misskey:id' },
		toUserId: { type: 'string', format: 'misskey:id' },
		replyToId: { type: 'string', format: 'misskey:id', nullable: true },
		clientMessageId: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-zA-Z0-9_-]+$' },
		attachmentIds: { type: 'array', maxItems: 10, uniqueItems: true, items: { type: 'string', format: 'misskey:id' } },
	},
	required: ['toUserId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private getterService: GetterService,
		private chatService: ChatService,
		private chatAttachmentService: ChatAttachmentService,
	) {
		super(meta, paramDef, async (ps, me) => {
			// Old clients upload through public Drive first. Never silently import that
			// source as if this request had created a private Chat attachment.
			if (ps.fileId != null) throw new ApiError(meta.errors.clientUpgradeRequired);
			await this.chatService.checkChatAvailability(me.id, 'write');
			if (ps.clientMessageId) {
				try {
					const existing = await this.chatService.findIdempotentUserMessage(me.id, ps.toUserId, ps.clientMessageId, ps);
					if (existing) return existing;
				} catch (error) { throwChatProError(error); }
			}

			// テキストが無いかつ添付ファイルも無かったらエラー
			if (!ps.text?.trim() && !ps.attachmentIds?.length) {
				throw new ApiError(meta.errors.contentRequired);
			}

			// Myself
			if (ps.toUserId === me.id) {
				throw new ApiError(meta.errors.recipientIsYourself);
			}

			const toUser = await this.getterService.getUser(ps.toUserId).catch(err => {
				if (err.id === '15348ddd-432d-49c2-8a5a-8069753becff') throw new ApiError(meta.errors.noSuchUser);
				throw err;
			});

			try {
				const attachmentIds = ps.attachmentIds ?? [];
				return await this.chatService.createMessageToUser(me, toUser, {
					text: ps.text,
					replyToId: ps.replyToId,
					clientMessageId: ps.clientMessageId,
					attachmentIds: ps.attachmentIds,
					bindAttachments: async (manager, messageId) => {
						if (attachmentIds.length) await this.chatAttachmentService.bindToMessage(manager, { ownerId: me.id, toUserId: toUser.id, messageId, attachmentIds });
					},
				});
			} catch (error) { throwChatProError(error); }
		});
	}
}
