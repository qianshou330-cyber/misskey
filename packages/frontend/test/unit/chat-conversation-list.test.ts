/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { mergeChatConversationPages } from '@/utility/chat-conversation-list.js';

const row = (id: string, date: string, pinnedAt: string | null = null) => ({ id, pinnedAt, message: { id, createdAt: date } });

describe('independent pinned conversation page', () => {
	test('retains an old pin and deduplicates it across repeated ordinary pages', () => {
		const pin = row('old', '2020', '2026');
		const first = mergeChatConversationPages([], [row('new', '2026')], [pin], false);
		const next = mergeChatConversationPages(first, [row('new', '2026'), row('middle', '2024'), row('old', '2020')], [pin], true);
		expect(next.map(item => item.id)).toEqual(['old', 'new', 'middle']);
	});
	test('refresh moves newly pinned rows out of ordinary pages and respects server pin ordering', () => {
		const old = row('old', '2020', '2025');
		const recent = row('recent', '2026', '2026');
		const result = mergeChatConversationPages([old, row('recent', '2026')], [recent, row('room', '2024')], [recent, old], true);
		expect(result.map(item => item.id)).toEqual(['recent', 'old', 'room']);
	});
	test('unpin replaces the prior pin and fresh reload drops stale ordinary pages', () => {
		const result = mergeChatConversationPages([row('old', '2020', '2025'), row('stale', '2021')], [row('old', '2020')], [], false);
		expect(result).toEqual([row('old', '2020')]);
	});
});
