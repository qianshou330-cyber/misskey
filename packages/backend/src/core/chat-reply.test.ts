/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { MiChatMessage } from '@/models/ChatMessage.js';
import { chatMessageFingerprint } from './chat-message-state.js';
import { packChatReply, samePrivateConversation } from './chat-reply.js';

const message = (patch: Partial<MiChatMessage> = {}) => ({ id: 'target', fromUserId: 'alice', toUserId: 'bob', toRoomId: null, text: 'original', revision: 0, recalledAt: null, ...patch }) as MiChatMessage;

describe('private message references', () => {
	it('requires the exact pair in either direction and never admits rooms or a third participant', () => {
		expect(samePrivateConversation(message(), 'alice', 'bob')).toBe(true);
		expect(samePrivateConversation(message(), 'bob', 'alice')).toBe(true);
		expect(samePrivateConversation(message(), 'alice', 'carol')).toBe(false);
		expect(samePrivateConversation(message({ toRoomId: 'room' }), 'alice', 'bob')).toBe(false);
		expect(samePrivateConversation(message({ toUserId: null }), 'alice', 'bob')).toBe(false);
	});

	it('bounds text by Unicode code points and exposes neither nested replies nor attachment URLs', () => {
		const summary = packChatReply('target', message({ text: '😀'.repeat(201), replyToId: 'nested', fileId: 'private-file' }), ['voice', 'image', 'voice']);
		expect(Array.from(summary.text!).length).toBe(200);
		expect(summary.text).toBe('😀'.repeat(200));
		expect(summary.attachmentTypes).toEqual(['voice', 'image']);
		expect(Object.keys(summary).sort()).toEqual(['attachmentTypes', 'fromUserId', 'id', 'recalledAt', 'revision', 'text', 'unavailable']);
	});

	it('reads the current revision and clears all original content after recall', () => {
		expect(packChatReply('target', message({ text: 'edited', revision: 2 }))).toMatchObject({ text: 'edited', revision: 2 });
		const recalledAt = new Date('2026-10-22T00:00:00Z');
		expect(packChatReply('target', message({ recalledAt, revision: 3 }), ['image'])).toEqual({
			id: 'target', fromUserId: 'alice', text: null, attachmentTypes: [], revision: 3, recalledAt: recalledAt.toISOString(), unavailable: false,
		});
	});

	it('does not invent an author or disclose content for unavailable references', () => {
		expect(packChatReply('missing', null, ['file'])).toEqual({ id: 'missing', fromUserId: null, text: null, attachmentTypes: [], revision: 0, recalledAt: null, unavailable: true });
	});

	it('preserves the pre-upgrade fingerprint byte for byte for omitted or null references', () => {
		const old = createHash('sha256').update('{"toUserId":"bob","text":"hello","fileId":null,"attachmentIds":[]}').digest('hex');
		expect(chatMessageFingerprint('bob', { text: ' hello ' })).toBe(old);
		expect(chatMessageFingerprint('bob', { text: 'hello', replyToId: null })).toBe(old);
		expect(chatMessageFingerprint('bob', { text: 'hello', replyToId: 'one' })).not.toBe(old);
		expect(chatMessageFingerprint('bob', { text: 'hello', replyToId: 'one' })).not.toBe(chatMessageFingerprint('bob', { text: 'hello', replyToId: 'two' }));
	});
});
