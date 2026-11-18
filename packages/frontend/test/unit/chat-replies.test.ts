/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h } from 'vue';
import type { App } from 'vue';
import type { ChatMessage } from '@/types/chat.js';
import { chatReferenceIds, chatReplySummary, isPrivateChatMessage, reconcileChatReplies, unavailableChatReply } from '@/utility/chat-replies.js';
import { mergeChatMessage, mergeChatWindow } from '@/utility/chat-state.js';
import XReply from '@/pages/chat/XReply.vue';
import { i18n } from '@/i18n.js';

function message(id: string, patch: Partial<ChatMessage> = {}): ChatMessage {
	return { id, fromUserId: 'peer', toUserId: 'self', toRoomId: null, text: 'original', revision: 1, recalledAt: null, reactions: [], ...patch } as ChatMessage;
}

describe('private chat quoted references', () => {
	it('limits plaintext to 200 characters, retains only attachment types and flattens quotes', () => {
		const source = message('target', { text: '<script>unsafe</script>' + 'a'.repeat(200), replyTo: unavailableChatReply('nested'), attachments: [{ kind: 'image', url: 'private-media' }, { kind: 'image' }, { kind: 'voice' }] as unknown as ChatMessage['attachments'] });
		const summary = chatReplySummary(source);
		expect(summary.text).toHaveLength(200);
		expect(summary.attachmentTypes).toEqual(['image', 'voice']);
		expect(JSON.stringify(summary)).not.toContain('private-media');
		expect(summary).not.toHaveProperty('replyTo');
		expect(chatReplySummary(message('legacy', { privateAttachmentFallback: true })).text).toBeNull();
	});
	it('accepts own and peer messages only in the current private conversation', () => {
		expect(isPrivateChatMessage(message('peer'), 'self', 'peer')).toBe(true);
		expect(isPrivateChatMessage(message('own', { fromUserId: 'self', toUserId: 'peer' }), 'self', 'peer')).toBe(true);
		expect(isPrivateChatMessage(message('foreign', { toUserId: 'other' }), 'self', 'peer')).toBe(false);
		expect(isPrivateChatMessage(message('room', { toRoomId: 'room' }), 'self', 'peer')).toBe(false);
	});
	it('uses Unicode code points without truncating an emoji surrogate pair', () => {
		const summary = chatReplySummary(message('unicode', { text: 'a'.repeat(199) + '🙂' + 'tail' }));
		expect(summary.text).toBe('a'.repeat(199) + '🙂');
		expect(Array.from(summary.text!)).toHaveLength(200);
	});
	it('deduplicates and bounds reconnect reference reconciliation without loading rows', () => {
		const rows = Array.from({ length: 130 }, (_, index) => message(String(index), { replyToId: 'ref-' + index }));
		expect(chatReferenceIds(rows, unavailableChatReply('composer'))).toHaveLength(121);
		expect(chatReferenceIds([rows[0], rows[0]], unavailableChatReply('ref-0'))).toEqual(['ref-0']);
		const referenced = message('ref-0', { revision: 2, text: 'edited outside window' });
		const result = reconcileChatReplies(rows.slice(0, 120), [referenced], [], 'self', 'peer');
		expect(result).toHaveLength(120);
		expect(result[0].replyTo?.text).toBe('edited outside window');
		expect(result.some(row => row.id === 'ref-0')).toBe(false);
		expect(result[0].readAt).toBeUndefined();
	});
	it('follows edits/recalls without reviving text from stale parent snapshots', () => {
		const target = message('target');
		const row = message('parent', { replyToId: target.id, replyTo: chatReplySummary(target) });
		const edited = reconcileChatReplies([row], [message('target', { revision: 2, text: 'new' })], [], 'self', 'peer')[0];
		expect(mergeChatMessage(edited, row).replyTo?.text).toBe('new');
		const editedParent = { ...row, revision: 3, text: 'latest parent body' };
		expect(mergeChatMessage(editedParent, edited)).toMatchObject({ text: 'latest parent body', replyTo: { text: 'new' } });
		const recalled = reconcileChatReplies([edited], [message('target', { revision: 3, recalledAt: 'now', text: null })], [], 'self', 'peer')[0];
		expect(recalled.replyTo?.text).toBeNull();
		expect(mergeChatMessage(recalled, edited).replyTo?.recalledAt).toBe('now');
		expect(reconcileChatReplies([recalled], [target], [], 'self', 'peer')[0].replyTo?.text).toBeNull();
	});
	it('clears missing content and never substitutes another conversation or an invented author', () => {
		const row = message('parent', { replyToId: 'target', replyTo: chatReplySummary(message('target')) });
		expect(reconcileChatReplies([row], [message('target', { toUserId: 'stranger', text: 'secret' })], [], 'self', 'peer')[0]).toBe(row);
		const missing = reconcileChatReplies([row], [], ['target'], 'self', 'peer')[0].replyTo!;
		expect(missing).toMatchObject({ unavailable: true, text: null, fromUserId: null, attachmentTypes: [] });
		const cleared = { ...row, replyTo: missing };
		expect(mergeChatMessage(cleared, row).replyTo?.unavailable).toBe(true);
		expect(reconcileChatReplies([cleared], [message('target')], [], 'self', 'peer')[0].replyTo?.unavailable).toBe(true);
	});
	it('replaces the visible window with bounded context and remains bounded on older paging', () => {
		const context = Array.from({ length: 41 }, (_, index) => message(String(index + 20).padStart(4, '0')));
		const window = mergeChatWindow([], context);
		expect(window).toHaveLength(41);
		expect(window.some(row => row.id === '0040')).toBe(true);
		const older = Array.from({ length: 120 }, (_, index) => message(String(index).padStart(4, '0')));
		expect(mergeChatWindow(window, older, true, '0040')).toHaveLength(120);
		expect(mergeChatWindow(window, older, true, '0040').some(row => row.id === '0040')).toBe(true);
	});
});

describe('quote rendering', () => {
	let app: App | undefined;
	afterEach(() => { app?.unmount(); document.body.innerHTML = ''; });
	it('labels a recalled original explicitly and lets the reader locate its tombstone', () => {
		const opened = vi.fn();
		const host = document.createElement('div'); document.body.append(host);
		app = createApp({ render: () => h(XReply, { reply: chatReplySummary(message('target', { recalledAt: 'now' })), accountId: 'self', interactive: true, onOpen: opened }) });
		app.mount(host);
		expect(host.textContent).toContain(i18n.ts._chatDaily.replyRecalled);
		host.querySelector('button')!.click();
		expect(opened).toHaveBeenCalledWith('target');
	});
	it('renders HTML/MFM as text and cannot trigger navigation for unavailable quotes', () => {
		const opened = vi.fn();
		const host = document.createElement('div'); document.body.append(host);
		const reply = chatReplySummary(message('target', { text: '<img src=x onerror=alert(1)> **plain**' }));
		app = createApp({ render: () => h(XReply, { reply, accountId: 'self', interactive: true, onOpen: opened }) });
		app.mount(host);
		expect(host.querySelector('img')).toBeNull();
		expect(host.textContent).toContain('<img src=x onerror=alert(1)> **plain**');
		expect(host.querySelector('[data-chat-readable]')).toBeNull();
		host.querySelector('button')!.click();
		expect(opened).toHaveBeenCalledWith('target');
		app.unmount();
		app = createApp({ render: () => h(XReply, { reply: unavailableChatReply('target'), accountId: 'self', interactive: true, onOpen: opened }) });
		app.mount(host);
		host.querySelector('button')!.click();
		expect(opened).toHaveBeenCalledTimes(1);
	});
});
