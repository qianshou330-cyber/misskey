/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { NativePushProcessorService } from '@/queue/processors/NativePushProcessorService.js';
import { ChatMessageStateError } from '@/core/chat-message-state.js';
import { ApiError } from '@/server/api/error.js';
import { nativeCredentialHash, nativePushCredentials, sendNativePush } from '@/misc/native-push.js';

vi.mock('@/misc/native-push.js', async importOriginal => ({ ...await importOriginal<typeof import('@/misc/native-push.js')>(), nativePushCredentials: vi.fn(), sendNativePush: vi.fn() }));

describe('Native delivery revalidates current state before contacting APNs', () => {
	const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
	const credentials = { key, teamId: 'TESTTEAM01', keyId: 'TESTKEY001', bundleId: 'com.bolubo.native', environment: 'development' as const };
	const token = 'synthetic-runtime-only';
	let subscription: Record<string, unknown> | null;
	let account: Record<string, unknown>;
	let authorization: Record<string, unknown> | null;
	let appPermission: string[];
	let message: Record<string, unknown> | null;
	let blocked: boolean;
	let stillRegistered: boolean;
	let processor: NativePushProcessorService;
	const notify = vi.fn();
	const permission = vi.fn();
	const update = vi.fn();
	const redis = { get: vi.fn(), xrange: vi.fn() };
	const job = (kind: 'chat' | 'notification' = 'chat') => ({ data: { subscriptionId: 'subscription', userId: 'recipient', kind, eventId: 'event', apnsId: '00000000-0000-4000-8000-000000000001', createdAt: Date.now() } });

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(nativePushCredentials).mockResolvedValue(credentials);
		vi.mocked(sendNativePush).mockResolvedValue({ status: 200 });
		subscription = { id: 'subscription', userId: 'recipient', enabled: true, environment: 'development', bundleId: 'com.bolubo.native', credentialHash: nativeCredentialHash(token), deviceToken: 'aa'.repeat(32), revision: 7, accessTokenId: null };
		account = { id: 'recipient', host: null, token, isDeleted: false, isSuspended: false };
		authorization = { hash: token, permission: ['read:chat', 'read:notifications', 'write:notifications'], appId: null };
		appPermission = ['read:chat', 'read:notifications', 'write:notifications'];
		message = { id: 'event', fromUserId: 'sender', toUserId: 'recipient' };
		blocked = false; stillRegistered = true;
		notify.mockResolvedValue(true); permission.mockResolvedValue(undefined);
		redis.get.mockResolvedValue(null);
		redis.xrange.mockResolvedValue([['100-7', ['data', JSON.stringify({ id: 'event', type: 'follow', notifierId: 'sender' })]]]);
		const db = { getRepository: (entity: { name: string }) => ({
			findOneBy: async (where: { id?: string }) => {
				switch (entity.name) {
					case 'MiNativePushSubscription': return subscription;
					case 'MiUser': return where.id === 'recipient' ? account : { id: 'sender', isDeleted: false, isSuspended: false };
					case 'MiAccessToken': return authorization;
					case 'MiApp': return { permission: appPermission };
					case 'MiChatMessage': return message;
					case 'MiUserProfile': return { notificationRecieveConfig: {} };
					default: return null;
				}
			},
			existsBy: async () => entity.name === 'MiNativePushSubscription' ? stillRegistered : entity.name === 'MiBlocking' ? blocked : false,
			update,
		}) };
		processor = new NativePushProcessorService({} as never, db as never, redis as never, { canNotifyUserMessage: notify } as never, { assertCanSend: permission } as never, { parseFull: () => ({ date: 100, additional: 7n }) } as never, { isVisibleForMe: async () => true } as never);
	});

	test('valid unread chat sends only generic content after shared permission checks', async () => {
		await processor.process(job() as never);
		expect(permission).toHaveBeenCalledWith('sender', 'recipient', 'existingMessage');
		expect(sendNativePush).toHaveBeenCalledTimes(1);
		expect(vi.mocked(sendNativePush).mock.calls[0][3].aps.alert.body).toBe('你有一条新的私信');
	});
	test('default-off credentials never send', async () => {
		vi.mocked(nativePushCredentials).mockResolvedValue(null);
		await processor.process(job() as never); expect(sendNativePush).not.toHaveBeenCalled();
	});
	test('chat-only blocking or role/privacy changes caught by the shared permission gate suppress queued delivery', async () => {
		permission.mockRejectedValue(new ChatMessageStateError('RECIPIENT_UNAVAILABLE'));
		await processor.process(job() as never); expect(sendNativePush).not.toHaveBeenCalled();
	});
	test('permission infrastructure failures remain retryable before any APNs request', async () => {
		permission.mockRejectedValue(new Error('synthetic database unavailable'));
		await expect(processor.process(job() as never)).rejects.toThrow('synthetic database unavailable');
		expect(sendNativePush).not.toHaveBeenCalled();
	});
	test('the actual chat-block ApiError suppresses delivery without a retry', async () => {
		permission.mockRejectedValue(new ApiError({ message: 'Chat blocked', code: 'CHAT_BLOCKED', id: '02120c6a-1bc9-4cca-a535-e75dfda2ff33' }));
		await processor.process(job() as never);
		expect(sendNativePush).not.toHaveBeenCalled();
	});
	test('read or muted messages suppress queued delivery', async () => {
		notify.mockResolvedValue(false);
		await processor.process(job() as never); expect(sendNativePush).not.toHaveBeenCalled();
	});
	test('withdrawn messages and global blocking suppress queued delivery', async () => {
		message = null; await processor.process(job() as never);
		message = { id: 'event', fromUserId: 'sender' }; blocked = true; await processor.process(job() as never);
		expect(sendNativePush).not.toHaveBeenCalled();
	});
	test('revoked authorization and password-token changes suppress queued delivery', async () => {
		subscription!.accessTokenId = 'authorization'; authorization = null; await processor.process(job() as never);
		subscription!.accessTokenId = null; account.token = 'rotated'; await processor.process(job() as never);
		expect(sendNativePush).not.toHaveBeenCalled();
	});
	test('legacy application permissions are freshly read', async () => {
		subscription!.accessTokenId = 'authorization'; authorization!.appId = 'legacy'; appPermission = ['write:notifications'];
		await processor.process(job() as never); expect(sendNativePush).not.toHaveBeenCalled();
	});
	test('a changed registration or an old job never sends', async () => {
		stillRegistered = false; await processor.process(job() as never);
		stillRegistered = true; const old = job(); old.data.createdAt -= 301_000; await processor.process(old as never);
		expect(sendNativePush).not.toHaveBeenCalled();
	});
	test('invalid device response disables only the observed revision', async () => {
		vi.mocked(sendNativePush).mockResolvedValue({ status: 410 });
		await processor.process(job() as never);
		expect(update).toHaveBeenCalledWith({ id: 'subscription', revision: 7 }, { enabled: false });
	});
	test('temporary APNs responses fail for bounded queue retry; permanent responses terminate', async () => {
		vi.mocked(sendNativePush).mockResolvedValue({ status: 429 });
		await expect(processor.process(job() as never)).rejects.toThrow('temporarily unavailable');
		vi.mocked(sendNativePush).mockResolvedValue({ status: 403 });
		await expect(processor.process(job() as never)).rejects.toThrow('request rejected');
	});
	test('notification read sequence compares numerically and missing source records suppress delivery', async () => {
		redis.get.mockResolvedValue('100-10'); await processor.process(job('notification') as never);
		redis.get.mockResolvedValue(null); redis.xrange.mockResolvedValue([]); await processor.process(job('notification') as never);
		expect(sendNativePush).not.toHaveBeenCalled();
	});
});
