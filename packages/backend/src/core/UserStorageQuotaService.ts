/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { IdService } from '@/core/IdService.js';
import { RoleService } from '@/core/RoleService.js';
import { MiChatUploadReservation } from '@/models/ChatUploadReservation.js';

export class StorageQuotaExceededError extends Error {}

@Injectable()
export class UserStorageQuotaService {
	constructor(@Inject(DI.db) private db: DataSource, private roles: RoleService, private ids: IdService) {}

	public async lock(manager: EntityManager, ownerId: string): Promise<void> {
		await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`chat-storage:${ownerId}`]);
	}

	public async usage(ownerId: string, manager: EntityManager = this.db.manager): Promise<{ drive: number; chat: number; reserved: number; total: number }> {
		const [row] = await manager.query(`SELECT
			COALESCE((SELECT SUM(size) FROM drive_file WHERE "userId"=$1 AND "isLink"=false),0)::text AS drive,
			COALESCE((SELECT SUM("storedSize") FROM chat_attachment_blob WHERE "ownerId"=$1),0)::text AS chat,
			COALESCE((SELECT SUM(size) FROM chat_upload_reservation WHERE "ownerId"=$1 AND "expiresAt">now()),0)::text AS reserved`, [ownerId]);
		const drive = Number(row.drive), chat = Number(row.chat), reserved = Number(row.reserved);
		return { drive, chat, reserved, total: drive + chat + reserved };
	}

	public async reserve(ownerId: string, size: number): Promise<string> {
		// Ordinary Drive supports empty files; Chat applies its own nonempty limit.
		if (!Number.isSafeInteger(size) || size < 0) throw new StorageQuotaExceededError('Invalid storage reservation');
		const capacity = (await this.roles.getUserPolicies(ownerId)).driveCapacityMb * 1024 * 1024;
		return this.db.transaction(async manager => {
			await this.lock(manager, ownerId);
			if ((await this.usage(ownerId, manager)).total + size > capacity) throw new StorageQuotaExceededError('Storage quota exceeded');
			const id = this.ids.gen();
			await manager.getRepository(MiChatUploadReservation).insert({ id, ownerId, size, expiresAt: new Date(Date.now() + 30 * 60_000) });
			return id;
		});
	}

	public async release(id: string | null, manager: EntityManager = this.db.manager): Promise<void> {
		if (id != null) await manager.getRepository(MiChatUploadReservation).delete(id);
	}

	/** Consume a still-live reservation in the same transaction that inserts its bytes. */
	public async consume(manager: EntityManager, ownerId: string, id: string, size: number): Promise<void> {
		await this.lock(manager, ownerId);
		const reservation = await manager.getRepository(MiChatUploadReservation).findOne({ where: { id, ownerId }, lock: { mode: 'pessimistic_write' } });
		if (!reservation || reservation.expiresAt.getTime() <= Date.now() || reservation.size !== size) throw new StorageQuotaExceededError('Storage reservation expired; retry upload');
		await manager.getRepository(MiChatUploadReservation).delete(id);
	}

	public async commit<T>(ownerId: string, id: string, size: number, insert: (manager: EntityManager) => Promise<T>): Promise<T> {
		return this.db.transaction(async manager => {
			await this.consume(manager, ownerId, id, size);
			return insert(manager);
		});
	}
}
