/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import 'reflect-metadata';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { entities } from '@/postgres.js';
import { loadConfig } from '@/config.js';
import { MiUser } from '@/models/User.js';
import { MiDriveFile } from '@/models/DriveFile.js';
import { MiChatMessage } from '@/models/ChatMessage.js';
import { MiChatRoom } from '@/models/ChatRoom.js';
import { MiChatAttachment } from '@/models/ChatAttachment.js';
import { MiChatAttachmentBlob } from '@/models/ChatAttachmentBlob.js';
import { MiChatAttachmentMigration } from '@/models/ChatAttachmentMigration.js';
import { MiChatUploadReservation } from '@/models/ChatUploadReservation.js';
import { IdService } from '@/core/IdService.js';
import type { RoleService } from '@/core/RoleService.js';
import type { FileInfoService } from '@/core/FileInfoService.js';
import type { S3Service } from '@/core/S3Service.js';
import type { ChatPermissionService } from '@/core/ChatPermissionService.js';
import { UserStorageQuotaService } from '@/core/UserStorageQuotaService.js';
import { ChatAttachmentStorageService } from '@/core/ChatAttachmentStorageService.js';
import { ChatAttachmentService } from '@/core/ChatAttachmentService.js';
import { ChatAttachmentMigrationService } from '@/core/ChatAttachmentMigrationService.js';
import { ChatVoiceService } from '@/core/ChatVoiceService.js';
import type { MiMeta } from '@/models/Meta.js';

describe('Chat attachment transactions and historical migration', () => {
	let db: DataSource;
	let root: string;
	let attachments: ChatAttachmentService;
	let quota: UserStorageQuotaService;
	let storage: ChatAttachmentStorageService;
	let migration: ChatAttachmentMigrationService;
	let ids: IdService;
	let roles: RoleService;
	let capacity = 10;
	const permission = { assertCanSend: vi.fn(async () => {}) };

	beforeAll(async () => {
		if (process.env.NODE_ENV !== 'test') throw new Error('An isolated test database is required');
		const config = loadConfig();
		root = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-transaction-test-'));
		vi.stubEnv('MISSKEY_CHAT_STORAGE_PATH', path.join(root, 'private'));
		await fs.mkdir(path.join(root, 'files'));
		const privateConfig = { ...config, rootDir: root };
		ids = new IdService(privateConfig);
		db = new DataSource({ type: 'postgres', host: config.db.host, port: config.db.port, username: config.db.user, password: config.db.pass, database: config.db.db, entities, synchronize: true, dropSchema: true, extra: { max: 1 } });
		await db.initialize();
		roles = { getUserPolicies: async () => ({ driveCapacityMb: capacity, maxFileSizeMb: 50, uploadableFileTypes: ['*'], chatAvailability: 'available' }) } as unknown as RoleService;
		quota = new UserStorageQuotaService(db, roles, ids);
		storage = new ChatAttachmentStorageService(privateConfig);
		attachments = new ChatAttachmentService(db, privateConfig, {} as MiMeta, ids, roles, { detectType: async () => ({ mime: 'application/octet-stream' }), getFileInfo: async () => ({ type: { mime: 'application/octet-stream' } }) } as unknown as FileInfoService, {} as S3Service, storage, new ChatVoiceService(), quota, permission as unknown as ChatPermissionService);
		migration = new ChatAttachmentMigrationService(db, privateConfig, {} as MiMeta, storage, ids);
	}, 120_000);

	afterAll(async () => { if (db?.isInitialized) await db.destroy(); vi.unstubAllEnvs(); if (root) await fs.rm(root, { recursive: true, force: true }); });

	async function user() { const id = ids.gen(); await db.getRepository(MiUser).insert({ id, username: id, usernameLower: id, host: null }); return id; }

	async function upload(owner: string, recipient: string, bytes = 'private fixture bytes') {
		const source = path.join(root, ids.gen()); await fs.writeFile(source, bytes);
		return attachments.create(owner, recipient, source, 'fixture.dat', 'file');
	}

	async function message(owner: string, recipient: string | null, fileId: string | null = null, toRoomId: string | null = null) {
		return db.getRepository(MiChatMessage).save({ id: ids.gen(), fromUserId: owner, toUserId: recipient, fileId, toRoomId, text: null });
	}

	async function legacyFile(owner: string) {
		const id = ids.gen(), key = randomBytes(24).toString('hex');
		const bytes = `legacy-${id}`; await fs.writeFile(path.join(root, 'files', key), bytes);
		const file = db.getRepository(MiDriveFile).create({ id, userId: owner, userHost: null, name: 'legacy.dat', md5: '0'.repeat(32), type: 'application/octet-stream', size: Buffer.byteLength(bytes), storedInternal: true, accessKey: key, url: `https://invalid.example/files/${key}` });
		await db.getRepository(MiDriveFile).insert(file);
		return file;
	}

	it('counts Drive, unique private blobs and reservations together without cross-owner deduplication', async () => {
		const owner = await user(), recipient = await user();
		await legacyFile(owner);
		const first = await upload(owner, recipient), duplicate = await upload(owner, recipient);
		expect(first.id).not.toBe(duplicate.id);
		expect(await db.getRepository(MiChatAttachmentBlob).countBy({ ownerId: owner })).toBe(1);
		const usage = await quota.usage(owner);
		expect(usage.drive).toBeGreaterThan(0);
		expect(usage.chat).toBe(Buffer.byteLength('private fixture bytes'));
		await upload(recipient, owner);
		expect(await db.getRepository(MiChatAttachmentBlob).countBy({ ownerId: recipient })).toBe(1);
		await attachments.cancel(owner, first.id);
		expect((await quota.usage(owner)).chat).toBe(usage.chat);
		await attachments.cancel(owner, duplicate.id);
		expect((await quota.usage(owner)).chat).toBe(0);
	});

	it('serializes capacity reservations and releases failed/cancelled reservations', async () => {
		const owner = await user(); capacity = 1000 / (1024 * 1024);
		const secondDb = new DataSource({ ...db.options, synchronize: false, dropSchema: false });
		await secondDb.initialize();
		try {
			const secondQuota = new UserStorageQuotaService(secondDb, roles, ids);
			const result = await Promise.allSettled([quota.reserve(owner, 800), secondQuota.reserve(owner, 800)]);
			expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1);
			expect((await quota.usage(owner)).reserved).toBe(800);
			for (const r of result) if (r.status === 'fulfilled') await quota.release(r.value);
			expect((await quota.usage(owner)).reserved).toBe(0);
		} finally { capacity = 10; await secondDb.destroy(); }
	});

	it('rejects expired upload leases before persistence and rolls quota consumption back on failure', async () => {
		const owner = await user();
		const expired = await quota.reserve(owner, 80);
		await db.getRepository(MiChatUploadReservation).update(expired, { expiresAt: new Date(Date.now() - 1) });
		const insert = vi.fn(async () => 'saved');
		await expect(quota.commit(owner, expired, 80, insert)).rejects.toThrow('expired');
		expect(insert).not.toHaveBeenCalled();
		const live = await quota.reserve(owner, 80);
		await expect(quota.commit(owner, live, 80, async () => { throw new Error('insert failed'); })).rejects.toThrow('insert failed');
		expect((await quota.usage(owner)).reserved).toBe(80);
		await quota.release(live);
	});

	it('releases a reservation when private storage fails without inserting a blob', async () => {
		const owner = await user(), recipient = await user();
		const store = vi.spyOn(storage, 'store').mockRejectedValueOnce(new Error('fixture storage unavailable'));
		try { await expect(upload(owner, recipient, 'unique failure fixture')).rejects.toThrow('fixture storage unavailable'); } finally { store.mockRestore(); }
		expect((await quota.usage(owner)).total).toBe(0);
		expect(await db.getRepository(MiChatAttachmentBlob).countBy({ ownerId: owner })).toBe(0);
	});

	it('expires staged access and cleans orphan bytes while protecting a copied migration', async () => {
		const owner = await user(), recipient = await user();
		const staged = await upload(owner, recipient, 'expiration fixture');
		const grant = await db.getRepository(MiChatAttachment).findOneByOrFail({ id: staged.id });
		const blob = await db.getRepository(MiChatAttachmentBlob).findOneByOrFail({ id: grant.blobId });
		const expired = new Date(Date.now() - 25 * 60 * 60_000);
		await db.getRepository(MiChatAttachment).update(grant.id, { expiresAt: expired });
		await db.getRepository(MiChatAttachmentBlob).update(blob.id, { createdAt: expired });
		await expect(attachments.authorizedAttachment(owner, grant.id)).rejects.toThrow();
		const protection = { sourceFileId: ids.gen(), blobId: blob.id, state: 'copied' as const, sharedReasons: [], sourceSnapshot: null, updatedAt: new Date() };
		await db.getRepository(MiChatAttachmentMigration).insert(protection);
		await attachments.cleanup();
		expect(await db.getRepository(MiChatAttachment).existsBy({ id: grant.id })).toBe(false);
		expect(await db.getRepository(MiChatAttachmentBlob).existsBy({ id: blob.id })).toBe(true);
		await db.getRepository(MiChatAttachmentMigration).delete(protection.sourceFileId);
		await attachments.cleanup();
		expect(await db.getRepository(MiChatAttachmentBlob).existsBy({ id: blob.id })).toBe(false);
		await expect(fs.stat(storage.pathFor(blob.storageKey, 'original'))).rejects.toMatchObject({ code: 'ENOENT' });
		const stray = await storage.store(path.join(root, 'files', (await legacyFile(owner)).accessKey!));
		await fs.utimes(storage.pathFor(stray.key, 'original'), expired, expired);
		await attachments.cleanup();
		await expect(fs.stat(storage.pathFor(stray.key, 'original'))).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('requires the intended conversation, rolls binding back with the message, and revokes byte access', async () => {
		const owner = await user(), recipient = await user(), third = await user();
		const staged = await upload(owner, recipient);
		await expect(attachments.authorizedAttachment(recipient, staged.id)).rejects.toThrow();
		await expect(db.transaction(async manager => {
			const sent = await manager.getRepository(MiChatMessage).save({ id: ids.gen(), fromUserId: owner, toUserId: third });
			await attachments.bindToMessage(manager, { ownerId: owner, toUserId: third, messageId: sent.id, attachmentIds: [staged.id] });
		})).rejects.toThrow('unavailable');
		expect((await db.getRepository(MiChatAttachment).findOneByOrFail({ id: staged.id })).state).toBe('staged');
		const sent = await db.transaction(async manager => {
			const value = await manager.getRepository(MiChatMessage).save({ id: ids.gen(), fromUserId: owner, toUserId: recipient });
			await attachments.bindToMessage(manager, { ownerId: owner, toUserId: recipient, messageId: value.id, attachmentIds: [staged.id] });
			return value;
		});
		expect((await attachments.authorizedAttachment(recipient, staged.id)).attachment.messageId).toBe(sent.id);
		await expect(attachments.authorizedAttachment(third, staged.id)).rejects.toThrow();
		await db.transaction(manager => attachments.revokeMessage(manager, sent.id));
		await expect(attachments.authorizedAttachment(recipient, staged.id)).rejects.toThrow();
		expect(permission.assertCanSend).toHaveBeenCalledWith(owner, recipient, 'attachment', expect.anything());
	});

	it('preserves native account deletion across owner, attachment and blob foreign keys', async () => {
		const owner = await user(), recipient = await user();
		const attachment = await upload(owner, recipient);
		await db.getRepository(MiUser).delete(owner);
		expect(await db.getRepository(MiChatAttachment).existsBy({ id: attachment.id })).toBe(false);
		expect(await db.getRepository(MiChatAttachmentBlob).existsBy({ ownerId: owner })).toBe(false);
	});

	it('migrates exclusively private sources but preserves avatar/URL and room references, resumably', async () => {
		const owner = await user(), recipient = await user();
		const exclusive = await legacyFile(owner), shared = await legacyFile(owner), roomFile = await legacyFile(owner);
		const one = await message(owner, recipient, exclusive.id), two = await message(owner, recipient, shared.id), three = await message(owner, recipient, roomFile.id);
		await db.getRepository(MiUser).update(owner, { avatarId: shared.id, avatarUrl: shared.url });
		const roomId = ids.gen(); await db.getRepository(MiChatRoom).insert({ id: roomId, ownerId: owner, name: 'fixture room', description: '' });
		const roomMessage = await message(owner, null, roomFile.id, roomId);
		const before = await db.getRepository(MiChatAttachmentBlob).count();
		const dryrun = await migration.run('dryrun');
		expect(dryrun.total).toBe(3); expect(dryrun.exclusive).toBe(1); expect(dryrun.shared).toBe(2);
		expect(await db.getRepository(MiChatAttachmentBlob).count()).toBe(before);
		expect((await migration.run('copy')).failed).toBe(0);
		await expect(migration.run('maintenance-cutover')).rejects.toThrow('confirm');
		const result = await migration.run('maintenance-cutover', true);
		expect(result.failed).toBe(0); expect(result.closed).toBe(1); expect(result.shared).toBe(2);
		expect(await db.getRepository(MiDriveFile).existsBy({ id: exclusive.id })).toBe(false);
		await expect(fs.stat(path.join(root, 'files', exclusive.accessKey!))).rejects.toMatchObject({ code: 'ENOENT' });
		expect(await db.getRepository(MiDriveFile).existsBy({ id: shared.id })).toBe(true);
		expect((await db.getRepository(MiChatMessage).findOneByOrFail({ id: roomMessage.id })).fileId).toBe(roomFile.id);
		for (const sent of [one, two, three]) {
			expect((await db.getRepository(MiChatMessage).findOneByOrFail({ id: sent.id })).fileId).toBeNull();
			const [attachment] = await attachments.packForMessage(sent.id);
			expect(attachment.legacyExposure).toBe('possible');
			expect(attachment).not.toHaveProperty('url');
			await expect(attachments.authorizedAttachment(recipient, attachment.id)).resolves.toBeDefined();
		}
		expect((await db.getRepository(MiChatAttachmentMigration).findOneByOrFail({ sourceFileId: shared.id })).state).toBe('shared');
		expect((await migration.run('maintenance-cutover', true)).failed).toBe(0);
	}, 120_000);

	it('fails closed on corrupted private copies before closing any source, and recovers on rerun', async () => {
		const owner = await user(), recipient = await user();
		const damaged = await legacyFile(owner), healthy = await legacyFile(owner);
		await message(owner, recipient, damaged.id); await message(owner, recipient, healthy.id);
		expect((await migration.run('copy')).failed).toBe(0);
		const map = await db.getRepository(MiChatAttachmentMigration).findOneByOrFail({ sourceFileId: damaged.id });
		const blob = await db.getRepository(MiChatAttachmentBlob).findOneByOrFail({ id: map.blobId! });
		await fs.writeFile(storage.pathFor(blob.storageKey, 'original'), 'corrupted fixture');
		const rejected = await migration.run('maintenance-cutover', true);
		expect(rejected.failed).toBe(1); expect(rejected.closed).toBe(0);
		for (const file of [damaged, healthy]) {
			expect(await db.getRepository(MiDriveFile).existsBy({ id: file.id })).toBe(true);
			await expect(fs.stat(path.join(root, 'files', file.accessKey!))).resolves.toBeDefined();
		}
		await fs.copyFile(path.join(root, 'files', damaged.accessKey!), storage.pathFor(blob.storageKey, 'original'));
		const recovered = await migration.run('maintenance-cutover', true);
		expect(recovered.failed).toBe(0); expect(recovered.closed).toBe(2);
		expect((await migration.run('maintenance-cutover', true)).failed).toBe(0);
	}, 120_000);

	it('rechecks references added after copy and preserves shared physical Drive aliases', async () => {
		const owner = await user(), recipient = await user();
		const lateShared = await legacyFile(owner), aliased = await legacyFile(owner);
		await message(owner, recipient, lateShared.id); await message(owner, recipient, aliased.id);
		expect((await migration.run('copy')).failed).toBe(0);
		await db.getRepository(MiUser).update(owner, { bannerUrl: lateShared.url });
		await db.getRepository(MiDriveFile).insert({ ...aliased, id: ids.gen(), accessKey: randomBytes(24).toString('hex'), thumbnailAccessKey: aliased.accessKey });
		const result = await migration.run('maintenance-cutover', true);
		expect(result.failed).toBe(0); expect(result.closed).toBe(0); expect(result.shared).toBe(2);
		for (const file of [lateShared, aliased]) {
			expect(await db.getRepository(MiDriveFile).existsBy({ id: file.id })).toBe(true);
			await expect(fs.stat(path.join(root, 'files', file.accessKey!))).resolves.toBeDefined();
		}
		expect((await db.getRepository(MiChatAttachmentMigration).findOneByOrFail({ sourceFileId: aliased.id })).sharedReasons).toContain('drive-alias');
	}, 120_000);

	it('keeps protected private bytes when source metadata disappears after copying', async () => {
		const owner = await user(), recipient = await user(), file = await legacyFile(owner);
		const sent = await message(owner, recipient, file.id);
		expect((await migration.run('copy')).failed).toBe(0);
		const map = await db.getRepository(MiChatAttachmentMigration).findOneByOrFail({ sourceFileId: file.id });
		const blob = await db.getRepository(MiChatAttachmentBlob).findOneByOrFail({ id: map.blobId! });
		await db.getRepository(MiDriveFile).delete(file.id);
		expect((await migration.run('maintenance-cutover', true)).failed).toBe(1);
		expect((await db.getRepository(MiChatAttachmentMigration).findOneByOrFail({ sourceFileId: file.id })).state).toBe('copied');
		expect(await storage.hash(storage.pathFor(blob.storageKey, 'original'))).toBe(blob.sha256);
		await db.getRepository(MiDriveFile).insert(file);
		await db.getRepository(MiChatMessage).update(sent.id, { fileId: file.id });
		expect((await migration.run('maintenance-cutover', true)).failed).toBe(0);
	}, 120_000);

	it('revalidates copied bytes when resuming a cutover interrupted before old source removal', async () => {
		const owner = await user(), recipient = await user(), file = await legacyFile(owner);
		await message(owner, recipient, file.id);
		const closing = vi.spyOn(migration as unknown as { closeSource: (record: MiChatAttachmentMigration) => Promise<void> }, 'closeSource').mockRejectedValueOnce(new Error('fixture interrupted source closure'));
		try { expect((await migration.run('maintenance-cutover', true)).failed).toBe(1); } finally { closing.mockRestore(); }
		const map = await db.getRepository(MiChatAttachmentMigration).findOneByOrFail({ sourceFileId: file.id });
		expect(map.state).toBe('bound');
		expect(await db.getRepository(MiDriveFile).existsBy({ id: file.id })).toBe(false);
		const blob = await db.getRepository(MiChatAttachmentBlob).findOneByOrFail({ id: map.blobId! });
		await fs.writeFile(storage.pathFor(blob.storageKey, 'original'), 'damaged during interruption');
		expect((await migration.run('maintenance-cutover', true)).failed).toBe(1);
		await expect(fs.stat(path.join(root, 'files', file.accessKey!))).resolves.toBeDefined();
		await fs.copyFile(path.join(root, 'files', file.accessKey!), storage.pathFor(blob.storageKey, 'original'));
		const recovered = await migration.run('maintenance-cutover', true);
		expect(recovered.failed).toBe(0); expect(recovered.closed).toBe(1);
		await expect(fs.stat(path.join(root, 'files', file.accessKey!))).rejects.toMatchObject({ code: 'ENOENT' });
	}, 120_000);
});
