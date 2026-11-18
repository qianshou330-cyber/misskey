/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ api: vi.fn(), account: { id: 'owner', policies: { chatAvailability: 'available' } }, update: vi.fn() }));
vi.mock('@/utility/chat-api.js', () => ({ chatApi: mocks.api }));
vi.mock('@/i.js', () => ({ $i: mocks.account }));
vi.mock('@/accounts.js', () => ({ updateCurrentAccountPartial: mocks.update }));

beforeEach(() => { vi.resetModules(); mocks.api.mockReset(); mocks.update.mockReset(); mocks.account.id = 'owner'; });

describe('mute-aware private chat badge', () => {
	test('raw unread and profile state never make muted conversations show a total badge', async () => {
		mocks.api.mockResolvedValue({ unreadCount: 7, hasLegacyUnread: true, notificationUnreadCount: 0, hasNotificationLegacyUnread: false, hasUnreadRoom: false });
		const summary = await import('@/utility/chat-summary.js');
		expect(summary.chatHasNotificationUnread.value).toBe(false);
		await summary.refreshChatSummary();
		expect(summary.chatUnreadCount.value).toBe(0);
		expect(summary.chatHasNotificationUnread.value).toBe(false);
	});
	test('room and unmuted legacy signals keep an indicator without inventing numeric counts', async () => {
		mocks.api.mockResolvedValue({ unreadCount: 7, hasLegacyUnread: true, notificationUnreadCount: 0, hasNotificationLegacyUnread: true, hasUnreadRoom: false });
		const summary = await import('@/utility/chat-summary.js');
		await summary.refreshChatSummary();
		expect(summary.chatHasNotificationUnread.value).toBe(true);
		expect(summary.chatUnreadCount.value).toBe(0);
		mocks.api.mockResolvedValue({ unreadCount: 7, hasLegacyUnread: false, notificationUnreadCount: 2, hasNotificationLegacyUnread: false, hasUnreadRoom: true });
		await summary.refreshChatSummary();
		expect(summary.chatUnreadCount.value).toBe(2);
	});
	test('a late previous-account response cannot change the current account badge', async () => {
		let resolve!: (value: unknown) => void;
		mocks.api.mockImplementation(() => new Promise(done => { resolve = done; }));
		const summary = await import('@/utility/chat-summary.js');
		const pending = summary.refreshChatSummary();
		mocks.account.id = 'another';
		resolve({ notificationUnreadCount: 8, hasNotificationLegacyUnread: false, hasUnreadRoom: false });
		await pending;
		expect(summary.chatUnreadCount.value).toBeNull();
		expect(mocks.update).not.toHaveBeenCalled();
	});
});
