/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource, In, IsNull, LessThan, type EntityManager } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { MiChatBlocking } from '@/models/ChatBlocking.js';
import { MiChatContactGroup } from '@/models/ChatContactGroup.js';
import { MiChatContactGroupMember } from '@/models/ChatContactGroupMember.js';
import { MiUser } from '@/models/User.js';
import { ApiError } from '@/server/api/error.js';
import { IdService } from './IdService.js';

export const chatContactErrors = {
	noSuchContact: { message: 'No such local contact or private group.', code: 'NO_SUCH_CHAT_CONTACT', id: '997208da-5af6-499b-b166-7e0bcab5e2b5' },
	blocked: { message: 'Chat is blocked.', code: 'CHAT_BLOCKED', id: '21fe54fc-928a-4a5c-8262-afc9e8536933' },
	limitExceeded: { message: 'Chat contact group limit exceeded.', code: 'CHAT_CONTACT_LIMIT', id: 'b33f98b8-56d1-4d88-b534-a1d6c6f71bc8' },
	invalidName: { message: 'Group name must contain between 1 and 100 characters.', code: 'INVALID_CHAT_GROUP_NAME', id: 'fb98768d-0b04-411a-9655-86c796baf7de' },
} as const;

/** Private address-book data. Never changes native follows, lists or blocking. */
@Injectable()
export class ChatContactService {
	constructor(
		@Inject(DI.db) private db: DataSource,
		private idService: IdService,
	) {}

	/** Sending, editing and blocking share the same unordered-pair transaction lock. */
	public async withPairLock<T>(senderId: string, recipientId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
		const pair = [senderId, recipientId].sort().join(':');
		for (let attempt = 0; ; attempt++) {
			try {
				return await this.db.transaction(async manager => {
					await manager.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', ['chat-pair', pair]);
					return work(manager);
				});
			} catch (error) {
				// Native blocking acquires user FK locks without the Chat pair lock.
				// Retry the whole rolled-back transaction, never individual statements.
				const code = (error as { driverError?: { code?: string }; code?: string }).driverError?.code ?? (error as { code?: string }).code;
				if (attempt >= 2 || (code !== '40P01' && code !== '40001')) throw error;
				await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1) + Math.floor(Math.random() * 20)));
			}
		}
	}

	public async assertCanSend(senderId: string, recipientId: string, manager: EntityManager = this.db.manager): Promise<void> {
		if (await manager.getRepository(MiChatBlocking).existsBy([
			{ userId: senderId, targetId: recipientId },
			{ userId: recipientId, targetId: senderId },
		])) throw new ApiError(chatContactErrors.blocked);
	}

	private async assertContact(ownerId: string, targetId: string, manager: EntityManager): Promise<void> {
		if (ownerId === targetId || !await manager.getRepository(MiUser).existsBy({ id: targetId, host: IsNull(), isDeleted: false })) {
			throw new ApiError(chatContactErrors.noSuchContact);
		}
	}

	public async setBlocked(ownerId: string, targetId: string, blocked: boolean): Promise<void> {
		await this.withPairLock(ownerId, targetId, async manager => {
			// Unblocking must remain possible when an account has since been deleted.
			if (blocked) await this.assertContact(ownerId, targetId, manager);
			const repo = manager.getRepository(MiChatBlocking);
			if (!blocked) {
				await repo.delete({ userId: ownerId, targetId });
			} else if (!await repo.existsBy({ userId: ownerId, targetId })) {
				await repo.insert({ id: this.idService.gen(), userId: ownerId, targetId, createdAt: new Date() });
			}
		});
	}

	public async listBlocked(ownerId: string, limit = 30, untilId?: string) {
		const rows = await this.db.getRepository(MiChatBlocking).find({
			where: { userId: ownerId, ...(untilId ? { id: LessThan(untilId) } : {}) },
			order: { id: 'DESC' }, take: Math.max(1, Math.min(limit, 100)),
		});
		return rows.map(row => ({ id: row.id, userId: row.targetId, createdAt: row.createdAt.toISOString() }));
	}

	public async listGroups(ownerId: string) {
		const groups = await this.db.getRepository(MiChatContactGroup).find({ where: { userId: ownerId }, order: { id: 'ASC' } });
		const members = groups.length === 0 ? [] : await this.db.getRepository(MiChatContactGroupMember).findBy({ groupId: In(groups.map(group => group.id)) });
		return groups.map(group => ({ id: group.id, name: group.name, userIds: members.filter(member => member.groupId === group.id).map(member => member.userId).sort() }));
	}

	private checkedName(name: string): string {
		const trimmed = name.trim();
		if (trimmed.length === 0 || trimmed.length > 100) throw new ApiError(chatContactErrors.invalidName);
		return trimmed;
	}

	public async createGroup(ownerId: string, name: string) {
		const checkedName = this.checkedName(name);
		return this.db.transaction(async manager => {
			await manager.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', ['chat-contact-groups', ownerId]);
			const repo = manager.getRepository(MiChatContactGroup);
			if (await repo.countBy({ userId: ownerId }) >= 100) throw new ApiError(chatContactErrors.limitExceeded);
			const group = { id: this.idService.gen(), userId: ownerId, name: checkedName };
			await repo.insert(group);
			return { id: group.id, name: group.name, userIds: [] as string[] };
		});
	}

	private async withOwnedGroup<T>(ownerId: string, groupId: string, work: (manager: EntityManager, group: MiChatContactGroup) => Promise<T>): Promise<T> {
		return this.db.transaction(async manager => {
			const group = await manager.getRepository(MiChatContactGroup).findOne({ where: { id: groupId, userId: ownerId }, lock: { mode: 'pessimistic_write' } });
			if (!group) throw new ApiError(chatContactErrors.noSuchContact);
			return work(manager, group);
		});
	}

	public async updateGroup(ownerId: string, groupId: string, name: string) {
		const checkedName = this.checkedName(name);
		return this.withOwnedGroup(ownerId, groupId, async (manager, group) => {
			await manager.getRepository(MiChatContactGroup).update(group.id, { name: checkedName });
			const members = await manager.getRepository(MiChatContactGroupMember).findBy({ groupId });
			return { id: groupId, name: checkedName, userIds: members.map(member => member.userId).sort() };
		});
	}

	public async deleteGroup(ownerId: string, groupId: string): Promise<void> {
		await this.withOwnedGroup(ownerId, groupId, async manager => {
			await manager.getRepository(MiChatContactGroup).delete(groupId);
		});
	}

	public async setMember(ownerId: string, groupId: string, targetId: string, included: boolean): Promise<void> {
		await this.withOwnedGroup(ownerId, groupId, async manager => {
			const repo = manager.getRepository(MiChatContactGroupMember);
			if (!included) {
				await repo.delete({ groupId, userId: targetId });
				return;
			}
			await this.assertContact(ownerId, targetId, manager);
			if (await repo.existsBy({ groupId, userId: targetId })) return;
			if (await repo.countBy({ groupId }) >= 1000) throw new ApiError(chatContactErrors.limitExceeded);
			await repo.insert({ groupId, userId: targetId });
		});
	}
}
