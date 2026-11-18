/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { MiChatConversationSetting } from '@/models/ChatConversationSetting.js';
import { MiChatMessage } from '@/models/ChatMessage.js';
import { MiUser } from '@/models/User.js';
import { ChatConversationService } from './ChatConversationService.js';

vi.mock('@/core/ChatContactService.js', () => ({ ChatContactService: class {} }));
vi.mock('@/core/GlobalEventService.js', () => ({ GlobalEventService: class {} }));

function setup(pinnedCount = 0) {
	const rows = new Map<string, { userId: string; otherId: string; pinnedAt: Date | null; isMuted: boolean }>();
	const settings = {
		findOneBy: vi.fn(async ({ userId, otherId }: { userId: string; otherId: string }) => rows.get(`${userId}/${otherId}`)),
		existsBy: vi.fn(async ({ userId, otherId }: { userId: string; otherId: string }) => rows.get(`${userId}/${otherId}`)?.isMuted ?? false),
		countBy: vi.fn(async () => pinnedCount),
		upsert: vi.fn(async (row: { userId: string; otherId: string; pinnedAt: Date | null; isMuted: boolean }) => { rows.set(`${row.userId}/${row.otherId}`, row); }),
	};
	const messages = { existsBy: vi.fn(async () => true), update: vi.fn(async () => {}) };
	const users = { existsBy: vi.fn(async () => true) };
	const manager = { query: vi.fn(async () => []), getRepository: (model: unknown) => model === MiChatConversationSetting ? settings : model === MiChatMessage ? messages : model === MiUser ? users : undefined };
	const events = { publishMainStream: vi.fn() };
	const contacts = { withPairLock: vi.fn(async (_userId: string, _otherId: string, callback: (manager: unknown) => unknown) => callback(manager)) };
	const service = new ChatConversationService(...[{ manager }, contacts, events] as unknown as ConstructorParameters<typeof ChatConversationService>);
	return { service, rows, settings, messages, users, manager, events };
}

describe('private conversation settings', () => {
	it('uses one owner lock for pins across peers and refuses the eleventh before writing', async () => {
		const { service, manager, settings } = setup(10);
		await expect(service.update('alice', 'bob', { pinned: true })).rejects.toMatchObject({ code: 'CHAT_PIN_LIMIT' });
		expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), ['chat-conversation-settings', 'alice']);
		expect(settings.upsert).not.toHaveBeenCalled();
	});

	it('rejects pinning an empty conversation and never exposes a peer preference', async () => {
		const { service, messages, rows } = setup();
		messages.existsBy.mockResolvedValueOnce(false);
		await expect(service.update('alice', 'bob', { pinned: true })).rejects.toMatchObject({ code: 'NO_SUCH_CHAT_CONVERSATION' });
		rows.set('bob/alice', { userId: 'bob', otherId: 'alice', pinnedAt: new Date(), isMuted: true });
		expect(await service.get('alice', 'bob')).toEqual({ pinnedAt: null, isMuted: false });
	});

	it('keeps a repeated pin stable at the limit and unpins without clearing mute', async () => {
		const { service, rows, settings } = setup(10);
		const pinnedAt = new Date('2026-10-22T00:00:00Z');
		rows.set('alice/bob', { userId: 'alice', otherId: 'bob', pinnedAt, isMuted: true });
		expect(await service.update('alice', 'bob', { pinned: true })).toEqual({ pinnedAt: pinnedAt.toISOString(), isMuted: true });
		expect(settings.countBy).not.toHaveBeenCalled();
		expect(await service.update('alice', 'bob', { pinned: false })).toEqual({ pinnedAt: null, isMuted: true });
	});

	it('permanently suppresses delayed unread notifications on mute and only invalidates the owner', async () => {
		const { service, messages, events } = setup();
		await service.update('alice', 'bob', { isMuted: true });
		expect(messages.update).toHaveBeenCalledWith(expect.objectContaining({ fromUserId: 'bob', toUserId: 'alice', notificationSuppressed: false }), { notificationSuppressed: true });
		await service.update('alice', 'bob', { isMuted: false });
		expect(messages.update).toHaveBeenCalledTimes(1);
		expect(events.publishMainStream.mock.calls).toEqual([
			['alice', 'chatStateChanged', { userId: 'bob' }], ['alice', 'chatStateChanged', { userId: 'bob' }],
		]);
	});
});
