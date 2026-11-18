/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from 'node:crypto';
import type { MiChatMessage } from '@/models/ChatMessage.js';

export class ChatMessageStateError extends Error {
	constructor(public readonly code: 'MESSAGE_CONFLICT' | 'EDIT_WINDOW_EXPIRED' | 'MESSAGE_NOT_EDITABLE' | 'CONTENT_REQUIRED' | 'RECIPIENT_UNAVAILABLE' | 'IDEMPOTENCY_CONFLICT' | 'ATTACHMENTS_UNAVAILABLE' | 'REPLY_TARGET_UNAVAILABLE' | 'CHAT_REPLY_REQUIRED' | 'CHAT_FIRST_MESSAGE_TEXT_ONLY') {
		super(code);
	}
}

export function isChatFirstMessageError(error: unknown): error is ChatMessageStateError {
	return error instanceof ChatMessageStateError && (error.code === 'CHAT_REPLY_REQUIRED' || error.code === 'CHAT_FIRST_MESSAGE_TEXT_ONLY');
}

export function chatMessageFingerprint(toUserId: string, params: { text?: string | null; fileId?: string | null; attachmentIds?: string[]; replyToId?: string | null }): string {
	return createHash('sha256').update(JSON.stringify({
		toUserId,
		text: params.text?.trim() || null,
		fileId: params.fileId ?? null,
		attachmentIds: params.attachmentIds ?? [],
		// Omit for non-replies: pre-upgrade retry fingerprints must remain identical.
		...(params.replyToId ? { replyToId: params.replyToId } : {}),
	})).digest('hex');
}

export function packChatMessageState(message: MiChatMessage) {
	return {
		clientMessageId: message.clientMessageId ?? null,
		revision: message.revision ?? 0,
		editedAt: message.editedAt?.toISOString() ?? null,
		recalledAt: message.recalledAt?.toISOString() ?? null,
		readTracked: message.readTracked ?? false,
		readAt: message.readAt?.toISOString() ?? null,
		readState: !message.readTracked ? 'unknown' as const : message.readAt ? 'read' as const : 'unread' as const,
	};
}

export function assertChatMessageEditable(message: MiChatMessage, expectedRevision: number, createdAt: Date, now = new Date()): void {
	if (message.recalledAt || message.toUserId == null || message.fileId != null || message.text == null) {
		throw new ChatMessageStateError('MESSAGE_NOT_EDITABLE');
	}
	if (now.getTime() - createdAt.getTime() >= 24 * 60 * 60 * 1000) {
		throw new ChatMessageStateError('EDIT_WINDOW_EXPIRED');
	}
	if (message.revision !== expectedRevision) throw new ChatMessageStateError('MESSAGE_CONFLICT');
}
