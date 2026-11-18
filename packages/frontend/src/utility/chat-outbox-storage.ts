/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { ChatOutboxItem } from '@/types/chat.js';
import { parseChatSendFailureCode } from '@/utility/chat-send-failure.js';

const PREFIX = 'chatProOutbox:';
export const CHAT_OUTBOX_TTL = 24 * 60 * 60 * 1000;
export const chatOutboxClearListeners = new Set<(accountId: string) => void>();

export function chatOutboxKey(accountId: string, userId: string): string { return `${PREFIX}${accountId}:${userId}`; }

/** Whitelist serialized content: transport credentials and Blobs never enter storage. */
export function parseChatOutbox(value: string | null, userId: string, now = Date.now()): ChatOutboxItem[] {
	try {
		const parsed: unknown = JSON.parse(value ?? '[]');
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((item): item is ChatOutboxItem => {
			const snapshot = item?.snapshot;
			const age = now - Date.parse(item?.createdAt);
			return snapshot?.toUserId === userId && typeof snapshot.clientMessageId === 'string' && snapshot.clientMessageId.length > 0 && snapshot.clientMessageId.length <= 64 && (snapshot.text == null || (typeof snapshot.text === 'string' && snapshot.text.length <= 10000)) && (snapshot.replyToId == null || (typeof snapshot.replyToId === 'string' && snapshot.replyToId.length > 0 && snapshot.replyToId.length <= 64)) && (snapshot.attachmentIds == null || (Array.isArray(snapshot.attachmentIds) && snapshot.attachmentIds.length <= 10 && snapshot.attachmentIds.every((id: unknown) => typeof id === 'string'))) && Number.isFinite(age) && age >= 0;
		}).slice(-20).map(item => ({ snapshot: { clientMessageId: item.snapshot.clientMessageId, toUserId: userId, text: item.snapshot.text, attachmentIds: item.snapshot.attachmentIds?.slice(), ...(item.snapshot.replyToId !== undefined ? { replyToId: item.snapshot.replyToId } : {}) }, createdAt: item.createdAt, status: item.status === 'expired' || now - Date.parse(item.createdAt) >= CHAT_OUTBOX_TTL ? 'expired' : 'failed', failureCode: parseChatSendFailureCode(item.failureCode) }));
	} catch { return []; }
}

export function saveChatOutbox(storage: Storage, key: string, items: ChatOutboxItem[]): boolean {
	try {
		// Expired text remains available in the current in-memory UI for explicit
		// recovery, but must not extend the original 24-hour storage lifetime.
		const now = Date.now();
		const retained = items.filter(item => item.status !== 'expired' && Number.isFinite(Date.parse(item.createdAt)) && now - Date.parse(item.createdAt) < CHAT_OUTBOX_TTL);
		if (!retained.length) storage.removeItem(key);
		else storage.setItem(key, JSON.stringify(retained.map(item => ({ createdAt: item.createdAt, status: item.status, failureCode: parseChatSendFailureCode(item.failureCode), snapshot: { clientMessageId: item.snapshot.clientMessageId, toUserId: item.snapshot.toUserId, text: item.snapshot.text, attachmentIds: item.snapshot.attachmentIds?.slice(), replyToId: item.snapshot.replyToId } }))));
		return true;
	} catch { return false; }
}

export function clearChatOutboxAccount(accountId: string): void {
	try {
		for (const key of Object.keys(window.sessionStorage)) if (key.startsWith(`${PREFIX}${accountId}:`)) window.sessionStorage.removeItem(key);
	} catch { /* Storage can be disabled by the browser. */ }
	for (const listener of chatOutboxClearListeners) listener(accountId);
}
