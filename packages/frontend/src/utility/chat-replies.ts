/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { ChatMessage, ChatReply } from '@/types/chat.js';
import { CHAT_WINDOW_SIZE } from '@/utility/chat-state.js';

export function isPrivateChatMessage(message: ChatMessage, accountId: string, userId: string): boolean {
	return !message.toRoomId && ((message.fromUserId === accountId && message.toUserId === userId) || (message.fromUserId === userId && message.toUserId === accountId));
}

/** A quote is plain text and type labels only: never retain attachment URLs. */
export function chatReplySummary(message: ChatMessage): ChatReply {
	return {
		id: message.id,
		fromUserId: message.fromUserId,
		text: message.recalledAt ? null : message.privateAttachmentFallback ? null : message.text ? Array.from(message.text).slice(0, 200).join('') : null,
		attachmentTypes: message.recalledAt ? [] : [...new Set(message.attachments?.map(attachment => attachment.kind) ?? (message.file ? ['file' as const] : []))],
		revision: message.revision ?? 0,
		recalledAt: message.recalledAt ?? null,
		unavailable: false,
	};
}

export function unavailableChatReply(id: string): ChatReply {
	return { id, fromUserId: null, text: null, attachmentTypes: [], revision: 0, recalledAt: null, unavailable: true };
}

/** Reconcile only the displayed window and current composer reference. */
export function chatReferenceIds(messages: readonly ChatMessage[], selected?: ChatReply | null): string[] {
	return [...new Set([...messages.slice(0, CHAT_WINDOW_SIZE).map(message => message.replyToId), selected?.id].filter((id): id is string => Boolean(id)))].slice(0, CHAT_WINDOW_SIZE + 1);
}

export function reconcileChatReplies(messages: readonly ChatMessage[], updates: readonly ChatMessage[], missingIds: readonly string[], accountId: string, userId: string): ChatMessage[] {
	const updatesById = new Map(updates.filter(message => isPrivateChatMessage(message, accountId, userId)).map(message => [message.id, chatReplySummary(message)]));
	const missing = new Set(missingIds);
	return messages.map(message => {
		if (!message.replyToId) return message;
		const reply = missing.has(message.replyToId) ? unavailableChatReply(message.replyToId) : updatesById.get(message.replyToId);
		if (!reply) return message;
		const current = message.replyTo;
		if (!reply.unavailable && current && (current.unavailable || current.recalledAt || current.revision > reply.revision)) return message;
		return { ...message, replyTo: reply };
	});
}
