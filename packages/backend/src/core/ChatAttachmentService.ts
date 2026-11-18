/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { DataSource, IsNull, LessThan, type EntityManager } from 'typeorm';
import sharp from 'sharp';
import { fileTypeFromFile } from 'file-type';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type { MiMeta } from '@/models/Meta.js';
import { MiDriveFile } from '@/models/DriveFile.js';
import { MiChatMessage } from '@/models/ChatMessage.js';
import { MiChatAttachment } from '@/models/ChatAttachment.js';
import { MiChatAttachmentBlob } from '@/models/ChatAttachmentBlob.js';
import { MiChatUploadReservation } from '@/models/ChatUploadReservation.js';
import { IdService } from '@/core/IdService.js';
import { RoleService } from '@/core/RoleService.js';
import { FileInfoService } from '@/core/FileInfoService.js';
import { S3Service } from '@/core/S3Service.js';
import { ChatAttachmentStorageService } from '@/core/ChatAttachmentStorageService.js';
import { ChatVoiceService } from '@/core/ChatVoiceService.js';
import { UserStorageQuotaService } from '@/core/UserStorageQuotaService.js';
import { ChatPermissionService } from '@/core/ChatPermissionService.js';
import { ChatMessageStateError, isChatFirstMessageError } from '@/core/chat-message-state.js';
import { ApiError } from '@/server/api/error.js';

export type ChatAttachmentDto = {
	id: string; name: string; mime: string; size: number; kind: 'file' | 'image' | 'voice';
	durationMs: number | null; peaks: number[]; width: number | null; height: number | null; hasPreview: boolean;
	legacyExposure: 'none' | 'possible'; sourceRetainedShared: boolean; expiresAt: string | null;
};
export class ChatAttachmentError extends Error {}
const DAY = 24 * 60 * 60_000;
const MAX_BYTES = 50 * 1024 * 1024;

@Injectable()
export class ChatAttachmentService implements OnModuleInit, OnApplicationShutdown {
	private timer: NodeJS.Timeout | null = null;
	private cleaning = false;
	constructor(
		@Inject(DI.db) private db: DataSource,
		@Inject(DI.config) private config: Config,
		@Inject(DI.meta) private meta: MiMeta,
		private ids: IdService,
		private roles: RoleService,
		private info: FileInfoService,
		private s3: S3Service,
		private storage: ChatAttachmentStorageService,
		private voice: ChatVoiceService,
		private quota: UserStorageQuotaService,
		private permissions: ChatPermissionService,
	) {}

	public onModuleInit(): void {
		this.timer = setInterval(() => { void this.cleanup().catch(() => { /* Retried; do not log private paths. */ }); }, 60 * 60_000);
		this.timer.unref();
	}
	public onApplicationShutdown(): void { if (this.timer) clearInterval(this.timer); }

	public async assertRecipient(ownerId: string, toUserId: string): Promise<void> {
		try { await this.permissions.assertCanSend(ownerId, toUserId, 'attachment'); } catch (error) {
			if (isChatFirstMessageError(error)) throw error;
			if (error instanceof ChatMessageStateError || error instanceof ApiError) throw new ChatAttachmentError('Chat writing is unavailable for this recipient');
			throw error;
		}
	}

	public async create(ownerId: string, toUserId: string, source: string, name: string, kind: 'file' | 'voice'): Promise<ChatAttachmentDto> {
		await this.assertRecipient(ownerId, toUserId);
		const blob = await this.createBlob(ownerId, source, kind, name);
		return this.stage(ownerId, toUserId, blob, name, 'none');
	}

	private async createBlob(ownerId: string, source: string, kind: 'file' | 'voice', fileName: string): Promise<MiChatAttachmentBlob> {
		const policies = await this.roles.getUserPolicies(ownerId);
		const stat = await fs.stat(source);
		const cap = Math.min(MAX_BYTES, this.config.maxFileSize, policies.maxFileSizeMb * 1024 * 1024);
		if (!stat.isFile() || stat.size <= 0 || stat.size > cap) throw new ChatAttachmentError('Attachment size exceeds the allowed limit');
		let mime: string;
		if (kind === 'voice') {
			// Native Drive's detector invokes an unbounded ffprobe for these containers.
			// Voice uses signature sniffing only; convert() owns the bounded audio-only
			// validation before any blob can be persisted or published.
			try { mime = (await fileTypeFromFile(source))?.mime ?? 'application/octet-stream'; } catch { throw new ChatAttachmentError('Unsupported voice recording'); }
			if (mime === 'video/mp4') mime = 'audio/mp4';
			if (mime === 'video/webm') mime = 'audio/webm';
			if (mime === 'application/ogg') mime = 'audio/ogg';
			if (!['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav'].includes(mime)) throw new ChatAttachmentError('Unsupported voice recording');
		} else {
			mime = (await this.info.detectType(source)).mime;
		}
		if (kind === 'file' && mime === 'application/octet-stream') {
			// Reuse Drive's limited txt/csv/json fallback when there is no binary
			// signature. Never replace a detected binary MIME with the client hint.
			mime = (await this.info.getFileInfo(source, { fileName, skipSensitiveDetection: true })).type.mime;
		}
		if (!policies.uploadableFileTypes.some(t => t === '*' || t === '*/*' || t === mime || (t.endsWith('/*') && mime.startsWith(t.slice(0, -1))))) throw new ChatAttachmentError('Attachment type is not allowed');
		const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'misskey-chat-'));
		let reservation: string | null = null;
		let storedKey: string | null = null;
		try {
			let durationMs: number | null = null;
			let peaks: number[] = [];
			let finalKind: MiChatAttachmentBlob['kind'] = kind;
			let preview: Buffer | undefined;
			let width: number | null = null, height: number | null = null;
			if (kind === 'voice') {
				if (!['audio/webm', 'audio/ogg', 'audio/mp4', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/wav', 'audio/x-wav'].includes(mime)) throw new ChatAttachmentError('Unsupported voice recording');
				const destination = path.join(temporary, 'voice.mp3');
				({ durationMs, peaks } = await this.voice.convert(source, destination));
				source = destination;
				mime = 'audio/mpeg';
			} else if (['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/apng', 'image/tiff', 'image/bmp'].includes(mime)) {
				try {
					const converted = await sharp(source, { limitInputPixels: 40_000_000 }).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
					preview = converted.data;
					width = converted.info.width;
					height = converted.info.height;
					finalKind = 'image';
				} catch {
					// Untrusted/huge images remain downloadable files, never rendered inline.
					finalKind = 'file';
				}
			}
			const sha256 = await this.storage.hash(source);
			const existing = await this.db.getRepository(MiChatAttachmentBlob).findOneBy({ ownerId, sha256, kind: finalKind });
			if (existing) return existing;
			const outputSize = (await fs.stat(source)).size;
			if (outputSize > cap) throw new ChatAttachmentError('Attachment size exceeds the allowed limit');
			reservation = await this.quota.reserve(ownerId, outputSize + (preview?.length ?? 0));
			const stored = await this.storage.store(source, preview);
			storedKey = stored.key;
			if (stored.sha256 !== sha256) throw new ChatAttachmentError('Attachment source changed during upload');
			const result = await this.db.transaction(async manager => {
				await this.quota.lock(manager, ownerId);
				const repository = manager.getRepository(MiChatAttachmentBlob);
				const duplicate = await repository.findOneBy({ ownerId, sha256, kind: finalKind });
				if (duplicate) return duplicate;
				if (reservation) await this.quota.consume(manager, ownerId, reservation, stored.size + stored.previewSize);
				const blob = repository.create({ id: this.ids.gen(), ownerId, storageKey: stored.key, sha256, mime, size: stored.size, storedSize: stored.size + stored.previewSize, previewSize: stored.previewSize, kind: finalKind, durationMs, peaks, width, height, createdAt: new Date() });
				await repository.insert(blob);
				await this.quota.release(reservation, manager);
				return blob;
			});
			if (result.storageKey !== stored.key) await this.storage.delete(stored.key);
			storedKey = null;
			return result;
		} finally {
			if (storedKey) await this.storage.delete(storedKey);
			await this.quota.release(reservation);
			await fs.rm(temporary, { recursive: true, force: true });
		}
	}

	public async stage(ownerId: string, toUserId: string, blob: MiChatAttachmentBlob, name: string, legacyExposure: 'none' | 'possible'): Promise<ChatAttachmentDto> {
		return this.db.transaction(async manager => {
			await this.quota.lock(manager, ownerId);
			if (!await manager.getRepository(MiChatAttachmentBlob).existsBy({ id: blob.id, ownerId })) throw new ChatAttachmentError('Attachment expired; upload again');
			const attachment = manager.getRepository(MiChatAttachment).create({ id: this.ids.gen(), ownerId, toUserId, blobId: blob.id, messageId: null, position: 0, name: name.replace(/[\u0000-\u001f\u007f\\/]/g, '_').slice(0, 200) || 'attachment', state: 'staged', legacyExposure, sourceRetainedShared: legacyExposure === 'possible', createdAt: new Date(), expiresAt: new Date(Date.now() + DAY) });
			await manager.getRepository(MiChatAttachment).insert(attachment);
			return this.pack(attachment, blob);
		});
	}

	public async withDriveSource<T>(file: MiDriveFile, action: (source: string) => Promise<T>): Promise<T> {
		if (file.isLink || !file.accessKey) throw new ChatAttachmentError('Only stored Drive files can be imported');
		if (file.storedInternal) {
			if (!/^[a-zA-Z0-9_.-]+$/.test(file.accessKey) || file.accessKey === '.' || file.accessKey === '..') throw new ChatAttachmentError('Invalid stored Drive file');
			return action(path.join(this.config.rootDir, 'files', file.accessKey));
		}
		const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'misskey-chat-import-'));
		const client = this.s3.getS3Client(this.meta);
		try {
			const response = await client.send(new GetObjectCommand({ Bucket: this.meta.objectStorageBucket!, Key: file.accessKey }), { abortSignal: AbortSignal.timeout(120_000) });
			if (!response.Body) throw new ChatAttachmentError('Drive file is unavailable');
			let received = 0;
			const limiter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
				received += chunk.length;
				callback(received > file.size ? new ChatAttachmentError('Drive file size changed') : null, chunk);
			} });
			const source = path.join(temporary, 'source');
			await pipeline(response.Body as Readable, limiter, createWriteStream(source, { mode: 0o600, flags: 'wx' }), { signal: AbortSignal.timeout(120_000) });
			if (received !== file.size) throw new ChatAttachmentError('Drive file size changed');
			return await action(source);
		} finally {
			client.destroy();
			await fs.rm(temporary, { force: true, recursive: true });
		}
	}

	public async importDrive(ownerId: string, toUserId: string, fileId: string): Promise<ChatAttachmentDto> {
		await this.assertRecipient(ownerId, toUserId);
		const file = await this.db.getRepository(MiDriveFile).findOneBy({ id: fileId, userId: ownerId, userHost: IsNull() });
		if (!file) throw new ChatAttachmentError('Drive file is unavailable');
		const policies = await this.roles.getUserPolicies(ownerId);
		if (file.size <= 0 || file.size > Math.min(MAX_BYTES, this.config.maxFileSize, policies.maxFileSizeMb * 1024 * 1024)) throw new ChatAttachmentError('Attachment size exceeds the allowed limit');
		const blob = await this.withDriveSource(file, source => this.createBlob(ownerId, source, 'file', file.name));
		return this.stage(ownerId, toUserId, blob, file.name, 'possible');
	}

	public async bindToMessage(manager: EntityManager, data: { ownerId: string; toUserId: string; messageId: string; attachmentIds: string[] }): Promise<void> {
		await this.permissions.assertCanSend(data.ownerId, data.toUserId, 'attachment', manager);
		if (data.attachmentIds.length > 10 || new Set(data.attachmentIds).size !== data.attachmentIds.length) throw new ChatAttachmentError('At most ten distinct attachments are allowed');
		if (data.attachmentIds.length === 0) return;
		const attachments = await manager.getRepository(MiChatAttachment).createQueryBuilder('a').setLock('pessimistic_write').where('a.id IN (:...ids)', { ids: data.attachmentIds }).getMany();
		if (attachments.length !== data.attachmentIds.length || attachments.some(a => a.ownerId !== data.ownerId || a.toUserId !== data.toUserId || a.state !== 'staged' || a.messageId !== null || !a.expiresAt || a.expiresAt.getTime() <= Date.now())) throw new ChatAttachmentError('Attachment is unavailable for this conversation');
		for (const a of attachments) await manager.getRepository(MiChatAttachment).update(a.id, { messageId: data.messageId, position: data.attachmentIds.indexOf(a.id), state: 'attached', expiresAt: null });
	}

	public pack(attachment: MiChatAttachment, blob: MiChatAttachmentBlob): ChatAttachmentDto {
		return { id: attachment.id, name: attachment.name, mime: blob.mime, size: blob.size, kind: blob.kind, durationMs: blob.durationMs, peaks: blob.peaks, width: blob.width, height: blob.height, hasPreview: blob.previewSize > 0, legacyExposure: attachment.legacyExposure, sourceRetainedShared: attachment.sourceRetainedShared, expiresAt: attachment.expiresAt?.toISOString() ?? null };
	}

	public async packForMessage(messageId: string): Promise<ChatAttachmentDto[]> {
		const attachments = await this.db.getRepository(MiChatAttachment).find({ where: { messageId, state: 'attached' }, relations: { blob: true }, order: { position: 'ASC' } });
		return attachments.map(a => this.pack(a, a.blob));
	}
	public hasAttachments(messageId: string): Promise<boolean> { return this.db.getRepository(MiChatAttachment).existsBy({ messageId }); }
	public async revokeMessage(manager: EntityManager, messageId: string): Promise<void> { await manager.getRepository(MiChatAttachment).update({ messageId }, { state: 'revoked', expiresAt: new Date() }); }

	public async cancel(ownerId: string, attachmentId: string): Promise<void> {
		const garbage = await this.db.transaction(async manager => {
			await this.quota.lock(manager, ownerId);
			const attachment = await manager.getRepository(MiChatAttachment).findOne({ where: { id: attachmentId, ownerId }, lock: { mode: 'pessimistic_write' } });
			if (!attachment) return null;
			if (attachment.state !== 'staged') throw new ChatAttachmentError('An attached file must be recalled with its message');
			await manager.getRepository(MiChatAttachment).delete(attachment.id);
			const [used] = await manager.query('SELECT EXISTS(SELECT 1 FROM chat_attachment WHERE "blobId"=$1) OR EXISTS(SELECT 1 FROM chat_attachment_migration WHERE "blobId"=$1 AND state IN (\'copied\',\'bound\')) AS used', [attachment.blobId]);
			if (used.used) return null;
			const blob = await manager.getRepository(MiChatAttachmentBlob).findOneBy({ id: attachment.blobId });
			if (blob) await manager.getRepository(MiChatAttachmentBlob).delete(blob.id);
			return blob;
		});
		if (garbage) await this.storage.delete(garbage.storageKey);
	}

	public async authorizedAttachment(userId: string, attachmentId: string): Promise<{ attachment: MiChatAttachment; blob: MiChatAttachmentBlob }> {
		const attachment = await this.db.getRepository(MiChatAttachment).findOne({ where: { id: attachmentId }, relations: { blob: true } });
		if (!attachment || attachment.state === 'revoked') throw new ChatAttachmentError('Attachment unavailable');
		if ((await this.roles.getUserPolicies(userId, this.db.manager)).chatAvailability === 'unavailable') throw new ChatAttachmentError('Attachment unavailable');
		if (attachment.state === 'staged') {
			if (attachment.ownerId !== userId || !attachment.expiresAt || attachment.expiresAt.getTime() <= Date.now()) throw new ChatAttachmentError('Attachment unavailable');
		} else {
			if (userId !== attachment.ownerId && userId !== attachment.toUserId) throw new ChatAttachmentError('Attachment unavailable');
			const message = await this.db.getRepository(MiChatMessage).findOneBy({ id: attachment.messageId! });
			if (!message || message.fromUserId !== attachment.ownerId || message.toUserId !== attachment.toUserId || message.toRoomId !== null || ('deletedAt' in message && message.deletedAt != null) || ('recalledAt' in message && message.recalledAt != null)) throw new ChatAttachmentError('Attachment unavailable');
		}
		return { attachment, blob: attachment.blob };
	}

	public async cleanup(): Promise<void> {
		if (this.cleaning) return;
		this.cleaning = true;
		try {
			await this.db.getRepository(MiChatUploadReservation).delete({ expiresAt: LessThan(new Date()) });
			await this.db.getRepository(MiChatAttachment).delete({ expiresAt: LessThan(new Date()) });
			const blobs = await this.db.getRepository(MiChatAttachmentBlob).createQueryBuilder('b').where('b.createdAt < :cutoff', { cutoff: new Date(Date.now() - DAY) }).andWhere('NOT EXISTS (SELECT 1 FROM chat_attachment a WHERE a."blobId"=b.id)').andWhere('NOT EXISTS (SELECT 1 FROM chat_attachment_migration m WHERE m."blobId"=b.id AND m.state IN (:...states))', { states: ['copied', 'bound'] }).take(500).getMany();
			for (const blob of blobs) {
				const removed = await this.db.transaction(async manager => {
					await this.quota.lock(manager, blob.ownerId);
					const [referenced] = await manager.query('SELECT EXISTS(SELECT 1 FROM chat_attachment WHERE "blobId"=$1) OR EXISTS(SELECT 1 FROM chat_attachment_migration WHERE "blobId"=$1 AND state IN (\'copied\',\'bound\')) AS used', [blob.id]);
					if (referenced.used) return false;
					await manager.getRepository(MiChatAttachmentBlob).delete(blob.id);
					return true;
				});
				if (removed) await this.storage.delete(blob.storageKey);
			}
			for (const key of await this.storage.oldKeys(new Date(Date.now() - DAY))) {
				if (!await this.db.getRepository(MiChatAttachmentBlob).existsBy({ storageKey: key })) await this.storage.delete(key);
			}
		} finally { this.cleaning = false; }
	}
}
