/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type * as Misskey from 'misskey-js';

export type ChatAttachment = Misskey.Endpoints['chat/attachments/import-drive']['res'];
export type ChatMessage = Misskey.entities.ChatMessageLite;
export type ChatReply = NonNullable<ChatMessage['replyTo']>;
export type ChatConversation = Misskey.Endpoints['chat/conversations']['res'][number];

/** The local outbox always requires the optional API idempotency nonce. */
export type ChatSendSnapshot = Pick<Misskey.Endpoints['chat/messages/create-to-user']['req'], 'toUserId' | 'text' | 'attachmentIds' | 'replyToId'> & {
	clientMessageId: NonNullable<Misskey.Endpoints['chat/messages/create-to-user']['req']['clientMessageId']>;
};

export type ChatSendFailureCode = 'CHAT_REPLY_REQUIRED' | 'CHAT_FIRST_MESSAGE_TEXT_ONLY';

export type ChatOutboxItem = {
	snapshot: ChatSendSnapshot;
	createdAt: string;
	status: 'sending' | 'failed' | 'expired';
	failureCode?: ChatSendFailureCode;
};
