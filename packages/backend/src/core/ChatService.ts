/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import { Brackets, In, IsNull } from 'typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { QueueService } from '@/core/QueueService.js';
import { IdService } from '@/core/IdService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { ChatEntityService } from '@/core/entities/ChatEntityService.js';
import { ApRendererService } from '@/core/activitypub/ApRendererService.js';
import { PushNotificationService } from '@/core/PushNotificationService.js';
import { bindThis } from '@/decorators.js';
import type { ChatApprovalsRepository, ChatMessagesRepository, ChatRoomInvitationsRepository, ChatRoomMembershipsRepository, ChatRoomsRepository, MiChatRoom, MiChatRoomMembership, MiDriveFile, MiUser, MutingsRepository, UsersRepository } from '@/models/_.js';
import { MiChatMessage } from '@/models/ChatMessage.js';
import { MiChatApproval } from '@/models/ChatApproval.js';
import { MiChatLegacyUnread } from '@/models/ChatLegacyUnread.js';
import { MiChatAttachment } from '@/models/ChatAttachment.js';
import { MiAccessToken } from '@/models/AccessToken.js';
import { ChatContactService } from '@/core/ChatContactService.js';
import { assertChatMessageEditable, chatMessageFingerprint, ChatMessageStateError } from '@/core/chat-message-state.js';
import { UserBlockingService } from '@/core/UserBlockingService.js';
import { QueryService } from '@/core/QueryService.js';
import { RoleService } from '@/core/RoleService.js';
import { UserFollowingService } from '@/core/UserFollowingService.js';
import { MiChatRoomInvitation } from '@/models/ChatRoomInvitation.js';
import { Packed } from '@/misc/json-schema.js';
import { sqlLikeEscape } from '@/misc/sql-like-escape.js';
import { CustomEmojiService } from '@/core/CustomEmojiService.js';
import { emojiRegex } from '@/misc/emoji-regex.js';
import { NotificationService } from '@/core/NotificationService.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { ChatAttachmentService } from '@/core/ChatAttachmentService.js';
import { ChatPermissionService } from '@/core/ChatPermissionService.js';
import { ChatConversationService } from '@/core/ChatConversationService.js';
import { samePrivateConversation } from '@/core/chat-reply.js';

export class ChatMessageAccessError extends Error {}

const MAX_ROOM_MEMBERS = 50;
const MAX_REACTIONS_PER_MESSAGE = 100;
const isCustomEmojiRegexp = /^:([\w+-]+)(?:@\.)?:$/;

// TODO: ReactionServiceのやつと共通化
function normalizeEmojiString(x: string) {
	const match = emojiRegex.exec(x);
	if (match) {
		// 合字を含む1つの絵文字
		const unicode = match[0];

		// 異体字セレクタ除去
		return unicode.match('\u200d') ? unicode : unicode.replace(/\ufe0f/g, '');
	} else {
		throw new Error('invalid emoji');
	}
}

@Injectable()
export class ChatService {
	constructor(
		@Inject(DI.db)
		private db: DataSource,

		@Inject(DI.config)
		private config: Config,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.chatMessagesRepository)
		private chatMessagesRepository: ChatMessagesRepository,

		@Inject(DI.chatApprovalsRepository)
		private chatApprovalsRepository: ChatApprovalsRepository,

		@Inject(DI.chatRoomsRepository)
		private chatRoomsRepository: ChatRoomsRepository,

		@Inject(DI.chatRoomInvitationsRepository)
		private chatRoomInvitationsRepository: ChatRoomInvitationsRepository,

		@Inject(DI.chatRoomMembershipsRepository)
		private chatRoomMembershipsRepository: ChatRoomMembershipsRepository,

		@Inject(DI.mutingsRepository)
		private mutingsRepository: MutingsRepository,

		private userEntityService: UserEntityService,
		private chatEntityService: ChatEntityService,
		private idService: IdService,
		private globalEventService: GlobalEventService,
		private apRendererService: ApRendererService,
		private queueService: QueueService,
		private pushNotificationService: PushNotificationService,
		private notificationService: NotificationService,
		private userBlockingService: UserBlockingService,
		private queryService: QueryService,
		private roleService: RoleService,
		private userFollowingService: UserFollowingService,
		private customEmojiService: CustomEmojiService,
		private moderationLogService: ModerationLogService,
		private chatContactService: ChatContactService,
		private loggerService: LoggerService,
		private chatAttachmentService: ChatAttachmentService,
		private chatPermissionService: ChatPermissionService,
		private chatConversationService: ChatConversationService,
	) {
	}

	@bindThis
	public async getChatAvailability(userId: MiUser['id']): Promise<{ read: boolean; write: boolean; }> {
		const policies = await this.roleService.getUserPolicies(userId, this.db.manager);

		switch (policies.chatAvailability) {
			case 'available':
				return {
					read: true,
					write: true,
				};
			case 'readonly':
				return {
					read: true,
					write: false,
				};
			case 'unavailable':
				return {
					read: false,
					write: false,
				};
			default:
				throw new Error('invalid chat availability (unreachable)');
		}
	}

	/** getChatAvailabilityの糖衣。主にAPI呼び出し時に走らせて、権限的に問題ない場合はそのまま続行する */
	@bindThis
	public async checkChatAvailability(userId: MiUser['id'], permission: 'read' | 'write') {
		const policy = await this.getChatAvailability(userId);
		if (policy[permission] === false) {
			throw new Error('ROLE_PERMISSION_DENIED');
		}
	}

	/** Recheck Chat sessions without changing Misskey's shared authentication flow. */
	@bindThis
	public async canUseChatSession(sessionUser: Pick<MiUser, 'id' | 'token'>, sessionToken: Pick<MiAccessToken, 'id'> | undefined, requiredScope: 'read:chat' | 'write:chat'): Promise<boolean> {
		const user = await this.usersRepository.findOneBy({ id: sessionUser.id });
		if (!user || user.host != null || user.isSuspended || user.isDeleted) return false;
		if (sessionToken) {
			const token = await this.db.getRepository(MiAccessToken).findOne({ where: { id: sessionToken.id, userId: user.id }, relations: { app: true } });
			const permissions = token?.appId ? token.app?.permission : token?.permission;
			if (!permissions?.includes(requiredScope)) return false;
		} else if (!user.token || user.token !== sessionUser.token) {
			return false;
		}
		return true;
	}

	/** Streams additionally require the current role to allow reading Chat. */
	@bindThis
	public async canReadChatStream(sessionUser: Pick<MiUser, 'id' | 'token'>, sessionToken?: Pick<MiAccessToken, 'id'>): Promise<boolean> {
		return await this.canUseChatSession(sessionUser, sessionToken, 'read:chat') && (await this.getChatAvailability(sessionUser.id)).read;
	}

	@bindThis
	public async createMessageToUser(fromUser: { id: MiUser['id']; host: MiUser['host']; }, toUser: MiUser, params: {
		text?: string | null;
		file?: MiDriveFile | null;
		uri?: string | null;
		clientMessageId?: string;
		attachmentIds?: string[];
		replyToId?: string | null;
		bindAttachments?: (manager: EntityManager, messageId: string) => Promise<void>;
	}): Promise<Packed<'ChatMessageLiteFor1on1'>> {
		if (fromUser.id === toUser.id) throw new ChatMessageStateError('RECIPIENT_UNAVAILABLE');
		if (fromUser.host != null || toUser.host != null) throw new ChatMessageStateError('RECIPIENT_UNAVAILABLE');
		const text = params.text?.trim() || null;
		if (text == null && params.file == null && !params.attachmentIds?.length) throw new ChatMessageStateError('CONTENT_REQUIRED');
		if ((params.file || params.attachmentIds?.length) && !params.bindAttachments) throw new ChatMessageStateError('ATTACHMENTS_UNAVAILABLE');
		const fingerprint = chatMessageFingerprint(toUser.id, { text, fileId: params.file?.id, attachmentIds: params.attachmentIds, replyToId: params.replyToId });
		const result = await this.chatContactService.withPairLock(fromUser.id, toUser.id, async manager => {
			// The nonce lock also serializes reuse of one nonce for different recipients.
			if (params.clientMessageId) {
				await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['chat-nonce:' + fromUser.id + ':' + params.clientMessageId]);
				const existing = await manager.getRepository(MiChatMessage).findOneBy({ fromUserId: fromUser.id, clientMessageId: params.clientMessageId });
				if (existing) {
					if (existing.requestFingerprint !== fingerprint) throw new ChatMessageStateError('IDEMPOTENCY_CONFLICT');
					return { message: existing, created: false };
				}
			}
			await this.chatPermissionService.assertCanSend(fromUser.id, toUser.id, params.file || params.attachmentIds?.length ? 'attachment' : 'newMessage', manager);
			if (params.replyToId) {
				const target = await manager.getRepository(MiChatMessage).findOneBy({ id: params.replyToId });
				if (!target || target.recalledAt || !samePrivateConversation(target, fromUser.id, toUser.id)) {
					throw new ChatMessageStateError('REPLY_TARGET_UNAVAILABLE');
				}
			}
			const notificationSuppressed = await this.chatConversationService.isMuted(toUser.id, fromUser.id, manager);
			const message = await manager.getRepository(MiChatMessage).save({
				id: this.idService.gen(), fromUserId: fromUser.id, toUserId: toUser.id,
				text, fileId: null, reads: [], uri: params.uri ?? null,
				clientMessageId: params.clientMessageId ?? null, requestFingerprint: fingerprint,
				readTracked: true, readAt: null, revision: 0, editedAt: null, recalledAt: null,
				replyToId: params.replyToId ?? null, notificationSuppressed,
			});
			await params.bindAttachments?.(manager, message.id);
			await manager.getRepository(MiChatApproval).createQueryBuilder().insert().values({
				id: this.idService.gen(), userId: fromUser.id, otherId: toUser.id,
			}).orIgnore().execute();
			return { message, created: true };
		});
		const packedMessage = await this.chatEntityService.packMessageLiteFor1on1(result.message);
		if (!result.created) return packedMessage;
		// withPairLock resolves only after COMMIT. No message is broadcast from inside it.
		this.globalEventService.publishChatUserStream(fromUser.id, toUser.id, 'message', packedMessage);
		this.globalEventService.publishChatUserStream(toUser.id, fromUser.id, 'message', packedMessage);
		this.invalidateUserConversation(fromUser.id, toUser.id);
		setTimeout(() => {
			void this.notifyUnreadUserMessage(result.message.id).catch(() => {
				this.loggerService.getLogger('chat').warn('Could not send delayed chat notification');
			});
		}, 3000);
		return packedMessage;
	}
	@bindThis
	public async findIdempotentUserMessage(fromUserId: string, toUserId: string, clientMessageId: string, params: { text?: string | null; fileId?: string | null; attachmentIds?: string[]; replyToId?: string | null }) {
		const existing = await this.chatMessagesRepository.findOneBy({ fromUserId, clientMessageId });
		if (!existing) return null;
		if (existing.requestFingerprint !== chatMessageFingerprint(toUserId, params)) throw new ChatMessageStateError('IDEMPOTENCY_CONFLICT');
		return this.chatEntityService.packMessageLiteFor1on1(existing);
	}

	@bindThis
	public invalidateUserConversation(userId: string, otherId: string): void {
		this.globalEventService.publishMainStream(userId, 'chatStateChanged', { userId: otherId });
		this.globalEventService.publishMainStream(otherId, 'chatStateChanged', { userId });
	}

	@bindThis
	public async notifyUnreadUserMessage(messageId: string): Promise<void> {
		const current = await this.chatMessagesRepository.findOneBy({ id: messageId, readTracked: true, readAt: IsNull(), recalledAt: IsNull() });
		if (!current?.toUserId || current.notificationSuppressed || await this.chatConversationService.isMuted(current.toUserId, current.fromUserId)) return;
		const toUser = await this.usersRepository.findOneBy({ id: current.toUserId });
		if (!toUser || toUser.host != null) return;
		// Serialization and push subscriptions use ordinary repositories. Do not hold
		// a transaction connection while they might need another pool connection.
		const packed = await this.chatEntityService.packMessageDetailed(current, toUser);
		const ready = await this.chatContactService.withPairLock(current.fromUserId, current.toUserId, async manager => {
			// The row lock also orders explicit read-all, which intentionally updates
			// a single statement snapshot rather than acquiring every pair lock.
			const latest = await manager.getRepository(MiChatMessage).findOne({
				where: { id: messageId, readAt: IsNull(), recalledAt: IsNull() }, lock: { mode: 'pessimistic_write' },
			});
			if (!latest || latest.notificationSuppressed || latest.revision !== current.revision) return false;
			if (await this.chatConversationService.isMuted(current.toUserId!, current.fromUserId, manager)) return false;
			await this.chatPermissionService.assertCanSend(current.fromUserId, current.toUserId!, 'existingMessage', manager);
			return true;
		});
		if (!ready || !await this.canNotifyUserMessage(toUser.id, messageId, current.revision)) return;
		this.globalEventService.publishMainStream(toUser.id, 'newChatMessage', packed);
		await this.pushNotificationService.pushNotification(toUser.id, 'newChatMessage', packed, () => this.canNotifyUserMessage(toUser.id, messageId, current.revision));
	}

	/** Rechecked at both the stream and push delivery boundaries, outside transactions. */
	@bindThis
	public async canNotifyUserMessage(userId: string, messageId: string, revision?: number): Promise<boolean> {
		const message = await this.chatMessagesRepository.findOneBy({
			id: messageId, toUserId: userId, readTracked: true, readAt: IsNull(), recalledAt: IsNull(), notificationSuppressed: false,
			...(revision == null ? {} : { revision }),
		});
		if (!message || await this.chatConversationService.isMuted(userId, message.fromUserId)) return false;
		const user = await this.usersRepository.findOneBy({ id: userId });
		return Boolean(user && user.host == null && !user.isSuspended && !user.isDeleted && (await this.getChatAvailability(userId)).read);
	}

	@bindThis
	public async createMessageToRoom(fromUser: { id: MiUser['id']; host: MiUser['host']; }, toRoom: MiChatRoom, params: {
		text?: string | null;
		file?: MiDriveFile | null;
		uri?: string | null;
	}): Promise<Packed<'ChatMessageLiteForRoom'>> {
		const memberships = (await this.chatRoomMembershipsRepository.findBy({ roomId: toRoom.id })).map(m => ({
			userId: m.userId,
			isMuted: m.isMuted,
		})).concat({ // ownerはmembershipレコードを作らないため
			userId: toRoom.ownerId,
			isMuted: false,
		});

		if (!memberships.some(member => member.userId === fromUser.id)) {
			throw new Error('you are not a member of the room');
		}

		const membershipsOtherThanMe = memberships.filter(member => member.userId !== fromUser.id);

		const message = {
			id: this.idService.gen(),
			fromUserId: fromUser.id,
			toRoomId: toRoom.id,
			text: params.text ? params.text.trim() : null,
			fileId: params.file ? params.file.id : null,
			reads: [],
			uri: params.uri ?? null,
		} satisfies Partial<MiChatMessage>;

		const inserted = await this.chatMessagesRepository.insertOne(message);

		const packedMessage = await this.chatEntityService.packMessageLiteForRoom(inserted);

		this.globalEventService.publishChatRoomStream(toRoom.id, 'message', packedMessage);

		const redisPipeline = this.redisClient.pipeline();
		for (const membership of membershipsOtherThanMe) {
			if (membership.isMuted) continue;

			redisPipeline.set(`newRoomChatMessageExists:${membership.userId}:${toRoom.id}`, message.id);
			redisPipeline.sadd(`newChatMessagesExists:${membership.userId}`, `room:${toRoom.id}`);
		}
		redisPipeline.exec();

		// 3秒経っても既読にならなかったらイベント発行
		setTimeout(async () => {
			const redisPipeline = this.redisClient.pipeline();
			for (const membership of membershipsOtherThanMe) {
				redisPipeline.get(`newRoomChatMessageExists:${membership.userId}:${toRoom.id}`);
			}
			const markers = await redisPipeline.exec();
			if (markers == null) throw new Error('redis error');

			if (markers.every(marker => marker[1] == null)) return;

			const packedMessageForTo = await this.chatEntityService.packMessageDetailed(inserted);

			for (let i = 0; i < membershipsOtherThanMe.length; i++) {
				const marker = markers[i][1];
				if (marker == null) continue;

				this.globalEventService.publishMainStream(membershipsOtherThanMe[i].userId, 'newChatMessage', packedMessageForTo);
				this.pushNotificationService.pushNotification(membershipsOtherThanMe[i].userId, 'newChatMessage', packedMessageForTo);
			}
		}, 3000);

		return packedMessage;
	}

	/** Import legacy notification state once; it is not evidence of message reading. */
	@bindThis
	public async importLegacyUserReadState(userId: string, otherId: string): Promise<MiChatLegacyUnread> {
		const repository = this.db.getRepository(MiChatLegacyUnread);
		const existing = await repository.findOneBy({ userId, otherId });
		if (existing) return existing;
		if (!await this.usersRepository.existsBy({ id: otherId })) {
			return repository.create({ userId, otherId, hasUnread: false, messageId: null });
		}
		const marker = await this.redisClient.get('newUserChatMessageExists:' + userId + ':' + otherId);
		await repository.createQueryBuilder().insert().values({ userId, otherId, hasUnread: marker != null, messageId: marker }).orIgnore().execute();
		return repository.findOneByOrFail({ userId, otherId });
	}

	/** Compatibility for old WebSocket clients: never generates a real read receipt. */
	@bindThis
	public async readUserChatMessage(readerId: string, senderId: string): Promise<void> {
		if (!await this.chatMessagesRepository.existsBy([
			{ fromUserId: senderId, toUserId: readerId }, { fromUserId: readerId, toUserId: senderId },
		])) return;
		await this.chatContactService.withPairLock(readerId, senderId, async manager => {
			await manager.getRepository(MiChatLegacyUnread).upsert({ userId: readerId, otherId: senderId, hasUnread: false }, ['userId', 'otherId']);
		});
		await this.redisClient.pipeline()
			.del('newUserChatMessageExists:' + readerId + ':' + senderId)
			.srem('newChatMessagesExists:' + readerId, 'user:' + senderId).exec();
		this.invalidateUserConversation(readerId, senderId);
	}

	@bindThis
	public async readUserMessages(readerId: string, senderId: string, messageIds: string[]) {
		if (messageIds.length === 0 || messageIds.length > 100) throw new ChatMessageAccessError('invalid message IDs');
		await this.checkChatAvailability(readerId, 'read');
		if (!await this.chatMessagesRepository.existsBy({ fromUserId: senderId, toUserId: readerId })) return [];
		const legacy = await this.importLegacyUserReadState(readerId, senderId);
		const messages = await this.chatContactService.withPairLock(readerId, senderId, async manager => {
			const repository = manager.getRepository(MiChatMessage);
			await repository.createQueryBuilder().update().set({
				readTracked: true, readAt: () => 'CURRENT_TIMESTAMP',
			}).where('id IN (:...ids)', { ids: messageIds })
				.andWhere('"toUserId" = :readerId AND "fromUserId" = :senderId', { readerId, senderId })
				.andWhere('"readAt" IS NULL AND "recalledAt" IS NULL').execute();
			if (legacy.messageId && messageIds.includes(legacy.messageId)) {
				await manager.getRepository(MiChatLegacyUnread).update({ userId: readerId, otherId: senderId }, { hasUnread: false });
			}
			return repository.findBy({ id: In(messageIds), fromUserId: senderId, toUserId: readerId });
		});
		const packed = await this.chatEntityService.packMessagesLiteFor1on1(messages);
		if (packed.length > 0) {
			this.globalEventService.publishChatUserStream(readerId, senderId, 'read', { messages: packed });
			this.globalEventService.publishChatUserStream(senderId, readerId, 'read', { messages: packed });
			this.invalidateUserConversation(readerId, senderId);
		}
		return packed;
	}

	@bindThis
	public async readRoomChatMessage(
		readerId: MiUser['id'],
		roomId: MiChatRoom['id'],
	): Promise<void> {
		const redisPipeline = this.redisClient.pipeline();
		redisPipeline.del(`newRoomChatMessageExists:${readerId}:${roomId}`);
		redisPipeline.srem(`newChatMessagesExists:${readerId}`, `room:${roomId}`);
		await redisPipeline.exec();
	}

	@bindThis
	public async readAllChatMessages(readerId: string): Promise<void> {
		// Freeze the tracked-message set in one UPDATE statement snapshot. Old messages
		// are deliberately excluded: clearing a legacy badge must not invent readAt.
		const result = await this.chatMessagesRepository.createQueryBuilder().update().set({
			readAt: () => 'CURRENT_TIMESTAMP',
		}).where('"toUserId" = :readerId AND "readTracked" = true AND "readAt" IS NULL AND "recalledAt" IS NULL', { readerId })
			.returning(['id', 'fromUserId']).execute();
		const changed = result.raw as { id: string; fromUserId: string }[];
		const legacyPeers = await this.chatMessagesRepository.createQueryBuilder('message')
			.select('message.fromUserId', 'userId').distinct(true)
			.where('message.toUserId = :readerId AND message.readTracked = false', { readerId }).getRawMany<{ userId: string }>();
		const repository = this.db.getRepository(MiChatLegacyUnread);
		for (const peer of legacyPeers) {
			await repository.upsert({ userId: readerId, otherId: peer.userId, hasUnread: false }, ['userId', 'otherId']);
			await this.redisClient.del('newUserChatMessageExists:' + readerId + ':' + peer.userId);
		}
		await repository.update({ userId: readerId }, { hasUnread: false });
		// Keep the native room clear operation; user flags are legacy-only after cutover.
		const markers = await this.redisClient.smembers('newChatMessagesExists:' + readerId);
		const pipeline = this.redisClient.pipeline();
		for (const marker of markers) {
			if (marker.startsWith('room:')) pipeline.del('newRoomChatMessageExists:' + readerId + ':' + marker.slice(5));
		}
		pipeline.del('newChatMessagesExists:' + readerId);
		await pipeline.exec();
		for (const senderId of new Set(changed.map(message => message.fromUserId))) {
			const ids = changed.filter(message => message.fromUserId === senderId).map(message => message.id);
			for (let offset = 0; offset < ids.length; offset += 100) {
				const messages = await this.chatEntityService.packMessagesLiteFor1on1(await this.chatMessagesRepository.findBy({ id: In(ids.slice(offset, offset + 100)) }));
				this.globalEventService.publishChatUserStream(readerId, senderId, 'read', { messages });
				this.globalEventService.publishChatUserStream(senderId, readerId, 'read', { messages });
			}
			this.invalidateUserConversation(readerId, senderId);
		}
		this.globalEventService.publishMainStream(readerId, 'chatStateChanged', { userId: null });
	}

	@bindThis
	public findMessageById(messageId: MiChatMessage['id']) {
		return this.chatMessagesRepository.findOneBy({ id: messageId });
	}

	@bindThis
	public findMyMessageById(userId: MiUser['id'], messageId: MiChatMessage['id']) {
		return this.chatMessagesRepository.findOneBy({ id: messageId, fromUserId: userId });
	}

	@bindThis
	public async hasPermissionToViewRoomTimeline(meId: MiUser['id'], room: MiChatRoom) {
		if (await this.isRoomMember(room, meId)) {
			return true;
		} else {
			const iAmModerator = await this.roleService.isModerator({ id: meId });
			if (iAmModerator) {
				return true;
			}

			return false;
		}
	}

	@bindThis
	public async deleteMessage(message: MiChatMessage) {
		if (message.toUserId == null) {
			// Preserve native group semantics; this phase only enhances one-to-one chat.
			await this.chatMessagesRepository.delete(message.id);
			if (message.toRoomId) this.globalEventService.publishChatRoomStream(message.toRoomId, 'deleted', message.id);
			return;
		}
		const recalled = await this.chatContactService.withPairLock(message.fromUserId, message.toUserId, async manager => {
			const repository = manager.getRepository(MiChatMessage);
			const current = await repository.findOneBy({ id: message.id, fromUserId: message.fromUserId });
			if (!current) throw new ChatMessageAccessError('no such message');
			if (current.recalledAt) return current;
			await repository.createQueryBuilder().update().set({
				text: null, fileId: null, reactions: [], recalledAt: () => 'CURRENT_TIMESTAMP', revision: () => '"revision" + 1',
			}).where('id = :id AND "fromUserId" = :userId', { id: current.id, userId: message.fromUserId }).execute();
			await this.chatAttachmentService.revokeMessage(manager, current.id);
			return repository.findOneByOrFail({ id: current.id });
		});
		const packed = await this.chatEntityService.packMessageLiteFor1on1(recalled);
		this.globalEventService.publishChatUserStream(message.fromUserId, message.toUserId, 'deleted', message.id);
		this.globalEventService.publishChatUserStream(message.toUserId, message.fromUserId, 'deleted', message.id);
		this.globalEventService.publishChatUserStream(message.fromUserId, message.toUserId, 'recalled', packed);
		this.globalEventService.publishChatUserStream(message.toUserId, message.fromUserId, 'recalled', packed);
		this.invalidateUserConversation(message.fromUserId, message.toUserId);
	}

	@bindThis
	public async updateUserMessage(userId: string, messageId: string, text: string, expectedRevision: number) {
		const original = await this.findMyMessageById(userId, messageId);
		if (!original?.toUserId) throw new ChatMessageAccessError('no such message');
		const normalized = text.trim();
		if (!normalized) throw new ChatMessageStateError('CONTENT_REQUIRED');
		const updated = await this.chatContactService.withPairLock(userId, original.toUserId, async manager => {
			const repository = manager.getRepository(MiChatMessage);
			const current = await repository.findOneBy({ id: messageId, fromUserId: userId });
			if (!current) throw new ChatMessageAccessError('no such message');
			assertChatMessageEditable(current, expectedRevision, this.idService.parse(current.id).date);
			if (await manager.getRepository(MiChatAttachment).existsBy({ messageId: current.id })) throw new ChatMessageStateError('MESSAGE_NOT_EDITABLE');
			await this.chatPermissionService.assertCanSend(userId, original.toUserId!, 'existingMessage', manager);
			const result = await repository.createQueryBuilder().update().set({
				text: normalized, editedAt: () => 'CURRENT_TIMESTAMP', revision: () => '"revision" + 1',
			}).where('id = :id AND "fromUserId" = :userId AND "revision" = :revision AND "recalledAt" IS NULL', { id: messageId, userId, revision: expectedRevision }).execute();
			if (result.affected !== 1) throw new ChatMessageStateError('MESSAGE_CONFLICT');
			return repository.findOneByOrFail({ id: messageId });
		});
		const packed = await this.chatEntityService.packMessageLiteFor1on1(updated);
		this.globalEventService.publishChatUserStream(userId, original.toUserId, 'updated', packed);
		this.globalEventService.publishChatUserStream(original.toUserId, userId, 'updated', packed);
		this.invalidateUserConversation(userId, original.toUserId);
		return packed;
	}

	@bindThis
	public async userTimeline(meId: MiUser['id'], otherId: MiUser['id'], limit: number, sinceId?: MiChatMessage['id'] | null, untilId?: MiChatMessage['id'] | null) {
		const query = this.queryService.makePaginationQuery(this.chatMessagesRepository.createQueryBuilder('message'), sinceId, untilId)
			.andWhere(new Brackets(qb => {
				qb
					.where(new Brackets(qb => {
						qb
							.where('message.fromUserId = :meId')
							.andWhere('message.toUserId = :otherId');
					}))
					.orWhere(new Brackets(qb => {
						qb
							.where('message.fromUserId = :otherId')
							.andWhere('message.toUserId = :meId');
					}));
			}))
			.setParameter('meId', meId)
			.setParameter('otherId', otherId);

		const messages = await query.take(limit).getMany();

		return messages;
	}

	@bindThis
	public async roomTimeline(roomId: MiChatRoom['id'], limit: number, sinceId?: MiChatMessage['id'] | null, untilId?: MiChatMessage['id'] | null) {
		const query = this.queryService.makePaginationQuery(this.chatMessagesRepository.createQueryBuilder('message'), sinceId, untilId)
			.andWhere('message.toRoomId = :roomId', { roomId })
			.leftJoinAndSelect('message.file', 'file')
			.leftJoinAndSelect('message.fromUser', 'fromUser');

		const messages = await query.take(limit).getMany();

		return messages;
	}

	@bindThis
	public async userHistory(meId: MiUser['id'], limit: number): Promise<MiChatMessage[]> {
		const history: MiChatMessage[] = [];

		const mutingQuery = this.mutingsRepository.createQueryBuilder('muting')
			.select('muting.muteeId')
			.where('muting.muterId = :muterId', { muterId: meId });

		for (let i = 0; i < limit; i++) {
			const found = history.map(m => (m.fromUserId === meId) ? m.toUserId! : m.fromUserId!);

			const query = this.chatMessagesRepository.createQueryBuilder('message')
				.orderBy('message.id', 'DESC')
				.where(new Brackets(qb => {
					qb
						.where('message.fromUserId = :meId', { meId: meId })
						.orWhere('message.toUserId = :meId', { meId: meId });
				}))
				.andWhere('message.toRoomId IS NULL')
				.andWhere(`message.fromUserId NOT IN (${ mutingQuery.getQuery() })`)
				.andWhere(`message.toUserId NOT IN (${ mutingQuery.getQuery() })`);

			if (found.length > 0) {
				query.andWhere('message.fromUserId NOT IN (:...found)', { found: found });
				query.andWhere('message.toUserId NOT IN (:...found)', { found: found });
			}

			query.setParameters(mutingQuery.getParameters());

			const message = await query.getOne();

			if (message) {
				history.push(message);
			} else {
				break;
			}
		}

		return history;
	}

	@bindThis
	public async roomHistory(meId: MiUser['id'], limit: number): Promise<MiChatMessage[]> {
		// TODO: 一回のクエリにまとめられるかも
		const [memberRoomIds, ownedRoomIds] = await Promise.all([
			this.chatRoomMembershipsRepository.findBy({
				userId: meId,
			}).then(xs => xs.map(x => x.roomId)),
			this.chatRoomsRepository.findBy({
				ownerId: meId,
			}).then(xs => xs.map(x => x.id)),
		]);

		const roomIds = memberRoomIds.concat(ownedRoomIds);

		if (memberRoomIds.length === 0 && ownedRoomIds.length === 0) {
			return [];
		}

		const history: MiChatMessage[] = [];

		for (let i = 0; i < limit; i++) {
			const found = history.map(m => m.toRoomId!);

			const query = this.chatMessagesRepository.createQueryBuilder('message')
				.orderBy('message.id', 'DESC')
				.where('message.toRoomId IN (:...roomIds)', { roomIds });

			if (found.length > 0) {
				query.andWhere('message.toRoomId NOT IN (:...found)', { found: found });
			}

			const message = await query.getOne();

			if (message) {
				history.push(message);
			} else {
				break;
			}
		}

		return history;
	}

	@bindThis
	public async getUserReadStateMap(userId: string, otherIds: string[]) {
		const states = await Promise.all(otherIds.map(async otherId => {
			const state = await this.getUserConversationState(userId, otherId);
			return [otherId, state.unreadCount === 0 && !state.hasLegacyUnread] as const;
		}));
		return Object.fromEntries(states);
	}

	@bindThis
	public async getUserConversationState(userId: string, otherId: string) {
		const [legacy, unreadCount] = await Promise.all([
			this.importLegacyUserReadState(userId, otherId),
			this.chatMessagesRepository.countBy({ fromUserId: otherId, toUserId: userId, readTracked: true, readAt: IsNull(), recalledAt: IsNull() }),
		]);
		return { unreadCount, hasLegacyUnread: legacy.hasUnread };
	}

	@bindThis
	public async userMessageState(userId: string, otherId: string, messageIds: string[]) {
		const messages = messageIds.length === 0 ? [] : await this.chatMessagesRepository.findBy([
			{ id: In(messageIds), fromUserId: userId, toUserId: otherId },
			{ id: In(messageIds), fromUserId: otherId, toUserId: userId },
		]);
		return { messages: await this.chatEntityService.packMessagesLiteFor1on1(messages), missingIds: messageIds.filter(id => !messages.some(message => message.id === id)) };
	}

	@bindThis
	public async userConversations(userId: string, limit: number, untilId?: string, pinned?: boolean) {
		const rows = await this.db.query(
			`WITH latest AS (
				SELECT DISTINCT ON (CASE WHEN "fromUserId" = $1 THEN "toUserId" ELSE "fromUserId" END)
					"id", CASE WHEN "fromUserId" = $1 THEN "toUserId" ELSE "fromUserId" END AS "otherId"
				FROM "chat_message" WHERE "toUserId" IS NOT NULL AND ("fromUserId" = $1 OR "toUserId" = $1)
				AND NOT EXISTS (SELECT 1 FROM "muting" WHERE "muterId" = $1 AND "muteeId" = CASE WHEN "chat_message"."fromUserId" = $1 THEN "chat_message"."toUserId" ELSE "chat_message"."fromUserId" END)
				ORDER BY CASE WHEN "fromUserId" = $1 THEN "toUserId" ELSE "fromUserId" END, "id" DESC
			) SELECT latest."id", latest."otherId", preference."pinnedAt", COALESCE(preference."isMuted", false) AS "isMuted"
			FROM latest LEFT JOIN "chat_conversation_setting" preference ON preference."userId" = $1 AND preference."otherId" = latest."otherId"
			WHERE ($2::varchar IS NULL OR latest."id" < $2)
			AND ($4::boolean IS NULL OR (preference."pinnedAt" IS NOT NULL) = $4)
			ORDER BY ${pinned === true ? 'preference."pinnedAt" DESC, latest."otherId" ASC' : 'latest."id" DESC'} LIMIT $3`,
			[userId, pinned === true ? null : untilId ?? null, pinned === true ? 10 : limit, pinned ?? null],
		) as { id: string; otherId: string; pinnedAt: Date | null; isMuted: boolean }[];
		const messages = rows.length ? await this.chatMessagesRepository.findBy({ id: In(rows.map(row => row.id)) }) : [];
		return Promise.all(rows.map(async row => ({
			user: await this.userEntityService.pack(row.otherId, { id: userId }),
			lastMessage: await this.chatEntityService.packMessageLiteFor1on1(messages.find(message => message.id === row.id)!),
			...await this.getUserConversationState(userId, row.otherId),
			pinnedAt: row.pinnedAt?.toISOString() ?? null,
			isMuted: row.isMuted,
		})));
	}

	@bindThis
	public async userMessageContext(userId: string, otherId: string, messageId: string) {
		const target = await this.chatMessagesRepository.findOneBy({ id: messageId });
		if (!target || !samePrivateConversation(target, userId, otherId)) throw new ChatMessageAccessError('no such message');
		const [older, newer] = await Promise.all([
			this.userTimeline(userId, otherId, 21, null, messageId),
			this.userTimeline(userId, otherId, 21, messageId, null),
		]);
		const messages = [...older.slice(0, 20), target, ...newer.slice(0, 20)].sort((a, b) => a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
		return { messages: await this.chatEntityService.packMessagesLiteFor1on1(messages), hasOlder: older.length > 20, hasNewer: newer.length > 20 };
	}

	@bindThis
	public async getRoomReadStateMap(userId: MiUser['id'], roomIds: MiChatRoom['id'][]) {
		const readStateMap: Record<MiChatRoom['id'], boolean> = {};

		const redisPipeline = this.redisClient.pipeline();

		for (const roomId of roomIds) {
			redisPipeline.get(`newRoomChatMessageExists:${userId}:${roomId}`);
		}

		const markers = await redisPipeline.exec();
		if (markers == null) throw new Error('redis error');

		for (let i = 0; i < roomIds.length; i++) {
			const marker = markers[i][1];
			readStateMap[roomIds[i]] = marker == null;
		}

		return readStateMap;
	}

	@bindThis
	public async getUnreadSummary(userId: MiUser['id']) {
		const markers = await this.redisClient.smembers('newChatMessagesExists:' + userId);
		const otherIds = markers.filter(marker => marker.startsWith('user:')).map(marker => marker.slice(5));
		const repository = this.db.getRepository(MiChatLegacyUnread);
		// Old markers are imported only once. A persisted false row takes precedence
		// over stale Redis, without a query for every conversation on every poll.
		if (otherIds.length > 0) {
			const imported = new Set((await repository.find({ where: { userId, otherId: In(otherIds) }, select: { otherId: true } })).map(row => row.otherId));
			for (const otherId of otherIds) {
				if (!imported.has(otherId)) await this.importLegacyUserReadState(userId, otherId);
			}
		}
		const [unreadCount, hasLegacyUnread, notificationUnreadCount, hasNotificationLegacyUnread] = await Promise.all([
			this.chatMessagesRepository.countBy({ toUserId: userId, readTracked: true, readAt: IsNull(), recalledAt: IsNull() }),
			repository.existsBy({ userId, hasUnread: true }),
			this.chatMessagesRepository.createQueryBuilder('message')
				.where('message."toUserId" = :userId AND message."readTracked" = true AND message."readAt" IS NULL AND message."recalledAt" IS NULL', { userId })
				.andWhere('NOT EXISTS (SELECT 1 FROM "chat_conversation_setting" preference WHERE preference."userId" = :userId AND preference."otherId" = message."fromUserId" AND preference."isMuted" = true)', { userId }).getCount(),
			repository.createQueryBuilder('legacy').where('legacy."userId" = :userId AND legacy."hasUnread" = true', { userId })
				.andWhere('NOT EXISTS (SELECT 1 FROM "chat_conversation_setting" preference WHERE preference."userId" = :userId AND preference."otherId" = legacy."otherId" AND preference."isMuted" = true)', { userId }).getExists(),
		]);
		return { unreadCount, hasLegacyUnread, notificationUnreadCount, hasNotificationLegacyUnread, hasUnreadRoom: markers.some(marker => marker.startsWith('room:')) };
	}

	@bindThis
	public async hasUnreadMessages(userId: MiUser['id']) {
		const summary = await this.getUnreadSummary(userId);
		return summary.unreadCount > 0 || summary.hasLegacyUnread || summary.hasUnreadRoom;
	}

	@bindThis
	public async createRoom(owner: MiUser, params: Partial<{
		name: string;
		description: string;
	}>) {
		const room = {
			id: this.idService.gen(),
			name: params.name,
			description: params.description,
			ownerId: owner.id,
		} satisfies Partial<MiChatRoom>;

		const created = await this.chatRoomsRepository.insertOne(room);

		return created;
	}

	@bindThis
	public async hasPermissionToViewRoomInfo(meId: MiUser['id'], room: MiChatRoom) {
		if (room.ownerId === meId) {
			return true;
		}

		if (await this.isRoomMember(room, meId)) {
			return true;
		}

		if (await this.chatRoomInvitationsRepository.findOneBy({ roomId: room.id, userId: meId })) {
			return true;
		}

		if (await this.roleService.isModerator({ id: meId })) {
			return true;
		}

		return false;
	}

	@bindThis
	public async hasPermissionToDeleteRoom(meId: MiUser['id'], room: MiChatRoom) {
		if (room.ownerId === meId) {
			return true;
		}

		const iAmModerator = await this.roleService.isModerator({ id: meId });
		if (iAmModerator) {
			return true;
		}

		return false;
	}

	@bindThis
	public async deleteRoom(room: MiChatRoom, deleter?: MiUser) {
		const memberships = (await this.chatRoomMembershipsRepository.findBy({ roomId: room.id })).map(m => ({
			userId: m.userId,
		})).concat({ // ownerはmembershipレコードを作らないため
			userId: room.ownerId,
		});

		// 未読フラグ削除
		const redisPipeline = this.redisClient.pipeline();
		for (const membership of memberships) {
			redisPipeline.del(`newRoomChatMessageExists:${membership.userId}:${room.id}`);
			redisPipeline.srem(`newChatMessagesExists:${membership.userId}`, `room:${room.id}`);
		}
		await redisPipeline.exec();

		await this.chatRoomsRepository.delete(room.id);

		if (deleter) {
			const deleterIsModerator = await this.roleService.isModerator(deleter);

			if (deleterIsModerator) {
				this.moderationLogService.log(deleter, 'deleteChatRoom', {
					roomId: room.id,
					room: room,
				});
			}
		}
	}

	@bindThis
	public async findMyRoomById(ownerId: MiUser['id'], roomId: MiChatRoom['id']) {
		return this.chatRoomsRepository.findOneBy({ id: roomId, ownerId: ownerId });
	}

	@bindThis
	public async findRoomById(roomId: MiChatRoom['id']) {
		return this.chatRoomsRepository.findOne({
			where: { id: roomId },
			relations: { owner: true },
		});
	}

	@bindThis
	public async isRoomMember(room: MiChatRoom, userId: MiUser['id']) {
		if (room.ownerId === userId) return true;
		const membership = await this.chatRoomMembershipsRepository.findOneBy({ roomId: room.id, userId });
		return membership != null;
	}

	@bindThis
	public async createRoomInvitation(inviterId: MiUser['id'], roomId: MiChatRoom['id'], inviteeId: MiUser['id']) {
		if (inviterId === inviteeId) {
			throw new Error('yourself');
		}

		const room = await this.chatRoomsRepository.findOneByOrFail({ id: roomId, ownerId: inviterId });

		if (await this.isRoomMember(room, inviteeId)) {
			throw new Error('already member');
		}

		const existingInvitation = await this.chatRoomInvitationsRepository.findOneBy({ roomId, userId: inviteeId });
		if (existingInvitation) {
			throw new Error('already invited');
		}

		const membershipsCount = await this.chatRoomMembershipsRepository.countBy({ roomId });
		if (membershipsCount >= MAX_ROOM_MEMBERS) {
			throw new Error('room is full');
		}

		// TODO: cehck block

		const invitation = {
			id: this.idService.gen(),
			roomId: room.id,
			userId: inviteeId,
		} satisfies Partial<MiChatRoomInvitation>;

		const created = await this.chatRoomInvitationsRepository.insertOne(invitation);

		this.notificationService.createNotification(inviteeId, 'chatRoomInvitationReceived', {
			invitationId: invitation.id,
		}, inviterId);

		return created;
	}

	@bindThis
	public async getSentRoomInvitationsWithPagination(roomId: MiChatRoom['id'], limit: number, sinceId?: MiChatRoomInvitation['id'] | null, untilId?: MiChatRoomInvitation['id'] | null) {
		const query = this.queryService.makePaginationQuery(this.chatRoomInvitationsRepository.createQueryBuilder('invitation'), sinceId, untilId)
			.andWhere('invitation.roomId = :roomId', { roomId });

		const invitations = await query.take(limit).getMany();

		return invitations;
	}

	@bindThis
	public async getOwnedRoomsWithPagination(ownerId: MiUser['id'], limit: number, sinceId?: MiChatRoom['id'] | null, untilId?: MiChatRoom['id'] | null) {
		const query = this.queryService.makePaginationQuery(this.chatRoomsRepository.createQueryBuilder('room'), sinceId, untilId)
			.andWhere('room.ownerId = :ownerId', { ownerId });

		const rooms = await query.take(limit).getMany();

		return rooms;
	}

	@bindThis
	public async getReceivedRoomInvitationsWithPagination(userId: MiUser['id'], limit: number, sinceId?: MiChatRoomInvitation['id'] | null, untilId?: MiChatRoomInvitation['id'] | null) {
		const query = this.queryService.makePaginationQuery(this.chatRoomInvitationsRepository.createQueryBuilder('invitation'), sinceId, untilId)
			.andWhere('invitation.userId = :userId', { userId })
			.andWhere('invitation.ignored = FALSE');

		const invitations = await query.take(limit).getMany();

		return invitations;
	}

	@bindThis
	public async joinToRoom(userId: MiUser['id'], roomId: MiChatRoom['id']) {
		const invitation = await this.chatRoomInvitationsRepository.findOneByOrFail({ roomId, userId });

		const membershipsCount = await this.chatRoomMembershipsRepository.countBy({ roomId });
		if (membershipsCount >= MAX_ROOM_MEMBERS) {
			throw new Error('room is full');
		}

		const membership = {
			id: this.idService.gen(),
			roomId: roomId,
			userId: userId,
		} satisfies Partial<MiChatRoomMembership>;

		// TODO: transaction
		await this.chatRoomMembershipsRepository.insertOne(membership);
		await this.chatRoomInvitationsRepository.delete(invitation.id);
	}

	@bindThis
	public async ignoreRoomInvitation(userId: MiUser['id'], roomId: MiChatRoom['id']) {
		const invitation = await this.chatRoomInvitationsRepository.findOneByOrFail({ roomId, userId });
		await this.chatRoomInvitationsRepository.update(invitation.id, { ignored: true });
	}

	@bindThis
	public async leaveRoom(userId: MiUser['id'], roomId: MiChatRoom['id']) {
		const membership = await this.chatRoomMembershipsRepository.findOneByOrFail({ roomId, userId });
		await this.chatRoomMembershipsRepository.delete(membership.id);

		// 未読フラグを消す (「既読にする」というわけでもないのでreadメソッドは使わないでおく)
		const redisPipeline = this.redisClient.pipeline();
		redisPipeline.del(`newRoomChatMessageExists:${userId}:${roomId}`);
		redisPipeline.srem(`newChatMessagesExists:${userId}`, `room:${roomId}`);
		await redisPipeline.exec();
	}

	@bindThis
	public async muteRoom(userId: MiUser['id'], roomId: MiChatRoom['id'], mute: boolean) {
		const membership = await this.chatRoomMembershipsRepository.findOneByOrFail({ roomId, userId });
		await this.chatRoomMembershipsRepository.update(membership.id, { isMuted: mute });
	}

	@bindThis
	public async updateRoom(room: MiChatRoom, params: {
		name?: string;
		description?: string;
	}): Promise<MiChatRoom> {
		return this.chatRoomsRepository.createQueryBuilder().update()
			.set(params)
			.where('id = :id', { id: room.id })
			.returning('*')
			.execute()
			.then((response) => {
				return response.raw[0];
			});
	}

	@bindThis
	public async getRoomMembershipsWithPagination(roomId: MiChatRoom['id'], limit: number, sinceId?: MiChatRoomMembership['id'] | null, untilId?: MiChatRoomMembership['id'] | null) {
		const query = this.queryService.makePaginationQuery(this.chatRoomMembershipsRepository.createQueryBuilder('membership'), sinceId, untilId)
			.andWhere('membership.roomId = :roomId', { roomId });

		const memberships = await query.take(limit).getMany();

		return memberships;
	}

	@bindThis
	public async searchMessages(meId: MiUser['id'], query: string, limit: number, params: {
		userId?: MiUser['id'] | null;
		roomId?: MiChatRoom['id'] | null;
	}) {
		const q = this.chatMessagesRepository.createQueryBuilder('message');

		if (params.userId) {
			q.andWhere(new Brackets(qb => {
				qb
					.where(new Brackets(qb => {
						qb
							.where('message.fromUserId = :meId')
							.andWhere('message.toUserId = :otherId');
					}))
					.orWhere(new Brackets(qb => {
						qb
							.where('message.fromUserId = :otherId')
							.andWhere('message.toUserId = :meId');
					}));
			}))
				.setParameter('meId', meId)
				.setParameter('otherId', params.userId);
		} else if (params.roomId) {
			q.where('message.toRoomId = :roomId', { roomId: params.roomId });
		} else {
			const membershipsQuery = this.chatRoomMembershipsRepository.createQueryBuilder('membership')
				.select('membership.roomId')
				.where('membership.userId = :meId', { meId: meId });

			const ownedRoomsQuery = this.chatRoomsRepository.createQueryBuilder('room')
				.select('room.id')
				.where('room.ownerId = :meId', { meId });

			q.andWhere(new Brackets(qb => {
				qb
					.where('message.fromUserId = :meId')
					.orWhere('message.toUserId = :meId')
					.orWhere(`message.toRoomId IN (${membershipsQuery.getQuery()})`)
					.orWhere(`message.toRoomId IN (${ownedRoomsQuery.getQuery()})`);
			}));

			q.setParameters(membershipsQuery.getParameters());
			q.setParameters(ownedRoomsQuery.getParameters());
		}

		q.andWhere('LOWER(message.text) LIKE :q', { q: `%${ sqlLikeEscape(query.toLowerCase()) }%` });

		q.leftJoinAndSelect('message.file', 'file');
		q.leftJoinAndSelect('message.fromUser', 'fromUser');
		q.leftJoinAndSelect('message.toUser', 'toUser');
		q.leftJoinAndSelect('message.toRoom', 'toRoom');
		q.leftJoinAndSelect('toRoom.owner', 'toRoomOwner');

		const messages = await q.orderBy('message.id', 'DESC').take(limit).getMany();

		return messages;
	}

	@bindThis
	public async react(messageId: MiChatMessage['id'], userId: MiUser['id'], reaction_: string) {
		let reaction;

		const custom = reaction_.match(isCustomEmojiRegexp);

		if (custom == null) {
			reaction = normalizeEmojiString(reaction_);
		} else {
			const name = custom[1];
			const emoji = (await this.customEmojiService.localEmojisCache.fetch()).get(name);

			if (emoji == null) {
				throw new Error('no such emoji');
			} else {
				reaction = `:${name}:`;
			}
		}

		const message = await this.chatMessagesRepository.findOneBy({ id: messageId });
		if (message == null || message.recalledAt) throw new ChatMessageAccessError('no such message');

		if (message.fromUserId === userId) {
			throw new ChatMessageAccessError('cannot react to own message');
		}

		if (message.toRoomId === null && message.toUserId !== userId) {
			throw new ChatMessageAccessError('cannot react to others message');
		}

		const room = message.toRoomId ? await this.chatRoomsRepository.findOneByOrFail({ id: message.toRoomId }) : null;

		if (room) {
			if (!(await this.isRoomMember(room, userId))) {
				throw new ChatMessageAccessError('cannot react to others message');
			}
		}
		if (message.reactions.length >= MAX_REACTIONS_PER_MESSAGE) throw new Error('too many reactions');

		await this.chatMessagesRepository.createQueryBuilder().update()
			.set({
				reactions: () => 'array_append("reactions", :pair)',
			})
			.where('id = :id', { id: message.id })
			.andWhere('"recalledAt" IS NULL')
			.setParameter('pair', userId + '/' + reaction)
			.execute();

		if (room) {
			this.globalEventService.publishChatRoomStream(room.id, 'react', {
				messageId: message.id,
				user: await this.userEntityService.pack(userId),
				reaction,
			});
		} else {
			this.globalEventService.publishChatUserStream(message.fromUserId, message.toUserId!, 'react', {
				messageId: message.id,
				reaction,
			});
			this.globalEventService.publishChatUserStream(message.toUserId!, message.fromUserId, 'react', {
				messageId: message.id,
				reaction,
			});
		}
	}

	@bindThis
	public async unreact(messageId: MiChatMessage['id'], userId: MiUser['id'], reaction_: string) {
		let reaction;

		const custom = reaction_.match(isCustomEmojiRegexp);

		if (custom == null) {
			reaction = normalizeEmojiString(reaction_);
		} else { // 削除されたカスタム絵文字のリアクションを削除したいかもしれないので絵文字の存在チェックはする必要なし
			const name = custom[1];
			reaction = `:${name}:`;
		}
		const message = await this.chatMessagesRepository.findOneBy({ id: messageId });
		if (message == null || message.recalledAt) throw new ChatMessageAccessError('no such message');

		const room = message.toRoomId ? await this.chatRoomsRepository.findOneByOrFail({ id: message.toRoomId }) : null;
		if (room) {
			if (!(await this.isRoomMember(room, userId))) throw new ChatMessageAccessError('cannot unreact to others message');
		} else if (message.fromUserId !== userId && message.toUserId !== userId) {
			throw new ChatMessageAccessError('cannot unreact to others message');
		}

		await this.chatMessagesRepository.createQueryBuilder().update()
			.set({
				reactions: () => 'array_remove("reactions", :pair)',
			})
			.where('id = :id', { id: message.id })
			.andWhere('"recalledAt" IS NULL')
			.setParameter('pair', userId + '/' + reaction)
			.execute();

		// TODO: 実際に削除が行われたときのみイベントを発行する

		if (room) {
			this.globalEventService.publishChatRoomStream(room.id, 'unreact', {
				messageId: message.id,
				user: await this.userEntityService.pack(userId),
				reaction,
			});
		} else {
			this.globalEventService.publishChatUserStream(message.fromUserId, message.toUserId!, 'unreact', {
				messageId: message.id,
				reaction,
			});
			this.globalEventService.publishChatUserStream(message.toUserId!, message.fromUserId, 'unreact', {
				messageId: message.id,
				reaction,
			});
		}
	}

	@bindThis
	public async getMyMemberships(userId: MiUser['id'], limit: number, sinceId?: MiChatRoomMembership['id'] | null, untilId?: MiChatRoomMembership['id'] | null) {
		const query = this.queryService.makePaginationQuery(this.chatRoomMembershipsRepository.createQueryBuilder('membership'), sinceId, untilId)
			.andWhere('membership.userId = :userId', { userId });

		const memberships = await query.take(limit).getMany();

		return memberships;
	}
}
