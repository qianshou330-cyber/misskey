/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { MiUser } from '@/models/User.js';
import { MiBlocking } from '@/models/Blocking.js';
import { MiChatApproval } from '@/models/ChatApproval.js';
import { MiFollowing } from '@/models/Following.js';
import { ChatContactService } from '@/core/ChatContactService.js';
import { RoleService } from '@/core/RoleService.js';
import { ChatMessageStateError } from '@/core/chat-message-state.js';

export type ChatPermissionPurpose = 'newMessage' | 'existingMessage' | 'attachment';

/** Shared by message writes and private attachment staging/binding. */
@Injectable()
export class ChatPermissionService {
	constructor(
		private contacts: ChatContactService,
		private roles: RoleService,
	) {}

	public async assertCanSend(senderId: string, recipientId: string, purpose: ChatPermissionPurpose, manager?: EntityManager): Promise<void> {
		if (!['newMessage', 'existingMessage', 'attachment'].includes(purpose)) throw new Error('Chat permission purpose is required');
		if (!manager) return this.contacts.withPairLock(senderId, recipientId, transaction => this.assertCanSend(senderId, recipientId, purpose, transaction));
		if (senderId === recipientId) throw new ChatMessageStateError('RECIPIENT_UNAVAILABLE');
		await this.contacts.assertCanSend(senderId, recipientId, manager);
		// Native block inserts take FK key-share locks on both users. This final
		// permission check serializes with their commit without changing follows.
		await manager.query('SELECT "id" FROM "user" WHERE "id" = ANY($1::varchar[]) ORDER BY "id" FOR UPDATE', [[senderId, recipientId].sort()]);
		const users = await manager.getRepository(MiUser).findBy({ id: In([senderId, recipientId]) });
		if (users.length !== 2 || users.some(user => user.host != null || user.isSuspended || user.isDeleted)) throw new ChatMessageStateError('RECIPIENT_UNAVAILABLE');
		const recipient = users.find(user => user.id === recipientId)!;
		const policies = await Promise.all([this.roles.getUserPolicies(senderId, manager), this.roles.getUserPolicies(recipientId, manager)]);
		if (policies.some(policy => policy.chatAvailability !== 'available')) throw new ChatMessageStateError('RECIPIENT_UNAVAILABLE');
		if (await manager.getRepository(MiBlocking).existsBy([
			{ blockerId: recipientId, blockeeId: senderId },
			{ blockerId: senderId, blockeeId: recipientId },
		])) throw new ChatMessageStateError('RECIPIENT_UNAVAILABLE');
		// Administrators may initiate contact regardless of the recipient's scope.
		// Account state, both role policies and both kinds of blocking still apply.
		if (await this.roles.isAdministrator({ id: senderId }, manager)) return;
		const approved = await manager.getRepository(MiChatApproval).existsBy({ userId: recipientId, otherId: senderId });
		if (approved) return;
		const followings = manager.getRepository(MiFollowing);
		if (recipient.chatScope === 'mutual' && await followings.countBy([
			{ followerId: senderId, followeeId: recipientId }, { followerId: recipientId, followeeId: senderId },
		]) !== 2) {
			// These callers already loaded an owned, persisted message. Its delayed
			// notification/edit must not be counted as a second message.
			if (purpose === 'existingMessage') return;
			if (await manager.getRepository(MiChatApproval).existsBy({ userId: senderId, otherId: recipientId })) {
				throw new ChatMessageStateError('CHAT_REPLY_REQUIRED');
			}
			if (purpose === 'attachment') throw new ChatMessageStateError('CHAT_FIRST_MESSAGE_TEXT_ONLY');
			return;
		}
		if (recipient.chatScope === 'none'
			|| (recipient.chatScope === 'followers' && !await followings.existsBy({ followerId: senderId, followeeId: recipientId }))
			|| (recipient.chatScope === 'following' && !await followings.existsBy({ followerId: recipientId, followeeId: senderId }))) {
			throw new ChatMessageStateError('RECIPIENT_UNAVAILABLE');
		}
	}
}
