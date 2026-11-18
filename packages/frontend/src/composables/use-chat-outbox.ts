/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { shallowRef, triggerRef } from 'vue';
import type { ShallowRef } from 'vue';
import type { ChatMessage, ChatOutboxItem } from '@/types/chat.js';
import { ChatOutbox } from '@/utility/chat-outbox.js';
import { chatApi } from '@/utility/chat-api.js';
import { $i } from '@/i.js';
import { chatOutboxClearListeners, chatOutboxKey, parseChatOutbox, saveChatOutbox } from '@/utility/chat-outbox-storage.js';

type Outbox = { queue: ChatOutbox<ChatMessage>; items: ShallowRef<ChatOutboxItem[]>; listeners: Set<(message: ChatMessage) => void>; persistent: ShallowRef<boolean> };
const outboxes = new Map<string, Outbox>();
chatOutboxClearListeners.add(accountId => {
	for (const [key, outbox] of outboxes) if (key.startsWith(`${accountId}:`)) { outbox.queue.items = []; outbox.items.value = []; outbox.listeners.clear(); outboxes.delete(key); }
});

export function useChatOutbox(accountId: string, userId: string): Outbox {
	const key = `${accountId}:${userId}`;
	const existing = outboxes.get(key);
	if (existing) return existing;
	const items = shallowRef<ChatOutboxItem[]>([]);
	const persistent = shallowRef(true);
	const storageKey = chatOutboxKey(accountId, userId);
	const listeners = new Set<(message: ChatMessage) => void>();
	const queue = new ChatOutbox<ChatMessage>(async snapshot => {
		if ($i?.id !== accountId || snapshot.toUserId !== userId) throw new Error('CHAT_ACCOUNT_CHANGED');
		return chatApi('chat/messages/create-to-user', snapshot, AbortSignal.timeout(30_000));
	}, () => {
		items.value = queue.items;
		triggerRef(items);
		try { persistent.value = saveChatOutbox(window.sessionStorage, storageKey, queue.items); } catch { persistent.value = false; }
	}, message => { for (const listener of listeners) listener(message); });
	try {
		queue.items = parseChatOutbox(window.sessionStorage.getItem(storageKey), userId);
		persistent.value = saveChatOutbox(window.sessionStorage, storageKey, queue.items);
	} catch { persistent.value = false; }
	items.value = queue.items;
	const outbox = { items, queue, listeners, persistent };
	outboxes.set(key, outbox);
	return outbox;
}
