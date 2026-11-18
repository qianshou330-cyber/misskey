/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const CHAT_WINDOW_SIZE = 120;
export const CHAT_READ_DWELL_MS = 500;

export type ChatRevision = {
	id: string;
	revision?: number;
	readAt?: string | null;
	readState?: 'unknown' | 'unread' | 'read';
	recalledAt?: string | null;
	replyTo?: { id: string; revision: number; recalledAt: string | null; unavailable: boolean } | null;
};

/** Read receipts and content versions advance independently. */
export function mergeChatMessage<T extends ChatRevision>(current: T | undefined, incoming: T): T {
	if (!current) return incoming;
	const newer = (incoming.revision ?? 0) >= (current.revision ?? 0);
	const content = current.recalledAt && !incoming.recalledAt ? current : newer ? incoming : current;
	const readAt = current.readAt ?? incoming.readAt;
	// Quoted content advances independently of the message containing it.
	const previousReply = current.replyTo;
	const nextReply = incoming.replyTo;
	const replyTo = previousReply && nextReply && previousReply.id === nextReply.id
		? !nextReply.unavailable && (previousReply.unavailable || previousReply.recalledAt || previousReply.revision > nextReply.revision) ? previousReply : nextReply
		: content.replyTo;
	return { ...content, ...(replyTo !== undefined ? { replyTo } : {}), ...(readAt ? { readAt, readState: 'read' as const } : {}) };
}

/** Messages are kept newest first; preserve the visible anchor when trimming. */
export function mergeChatWindow<T extends ChatRevision>(current: readonly T[], incoming: readonly T[], older = false, anchorId?: string): T[] {
	const map = new Map(current.map(message => [message.id, message]));
	for (const message of incoming) map.set(message.id, mergeChatMessage(map.get(message.id), message));
	const sorted = [...map.values()].sort((a, b) => b.id.localeCompare(a.id));
	if (sorted.length <= CHAT_WINDOW_SIZE) return sorted;
	const anchor = anchorId ? sorted.findIndex(message => message.id === anchorId) : -1;
	const start = anchor >= 0 ? Math.min(Math.max(0, anchor - 30), sorted.length - CHAT_WINDOW_SIZE) : older ? sorted.length - CHAT_WINDOW_SIZE : 0;
	return sorted.slice(start, start + CHAT_WINDOW_SIZE);
}

export function chatDraftKey(accountId: string, conversationId: string): string {
	return `chatProDraft:${accountId}:${conversationId}`;
}

export function isChatMessageVisible(rect: Pick<DOMRect, 'top' | 'bottom' | 'height' | 'left' | 'right'>, viewport: Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right'>): boolean {
	const height = Math.min(rect.bottom, viewport.bottom) - Math.max(rect.top, viewport.top);
	return rect.height > 0 && height >= Math.min(rect.height * 0.5, 80) && Math.min(rect.right, viewport.right) > Math.max(rect.left, viewport.left);
}

export class ChatReadCandidates {
	private entered = new Map<string, number>();
	public clear(): void { this.entered.clear(); }
	public observe(visibleIds: readonly string[], now: number, enabled: boolean): string[] {
		if (!enabled) { this.clear(); return []; }
		const visible = new Set(visibleIds);
		for (const id of this.entered.keys()) if (!visible.has(id)) this.entered.delete(id);
		for (const id of visible) if (!this.entered.has(id)) this.entered.set(id, now);
		return [...visible].filter(id => now - this.entered.get(id)! >= CHAT_READ_DWELL_MS).slice(0, 100);
	}
	public submitted(ids: readonly string[]): void { for (const id of ids) this.entered.delete(id); }
}
