/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { ChatSendFailureCode } from '@/types/chat.js';

/** Only these business codes may enter local storage or sender-facing UI. */
export function parseChatSendFailureCode(value: unknown): ChatSendFailureCode | undefined {
	return value === 'CHAT_REPLY_REQUIRED' || value === 'CHAT_FIRST_MESSAGE_TEXT_ONLY' ? value : undefined;
}

export function getChatSendFailureCode(error: unknown): ChatSendFailureCode | undefined {
	return typeof error === 'object' && error !== null && 'code' in error ? parseChatSendFailureCode(error.code) : undefined;
}
