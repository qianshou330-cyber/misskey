/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ChatService } from './ChatService.js';

vi.mock('@/core/QueueService.js', () => ({ QueueService: class {} }));
vi.mock('@/core/GlobalEventService.js', () => ({ GlobalEventService: class {} }));
vi.mock('@/core/entities/UserEntityService.js', () => ({ UserEntityService: class {} }));
vi.mock('@/core/entities/ChatEntityService.js', () => ({ ChatEntityService: class {} }));
vi.mock('@/core/activitypub/ApRendererService.js', () => ({ ApRendererService: class {} }));
vi.mock('@/core/PushNotificationService.js', () => ({ PushNotificationService: class {} }));
vi.mock('@/core/UserBlockingService.js', () => ({ UserBlockingService: class {} }));
vi.mock('@/core/UserFollowingService.js', () => ({ UserFollowingService: class {} }));
vi.mock('@/core/RoleService.js', () => ({ RoleService: class {} }));
vi.mock('@/core/CustomEmojiService.js', () => ({ CustomEmojiService: class {} }));
vi.mock('@/core/NotificationService.js', () => ({ NotificationService: class {} }));
vi.mock('@/core/ModerationLogService.js', () => ({ ModerationLogService: class {} }));
vi.mock('@/core/LoggerService.js', () => ({ LoggerService: class {} }));
vi.mock('@/core/ChatAttachmentService.js', () => ({ ChatAttachmentService: class {} }));
vi.mock('@/core/ChatPermissionService.js', () => ({ ChatPermissionService: class {} }));
vi.mock('@/core/ChatConversationService.js', () => ({ ChatConversationService: class {} }));

function setup() {
	const message = { id: 'message', fromUserId: 'alice', toUserId: 'bob', readTracked: true, readAt: null as Date | null, recalledAt: null as Date | null, revision: 0, notificationSuppressed: false };
	const state = { muted: false, transaction: false };
	const repository = {
		findOneBy: vi.fn(async (where: { toUserId?: string; revision?: number; notificationSuppressed?: boolean }) => {
			expect(state.transaction).toBe(false);
			if ((where.toUserId && where.toUserId !== message.toUserId) || (where.revision != null && where.revision !== message.revision)
				|| (where.notificationSuppressed === false && message.notificationSuppressed) || message.readAt || message.recalledAt) return null;
			return { ...message };
		}),
		findOne: vi.fn(async () => ({ ...message })),
	};
	const users = { findOneBy: vi.fn(async () => ({ id: 'bob', host: null, isSuspended: false, isDeleted: false, token: 'current-session' })) };
	const packed = { id: 'message' };
	const pack = vi.fn(async () => { expect(state.transaction).toBe(false); return packed; });
	const sent = vi.fn();
	const publish = vi.fn();
	const push = vi.fn(async (_userId: string, _type: string, _body: unknown, guard?: () => Promise<boolean>) => {
		expect(state.transaction).toBe(false);
		expect(guard).toBeTypeOf('function');
		if (await guard!()) sent();
	});
	const service: ChatService = Object.create(ChatService.prototype);
	Object.assign(service, {
		chatMessagesRepository: repository,
		usersRepository: users,
		chatEntityService: { packMessageDetailed: pack },
		chatConversationService: { isMuted: vi.fn(async () => state.muted) },
		chatContactService: { withPairLock: async (_from: string, _to: string, callback: (manager: unknown) => Promise<unknown>) => {
			state.transaction = true;
			try { return await callback({ getRepository: () => repository }); } finally { state.transaction = false; }
		} },
		chatPermissionService: { assertCanSend: vi.fn(async () => { expect(state.transaction).toBe(true); }) },
		globalEventService: { publishMainStream: publish },
		pushNotificationService: { pushNotification: push },
		roleService: { getUserPolicies: async () => ({ chatAvailability: 'available' }) },
		db: { manager: {}, getRepository: () => ({ findOne: async () => null }) },
	});
	return { service, message, state, repository, users, pack, publish, sent };
}

describe('private delayed notifications', () => {
	it('never packs or sends a message durably suppressed at creation, even after unmute', async () => {
		const { service, message, pack, publish, sent } = setup();
		message.notificationSuppressed = true;
		await service.notifyUnreadUserMessage(message.id);
		expect(pack).not.toHaveBeenCalled();
		expect(publish).not.toHaveBeenCalled();
		expect(sent).not.toHaveBeenCalled();
	});

	it('suppresses current mute and performs pack and push outside the transaction pool slot', async () => {
		const { service, message, state, pack, publish, sent } = setup();
		state.muted = true;
		await service.notifyUnreadUserMessage(message.id);
		expect(pack).not.toHaveBeenCalled();
		state.muted = false;
		await service.notifyUnreadUserMessage(message.id);
		expect(publish).toHaveBeenCalledOnce();
		expect(sent).toHaveBeenCalledOnce();
	});

	it('checks a mute that commits after main publication again before actual WebPush', async () => {
		const { service, message, state, publish, sent } = setup();
		publish.mockImplementationOnce(() => { state.muted = true; message.notificationSuppressed = true; });
		await service.notifyUnreadUserMessage(message.id);
		expect(publish).toHaveBeenCalledOnce();
		expect(sent).not.toHaveBeenCalled();
		state.muted = false;
		expect(await service.canNotifyUserMessage('bob', message.id)).toBe(false);
	});

	it('rejects another recipient, recalled/read rows and changed revisions at delivery', async () => {
		const { service, message } = setup();
		expect(await service.canNotifyUserMessage('carol', message.id)).toBe(false);
		expect(await service.canNotifyUserMessage('bob', message.id, 1)).toBe(false);
		message.readAt = new Date();
		expect(await service.canNotifyUserMessage('bob', message.id)).toBe(false);
		message.readAt = null;
		message.recalledAt = new Date();
		expect(await service.canNotifyUserMessage('bob', message.id)).toBe(false);
	});

	it('continues rejecting revoked sessions and suspended recipients', async () => {
		const { service, users, message } = setup();
		expect(await service.canReadChatStream({ id: 'bob', token: 'revoked-session' })).toBe(false);
		expect(await service.canReadChatStream({ id: 'bob', token: 'current-session' }, { id: 'revoked-access-token' })).toBe(false);
		users.findOneBy.mockResolvedValueOnce({ id: 'bob', host: null, isSuspended: true, isDeleted: false, token: 'current-session' });
		expect(await service.canNotifyUserMessage('bob', message.id)).toBe(false);
	});
});
