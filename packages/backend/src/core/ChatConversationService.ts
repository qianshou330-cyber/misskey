/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource, IsNull, Not, type EntityManager } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { MiChatConversationSetting } from '@/models/ChatConversationSetting.js';
import { MiChatMessage } from '@/models/ChatMessage.js';
import { MiUser } from '@/models/User.js';
import { ApiError } from '@/server/api/error.js';
import { ChatContactService } from './ChatContactService.js';
import { GlobalEventService } from './GlobalEventService.js';

export const chatConversationErrors = {
	noSuchConversation: { message: 'No such private conversation.', code: 'NO_SUCH_CHAT_CONVERSATION', id: '42cb0623-5249-4676-9372-55aa3f85e7f8' },
	pinLimit: { message: 'At most ten private conversations can be pinned.', code: 'CHAT_PIN_LIMIT', id: 'd15b40e2-08dd-444b-ad90-b7cf0f01805a' },
} as const;

@Injectable()
export class ChatConversationService {
	constructor(
		@Inject(DI.db) private db: DataSource,
		private contacts: ChatContactService,
		private events: GlobalEventService,
	) {}

	public async get(userId: string, otherId: string, manager: EntityManager = this.db.manager) {
		const row = await manager.getRepository(MiChatConversationSetting).findOneBy({ userId, otherId });
		return { pinnedAt: row?.pinnedAt?.toISOString() ?? null, isMuted: row?.isMuted ?? false };
	}

	public async isMuted(userId: string, otherId: string, manager: EntityManager = this.db.manager): Promise<boolean> {
		return manager.getRepository(MiChatConversationSetting).existsBy({ userId, otherId, isMuted: true });
	}

	public async update(userId: string, otherId: string, changes: { pinned?: boolean; isMuted?: boolean }) {
		const settings = await this.contacts.withPairLock(userId, otherId, async manager => {
			// One owner lock covers pins across different conversations, including first inserts.
			await manager.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', ['chat-conversation-settings', userId]);
			if (userId === otherId || !await manager.getRepository(MiUser).existsBy({ id: otherId, host: IsNull(), isDeleted: false })) {
				throw new ApiError(chatConversationErrors.noSuchConversation);
			}
			const repository = manager.getRepository(MiChatConversationSetting);
			const current = await repository.findOneBy({ userId, otherId });
			let pinnedAt = current?.pinnedAt ?? null;
			if (changes.pinned === true && !pinnedAt) {
				if (!await manager.getRepository(MiChatMessage).existsBy([
					{ fromUserId: userId, toUserId: otherId }, { fromUserId: otherId, toUserId: userId },
				])) throw new ApiError(chatConversationErrors.noSuchConversation);
				if (await repository.countBy({ userId, pinnedAt: Not(IsNull()) }) >= 10) throw new ApiError(chatConversationErrors.pinLimit);
				pinnedAt = new Date();
			} else if (changes.pinned === false) pinnedAt = null;
			const isMuted = changes.isMuted ?? current?.isMuted ?? false;
			await repository.upsert({ userId, otherId, pinnedAt, isMuted }, ['userId', 'otherId']);
			if (changes.isMuted === true) {
				// Persist suppression for pending messages too. Unmuting can never
				// resurrect a notification whose three-second delay overlapped a mute.
				await manager.getRepository(MiChatMessage).update({
					fromUserId: otherId, toUserId: userId, readTracked: true, readAt: IsNull(), recalledAt: IsNull(), notificationSuppressed: false,
				}, { notificationSuppressed: true });
			}
			return { pinnedAt: pinnedAt?.toISOString() ?? null, isMuted };
		});
		this.events.publishMainStream(userId, 'chatStateChanged', { userId: otherId });
		return settings;
	}
}
