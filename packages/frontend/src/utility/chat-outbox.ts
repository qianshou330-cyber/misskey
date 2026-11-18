/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { ChatOutboxItem, ChatSendSnapshot } from '@/types/chat.js';
import { CHAT_OUTBOX_TTL } from '@/utility/chat-outbox-storage.js';
import { getChatSendFailureCode } from '@/utility/chat-send-failure.js';

/** A failed request retains its immutable nonce and content, never a credential. */
export class ChatOutbox<T> {
	public items: ChatOutboxItem[] = [];
	private running = new Set<string>();
	public constructor(private send: (snapshot: ChatSendSnapshot) => Promise<T>, private changed: () => void, private accepted: (message: T) => void) {}
	public enqueue(snapshot: ChatSendSnapshot): Promise<boolean> {
		if (this.items.some(item => item.snapshot.clientMessageId === snapshot.clientMessageId)) return this.retry(snapshot.clientMessageId);
		if (this.items.length >= 20) throw new Error('CHAT_OUTBOX_FULL');
		this.items.push({ snapshot: { ...snapshot, attachmentIds: snapshot.attachmentIds?.slice() }, createdAt: new Date().toISOString(), status: 'sending' });
		this.changed();
		return this.retry(snapshot.clientMessageId);
	}
	public confirm(clientMessageId: string): void {
		this.items = this.items.filter(item => item.snapshot.clientMessageId !== clientMessageId);
		this.changed();
	}
	/** Preserve expired text for explicit copying/discarding; never auto-send it. */
	public expire(now = Date.now()): number {
		let count = 0;
		for (const item of this.items) {
			if (item.status === 'expired' || this.running.has(item.snapshot.clientMessageId)) continue;
			if (!Number.isFinite(Date.parse(item.createdAt)) || now - Date.parse(item.createdAt) >= CHAT_OUTBOX_TTL) { item.status = 'expired'; count++; }
		}
		if (count) this.changed();
		return count;
	}
	/** An in-flight send may already be accepted; only discard settled failures. */
	public discard(clientMessageId: string): ChatSendSnapshot | null {
		const item = this.items.find(entry => entry.snapshot.clientMessageId === clientMessageId);
		if (!item || this.running.has(clientMessageId) || item.status === 'sending') return null;
		this.items = this.items.filter(entry => entry !== item);
		this.changed();
		return { ...item.snapshot, attachmentIds: item.snapshot.attachmentIds?.slice() };
	}
	public async retry(clientMessageId: string): Promise<boolean> {
		this.expire();
		const item = this.items.find(entry => entry.snapshot.clientMessageId === clientMessageId);
		if (!item || item.status === 'expired' || this.running.has(clientMessageId)) return false;
		this.running.add(clientMessageId);
		item.status = 'sending';
		item.failureCode = undefined;
		this.changed();
		try {
			const result = await this.send({ ...item.snapshot, attachmentIds: item.snapshot.attachmentIds?.slice() });
			this.confirm(clientMessageId);
			this.accepted(result);
			return true;
		} catch (error) {
			// A stream confirmation can win the race with a failed HTTP response.
			if (!this.items.includes(item)) return true;
			const unavailable = Boolean(item.snapshot.attachmentIds?.length) && typeof error === 'object' && error !== null && 'code' in error && error.code === 'ATTACHMENTS_UNAVAILABLE';
			item.status = unavailable || Date.now() - Date.parse(item.createdAt) >= CHAT_OUTBOX_TTL ? 'expired' : 'failed';
			item.failureCode = item.status === 'failed' ? getChatSendFailureCode(error) : undefined;
			this.changed();
			return false;
		} finally {
			this.running.delete(clientMessageId);
		}
	}
}
