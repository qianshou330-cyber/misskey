/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ChatMessageAccessError } from '@/core/ChatService.js';
import { ChatMessageStateError } from '@/core/chat-message-state.js';
import { ApiError } from '@/server/api/error.js';
import { chatContactErrors } from '@/core/ChatContactService.js';
import { ChatAttachmentError } from '@/core/ChatAttachmentService.js';

export const chatFirstMessageErrors = {
	replyRequired: { message: 'Wait for this recipient to reply before sending another message.', code: 'CHAT_REPLY_REQUIRED', id: 'dbbd8f3a-66ab-4c8a-9c5f-3f43035044ac' },
	firstMessageTextOnly: { message: 'The first message to this recipient may contain text and emoji only.', code: 'CHAT_FIRST_MESSAGE_TEXT_ONLY', id: '1ca59c39-b417-48fb-9be0-274b5a16f720' },
} as const;

export const chatProErrors = {
	...chatFirstMessageErrors,
	replyTargetUnavailable: { message: 'The referenced message is unavailable in this conversation.', code: 'REPLY_TARGET_UNAVAILABLE', id: 'f46b3e28-450f-41c8-a768-6f9b56cbbd29' },
	chatBlocked: chatContactErrors.blocked,
	noSuchMessage: { message: 'No such message.', code: 'NO_SUCH_MESSAGE', id: 'c19e212a-52f7-49cf-a8b9-2954dbf6f4ff' },
	messageConflict: { message: 'The message changed. Reload it before editing.', code: 'MESSAGE_CONFLICT', id: '51b1679b-22dd-4119-9a5a-c4a825fb4577' },
	editWindowExpired: { message: 'Messages may only be edited within 24 hours.', code: 'EDIT_WINDOW_EXPIRED', id: '06e6cee1-bdc6-47ae-b580-c632075598a6' },
	messageNotEditable: { message: 'This message cannot be edited.', code: 'MESSAGE_NOT_EDITABLE', id: '74103215-d9ca-4f2a-b546-d32e40228a6e' },
	contentRequired: { message: 'Message content is required.', code: 'CONTENT_REQUIRED', id: '6a2d0c6c-ec29-4eb4-98b0-51f404f1fbec' },
	recipientUnavailable: { message: 'This recipient cannot receive the message.', code: 'RECIPIENT_UNAVAILABLE', id: '7e7adfd8-b2d1-4dc3-bd3b-cd29d83154c8' },
	idempotencyConflict: { message: 'This client message ID was used for different content.', code: 'IDEMPOTENCY_CONFLICT', id: 'a5728149-a0dc-4b32-a166-46328b00eb1d' },
	attachmentsUnavailable: { message: 'These attachments cannot be sent.', code: 'ATTACHMENTS_UNAVAILABLE', id: 'f0cc5f2d-717a-4b87-894b-82aee313d285' },
} as const;

export function throwChatProError(error: unknown): never {
	if (error instanceof ChatAttachmentError) throw new ApiError(chatProErrors.attachmentsUnavailable);
	if (error instanceof ChatMessageAccessError) throw new ApiError(chatProErrors.noSuchMessage);
	if (error instanceof ChatMessageStateError) {
		const definition = Object.values(chatProErrors).find(value => value.code === error.code);
		if (definition) throw new ApiError(definition);
	}
	throw error;
}
