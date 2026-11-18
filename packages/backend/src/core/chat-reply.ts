/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { MiChatMessage } from '@/models/ChatMessage.js';

export type ChatReplyAttachmentType = 'image' | 'file' | 'voice';

export function samePrivateConversation(message: Pick<MiChatMessage, 'fromUserId' | 'toUserId' | 'toRoomId'>, userId: string, otherId: string): boolean {
	return message.toRoomId == null && message.toUserId != null && (
		(message.fromUserId === userId && message.toUserId === otherId)
		|| (message.fromUserId === otherId && message.toUserId === userId)
	);
}

export function packChatReply(id: string, target: MiChatMessage | null, attachmentTypes: ChatReplyAttachmentType[] = []) {
	return {
		id,
		fromUserId: target?.fromUserId ?? null,
		text: target && !target.recalledAt && target.text ? Array.from(target.text).slice(0, 200).join('') : null,
		attachmentTypes: target && !target.recalledAt ? [...new Set(attachmentTypes)] : [],
		revision: target?.revision ?? 0,
		recalledAt: target?.recalledAt?.toISOString() ?? null,
		unavailable: target == null,
	};
}
