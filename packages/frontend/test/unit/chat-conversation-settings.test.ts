/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MenuItem } from '@/types/menu.js';

const mocks = vi.hoisted(() => ({ api: vi.fn(), menu: vi.fn(), alert: vi.fn(), refresh: vi.fn(), account: { id: 'self' } }));
vi.mock('@/utility/chat-api.js', () => ({ chatApi: mocks.api }));
vi.mock('@/utility/chat-summary.js', () => ({ refreshChatSummary: mocks.refresh }));
vi.mock('@/i.js', () => ({ get $i() { return mocks.account; } }));
vi.mock('@/os.js', () => ({ popupMenu: mocks.menu, alert: mocks.alert }));
import { showChatConversationMenu } from '@/utility/chat-conversation-settings.js';
import { i18n } from '@/i18n.js';

function click(index: number): void {
	const item = (mocks.menu.mock.calls[0][0] as MenuItem[])[index];
	if ('action' in item) item.action(new Event('click') as PointerEvent);
}

beforeEach(() => { vi.clearAllMocks(); mocks.account.id = 'self'; });

describe('private conversation settings menu', () => {
	it('fetches fresh preferences, explicitly toggles mute, then invalidates badges/history', async () => {
		const changed = vi.fn();
		mocks.api.mockResolvedValueOnce({ pinnedAt: null, isMuted: true }).mockResolvedValueOnce({ pinnedAt: null, isMuted: false });
		await showChatConversationMenu('peer', null, changed);
		expect(mocks.api.mock.calls[0].slice(0, 2)).toEqual(['chat/conversation-settings/show', { userId: 'peer' }]);
		click(1);
		await vi.waitFor(() => expect(changed).toHaveBeenCalledWith({ pinnedAt: null, isMuted: false }));
		expect(mocks.api.mock.calls[1].slice(0, 2)).toEqual(['chat/conversation-settings/update', { userId: 'peer', isMuted: false }]);
		expect(mocks.refresh).toHaveBeenCalledOnce();
	});
	it('does not mutate preferences from a stale menu after an account change', async () => {
		mocks.api.mockResolvedValueOnce({ pinnedAt: null, isMuted: false });
		await showChatConversationMenu('peer');
		mocks.account.id = 'different';
		click(0);
		expect(mocks.api).toHaveBeenCalledTimes(1);
	});
	it('ignores late settings after an account switch', async () => {
		let resolve!: (value: unknown) => void;
		mocks.api.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
		const pending = showChatConversationMenu('peer');
		mocks.account.id = 'different';
		resolve({ pinnedAt: null, isMuted: false });
		await pending;
		expect(mocks.menu).not.toHaveBeenCalled();
	});
	it('shows a useful limit error without changing the displayed settings', async () => {
		const changed = vi.fn();
		mocks.api.mockResolvedValueOnce({ pinnedAt: null, isMuted: false }).mockRejectedValueOnce({ code: 'CHAT_PIN_LIMIT' });
		await showChatConversationMenu('peer', null, changed);
		click(0);
		await vi.waitFor(() => expect(mocks.alert).toHaveBeenCalledWith({ type: 'error', text: i18n.ts._chatDaily.pinLimit }));
		expect(changed).not.toHaveBeenCalled();
		expect(mocks.refresh).not.toHaveBeenCalled();
	});
});
