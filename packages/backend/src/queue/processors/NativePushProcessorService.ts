/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createPublicKey } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DataSource, IsNull, MoreThan } from 'typeorm';
import * as Redis from 'ioredis';
import { UnrecoverableError } from 'bullmq';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { MiNativePushSubscription } from '@/models/NativePushSubscription.js';
import { MiUser } from '@/models/User.js';
import { MiAccessToken } from '@/models/AccessToken.js';
import { MiApp } from '@/models/App.js';
import { MiChatMessage } from '@/models/ChatMessage.js';
import { MiBlocking } from '@/models/Blocking.js';
import { MiMuting } from '@/models/Muting.js';
import { MiFollowing } from '@/models/Following.js';
import { MiUserProfile } from '@/models/UserProfile.js';
import { MiUserListMembership } from '@/models/UserListMembership.js';
import { MiNote } from '@/models/Note.js';
import { ChatService } from '@/core/ChatService.js';
import { ChatPermissionService } from '@/core/ChatPermissionService.js';
import { ChatMessageStateError } from '@/core/chat-message-state.js';
import { ApiError } from '@/server/api/error.js';
import { IdService } from '@/core/IdService.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { classifyNativePushResponse, nativeCredentialHash, nativePushCredentials, nativePushJWT, nativePushPayload, sendNativePush } from '@/misc/native-push.js';
import type { NativePushJobData } from '@/queue/types.js';
import type * as Bull from 'bullmq';

@Injectable()
export class NativePushProcessorService {
	private jwt?: { fingerprint: string; token: string; expiresAt: number };
	constructor(
		@Inject(DI.config) private config: Config,
		@Inject(DI.db) private db: DataSource,
		@Inject(DI.redis) private redisClient: Redis.Redis,
		private chatService: ChatService,
		private chatPermissionService: ChatPermissionService,
		private idService: IdService,
		private noteEntityService: NoteEntityService,
	) {}

	public async process(job: Bull.Job<NativePushJobData>): Promise<void> {
		const credentials = await nativePushCredentials(this.config.nativePush);
		if (!credentials || Date.now() - job.data.createdAt > 300_000 || job.data.createdAt > Date.now() + 60_000) return;
		const subscriptions = this.db.getRepository(MiNativePushSubscription);
		const subscription = await subscriptions.findOneBy({ id: job.data.subscriptionId, userId: job.data.userId, enabled: true, expiresAt: MoreThan(new Date()) });
		if (!subscription?.deviceToken || subscription.environment !== credentials.environment || subscription.bundleId !== credentials.bundleId) return;
		const recipient = await this.db.getRepository(MiUser).findOneBy({ id: subscription.userId });
		if (!recipient || recipient.host !== null || recipient.isDeleted || recipient.isSuspended) return;
		if (subscription.accessTokenId) {
			const token = await this.db.getRepository(MiAccessToken).findOneBy({ id: subscription.accessTokenId, userId: recipient.id });
			const kind = job.data.kind === 'chat' ? 'read:chat' : 'read:notifications';
			const permission = token?.appId ? (await this.db.getRepository(MiApp).findOneBy({ id: token.appId }))?.permission : token?.permission;
			if (!token || nativeCredentialHash(token.hash) !== subscription.credentialHash || !permission?.includes(kind) || !permission.includes('write:notifications')) return;
		} else if (!recipient.token || nativeCredentialHash(recipient.token) !== subscription.credentialHash) return;
		if (job.data.kind === 'chat') {
			const message = await this.db.getRepository(MiChatMessage).findOneBy({ id: job.data.eventId, toUserId: recipient.id, recalledAt: IsNull() });
			if (!message || !await this.senderAllowed(recipient.id, message.fromUserId) || !await this.chatService.canNotifyUserMessage(recipient.id, message.id)) return;
			try { await this.chatPermissionService.assertCanSend(message.fromUserId, recipient.id, 'existingMessage'); } catch (error) {
				if (error instanceof ChatMessageStateError || (error instanceof ApiError && error.code === 'CHAT_BLOCKED')) return;
				throw error;
			}
		} else if (!await this.notificationAllowed(recipient.id, job.data.eventId)) return;
		// A re-registration replaces the row. Drop queued alerts bound to the old account or authorization.
		if (!await subscriptions.existsBy({ id: subscription.id, revision: subscription.revision, enabled: true, userId: recipient.id, credentialHash: subscription.credentialHash })) return;
		const fingerprint = nativeCredentialHash(createPublicKey(credentials.key).export({ type: 'spki', format: 'pem' }).toString() + credentials.keyId + credentials.teamId);
		if (!this.jwt || this.jwt.fingerprint !== fingerprint || this.jwt.expiresAt <= Date.now()) {
			this.jwt = { fingerprint, token: nativePushJWT(credentials), expiresAt: Date.now() + 45 * 60_000 };
		}
		const response = await sendNativePush(credentials, this.jwt.token, subscription.deviceToken, nativePushPayload(job.data.kind, recipient.id, job.data.eventId), job.data.apnsId);
		switch (classifyNativePushResponse(response)) {
			case 'accepted': return;
			case 'invalid-device': await subscriptions.update({ id: subscription.id, revision: subscription.revision }, { enabled: false }); return;
			case 'retry': throw new Error('Native push temporarily unavailable');
			case 'reject': throw new UnrecoverableError('Native push request rejected');
		}
	}

	private async senderAllowed(recipientId: string, senderId: string): Promise<boolean> {
		const sender = await this.db.getRepository(MiUser).findOneBy({ id: senderId });
		if (!sender || sender.isDeleted || sender.isSuspended) return false;
		if (await this.db.getRepository(MiBlocking).existsBy([{ blockerId: recipientId, blockeeId: senderId }, { blockerId: senderId, blockeeId: recipientId }])) return false;
		if (await this.db.getRepository(MiMuting).existsBy([{ muterId: recipientId, muteeId: senderId, expiresAt: IsNull() }, { muterId: recipientId, muteeId: senderId, expiresAt: MoreThan(new Date()) }])) return false;
		return true;
	}

	private async notificationAllowed(userId: string, eventId: string): Promise<boolean> {
		const { date, additional } = this.idService.parseFull(eventId);
		const redisId = `${date}-${BigInt.asUintN(64, additional)}`;
		const readId = await this.redisClient.get(`latestReadNotification:${userId}`);
		if (readId) {
			const [readDate, readSequence] = readId.split('-').map(BigInt);
			const [eventDate, eventSequence] = redisId.split('-').map(BigInt);
			if (readDate > eventDate || (readDate === eventDate && readSequence >= eventSequence)) return false;
		}
		const rows = await this.redisClient.xrange(`notificationTimeline:${userId}`, redisId, redisId, 'COUNT', 1);
		const fields = rows[0]?.[1];
		if (!fields) return false;
		const index = fields.indexOf('data');
		if (index < 0) return false;
		const notification = JSON.parse(fields[index + 1]) as { id?: string; type?: string; notifierId?: string; noteId?: string };
		if (notification.id !== eventId || !notification.type) return false;
		const profile = await this.db.getRepository(MiUserProfile).findOneBy({ userId });
		if (!profile) return false;
		const setting = (profile.notificationRecieveConfig as Record<string, { type: string; userListId?: string } | undefined>)[notification.type];
		if (setting?.type === 'never') return false;
		if (notification.notifierId) {
			const senderId = notification.notifierId;
			if (!await this.senderAllowed(userId, senderId)) return false;
			if (setting && !['all', 'never'].includes(setting.type)) {
				const following = await this.db.getRepository(MiFollowing).existsBy({ followerId: userId, followeeId: senderId });
				const follower = await this.db.getRepository(MiFollowing).existsBy({ followerId: senderId, followeeId: userId });
				switch (setting.type) {
					case 'following': if (!following) return false; break;
					case 'follower': if (!follower) return false; break;
					case 'mutualFollow': if (!following || !follower) return false; break;
					case 'followingOrFollower': if (!following && !follower) return false; break;
					case 'list': if (!setting.userListId || !await this.db.getRepository(MiUserListMembership).existsBy({ userId: senderId, userListId: setting.userListId })) return false; break;
					default: return false;
				}
			}
		}
		if (notification.noteId) {
			const note = await this.db.getRepository(MiNote).findOneBy({ id: notification.noteId });
			if (!note || !await this.noteEntityService.isVisibleForMe(note, userId)) return false;
		}
		return true;
	}
}
