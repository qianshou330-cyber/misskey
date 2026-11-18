/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import { ChatReadCandidates, chatDraftKey, isChatMessageVisible, mergeChatMessage, mergeChatWindow } from '@/utility/chat-state.js';

describe('Chat state reconciliation', () => {
	it('does not regress edits, read receipts or recalls after reconnect', () => {
		const current = { id: 'a', revision: 3, text: 'edited', readAt: 'now' as string | null, recalledAt: null as string | null };
		expect(mergeChatMessage(current, { ...current, revision: 1, text: 'old', readAt: null }).text).toBe('edited');
		expect(mergeChatMessage(current, { ...current, revision: 4, readAt: null }).readAt).toBe('now');
		expect(mergeChatMessage({ ...current, recalledAt: 'now' }, { ...current, revision: 5 }).recalledAt).toBe('now');
	});
	it('deduplicates HTTP/stream copies and bounds both paging directions', () => {
		const messages = Array.from({ length: 150 }, (_, index) => ({ id: String(index).padStart(4, '0') }));
		expect(mergeChatWindow(messages, messages)).toHaveLength(120);
		expect(mergeChatWindow([], messages)[0].id).toBe('0149');
		expect(mergeChatWindow([], messages, true).at(-1)?.id).toBe('0000');
		expect(mergeChatWindow([], messages, true, '0130').some(m => m.id === '0130')).toBe(true);
	});
	it('isolates drafts across accounts sharing a recipient', () => {
		expect(chatDraftKey('one', 'recipient')).not.toBe(chatDraftKey('two', 'recipient'));
	});
});

describe('explicit visible reads', () => {
	it('requires continuous visible dwell, resets on inactive/hidden/reconnect', () => {
		const candidates = new ChatReadCandidates();
		expect(candidates.observe(['one'], 0, true)).toEqual([]);
		expect(candidates.observe(['one'], 499, true)).toEqual([]);
		expect(candidates.observe(['one'], 500, true)).toEqual(['one']);
		candidates.observe(['one'], 501, false);
		expect(candidates.observe(['one'], 1000, true)).toEqual([]);
		candidates.observe([], 1100, true);
		expect(candidates.observe(['one'], 1500, true)).toEqual([]);
	});
	it('never marks overscan as visible and permits tall messages', () => {
		const viewport = { top: 100, bottom: 500, left: 0, right: 300 };
		expect(isChatMessageVisible({ top: 600, bottom: 700, height: 100, left: 0, right: 300 }, viewport)).toBe(false);
		expect(isChatMessageVisible({ top: 450, bottom: 1450, height: 1000, left: 0, right: 300 }, viewport)).toBe(false);
		expect(isChatMessageVisible({ top: 400, bottom: 1400, height: 1000, left: 0, right: 300 }, viewport)).toBe(true);
	});
	it('caps batches at 100 explicit IDs', () => {
		const candidates = new ChatReadCandidates();
		const ids = Array.from({ length: 120 }, (_, i) => String(i));
		candidates.observe(ids, 0, true);
		expect(candidates.observe(ids, 500, true)).toHaveLength(100);
	});
});
