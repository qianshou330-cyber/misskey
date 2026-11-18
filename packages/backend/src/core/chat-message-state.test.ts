/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import type { MiChatMessage } from '@/models/ChatMessage.js';
import { assertChatMessageEditable, chatMessageFingerprint, packChatMessageState } from './chat-message-state.js';

function message(patch: Partial<MiChatMessage> = {}): MiChatMessage {
	return { toUserId: 'recipient', text: 'hello', fileId: null, readTracked: false, readAt: null, revision: 0, editedAt: null, recalledAt: null, clientMessageId: null, ...patch } as MiChatMessage;
}

describe('Chat message state', () => {
	it('does not infer legacy receipts from an empty reads array or a revision', () => {
		expect(packChatMessageState(message({ reads: [], revision: 9 })).readState).toBe('unknown');
		expect(packChatMessageState(message()).readAt).toBeNull();
	});

	it('distinguishes persisted sends from explicit reads', () => {
		expect(packChatMessageState(message({ readTracked: true })).readState).toBe('unread');
		const readAt = new Date('2026-10-12T12:00:00Z');
		expect(packChatMessageState(message({ readTracked: true, readAt }))).toMatchObject({ readState: 'read', readAt: readAt.toISOString() });
	});

	it('normalizes retried text while keeping the recipient and attachment order significant', () => {
		const original = chatMessageFingerprint('alice', { text: ' hello ', attachmentIds: ['one', 'two'] });
		expect(chatMessageFingerprint('alice', { text: 'hello', attachmentIds: ['one', 'two'] })).toBe(original);
		expect(chatMessageFingerprint('bob', { text: 'hello', attachmentIds: ['one', 'two'] })).not.toBe(original);
		expect(chatMessageFingerprint('alice', { text: 'hello', attachmentIds: ['two', 'one'] })).not.toBe(original);
		expect(chatMessageFingerprint('alice', { text: 'hello', fileId: 'one' })).not.toBe(original);
	});

	it('keeps attachment-only retries deterministic', () => {
		expect(chatMessageFingerprint('alice', { text: null, attachmentIds: ['one'] })).toBe(chatMessageFingerprint('alice', { text: '', attachmentIds: ['one'] }));
	});

	it('allows the last millisecond before the edit deadline and rejects the boundary', () => {
		const created = new Date('2026-10-11T12:00:00Z');
		expect(() => assertChatMessageEditable(message(), 0, created, new Date('2026-10-12T11:59:59.999Z'))).not.toThrow();
		expect(() => assertChatMessageEditable(message(), 0, created, new Date('2026-10-12T12:00:00Z'))).toThrow('EDIT_WINDOW_EXPIRED');
	});

	it('rejects stale concurrent edits', () => {
		const now = new Date();
		expect(() => assertChatMessageEditable(message({ revision: 2 }), 1, now, now)).toThrow('MESSAGE_CONFLICT');
	});

	it.each([
		{ recalledAt: new Date() }, { toUserId: null }, { fileId: 'attachment' }, { text: null },
	])('never edits recalled, group or non-text messages: %j', patch => {
		const now = new Date();
		expect(() => assertChatMessageEditable(message(patch), 0, now, now)).toThrow('MESSAGE_NOT_EDITABLE');
	});
});
