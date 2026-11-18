/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { S3Client, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Inject, Injectable } from '@nestjs/common';
import { DataSource, In, type EntityManager } from 'typeorm';
import sharp from 'sharp';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type { MiMeta } from '@/models/Meta.js';
import { MiDriveFile } from '@/models/DriveFile.js';
import { MiChatMessage } from '@/models/ChatMessage.js';
import { MiChatAttachment } from '@/models/ChatAttachment.js';
import { MiChatAttachmentBlob } from '@/models/ChatAttachmentBlob.js';
import { MiChatAttachmentMigration } from '@/models/ChatAttachmentMigration.js';
import { ChatAttachmentStorageService } from '@/core/ChatAttachmentStorageService.js';
import { IdService } from '@/core/IdService.js';

type Column = { table_name: string; column_name: string };
export type ChatMigrationSummary = { total: number; exclusive: number; shared: number; copied: number; closed: number; failed: number; bytes: number };
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;

/** Explicit operator-run migration. Never scheduled and never run from a schema migration. */
@Injectable()
export class ChatAttachmentMigrationService {
	constructor(@Inject(DI.db) private db: DataSource, @Inject(DI.config) private config: Config, @Inject(DI.meta) private meta: MiMeta, private storage: ChatAttachmentStorageService, private ids: IdService) {}

	private client(): S3Client {
		return new S3Client({ endpoint: this.meta.objectStorageEndpoint ? `${this.meta.objectStorageUseSSL ? 'https' : 'http'}://${this.meta.objectStorageEndpoint}` : undefined, region: this.meta.objectStorageRegion || undefined, forcePathStyle: this.meta.objectStorageS3ForcePathStyle, credentials: this.meta.objectStorageAccessKey && this.meta.objectStorageSecretKey ? { accessKeyId: this.meta.objectStorageAccessKey, secretAccessKey: this.meta.objectStorageSecretKey } : undefined });
	}

	private async sources(manager: EntityManager): Promise<MiDriveFile[]> {
		return manager.getRepository(MiDriveFile).createQueryBuilder('f').where('f.userHost IS NULL').andWhere('EXISTS (SELECT 1 FROM chat_message m WHERE m."fileId"=f.id AND m."toUserId" IS NOT NULL AND m."toRoomId" IS NULL)').orderBy('f.id', 'ASC').getMany();
	}

	private async referenceColumns(manager: EntityManager): Promise<Column[]> {
		return manager.query(`SELECT c.table_name,c.column_name FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name WHERE c.table_schema=current_schema() AND t.table_type='BASE TABLE' AND c.data_type IN ('character varying','text','character','json','jsonb','ARRAY') AND c.table_name NOT IN ('drive_file','chat_message','chat_attachment','chat_attachment_blob','chat_attachment_migration','chat_upload_reservation','access_token','auth_session','password_reset_request') AND c.column_name !~* '(password|secret|token|privatekey)' ORDER BY c.table_name,c.column_name`);
	}

	private async sharedReferences(manager: EntityManager, file: MiDriveFile, columns: Column[]): Promise<string[]> {
		const reasons: string[] = [];
		const [room] = await manager.query('SELECT EXISTS(SELECT 1 FROM chat_message WHERE "fileId"=$1 AND "toRoomId" IS NOT NULL) AS found', [file.id]);
		if (room.found) reasons.push('chat-room');
		const needles = [file.id, file.url, file.thumbnailUrl, file.webpublicUrl].filter((v): v is string => Boolean(v));
		const keys = [file.accessKey, file.thumbnailAccessKey, file.webpublicAccessKey].filter((v): v is string => Boolean(v));
		const [aliases] = await manager.query('SELECT EXISTS(SELECT 1 FROM drive_file WHERE id<>$1 AND ("accessKey"=ANY($2::text[]) OR "thumbnailAccessKey"=ANY($2::text[]) OR "webpublicAccessKey"=ANY($2::text[]) OR url=ANY($3::text[]) OR "thumbnailUrl"=ANY($3::text[]) OR "webpublicUrl"=ANY($3::text[]))) AS found', [file.id, keys, needles]);
		if (aliases.found) reasons.push('drive-alias');
		// Conservative exhaustive scan catches JSON Page blocks, draft arrays and URL-only branding.
		// It returns booleans, never document contents or credentials.
		for (const column of columns) {
			const [result] = await manager.query(`SELECT EXISTS(SELECT 1 FROM ${quote(column.table_name)} WHERE EXISTS(SELECT 1 FROM unnest($1::text[]) needle WHERE strpos(${quote(column.column_name)}::text, needle)>0)) AS found`, [needles]);
			if (result.found) reasons.push(`${column.table_name}.${column.column_name}`);
		}
		const [links] = await manager.query('SELECT EXISTS(SELECT 1 FROM chat_message WHERE "toRoomId" IS NOT NULL AND EXISTS(SELECT 1 FROM unnest($1::text[]) needle WHERE strpos(text,needle)>0)) AS found', [needles]);
		if (links.found) reasons.push('chat-room.text');
		return reasons;
	}

	private async sourcePath<T>(file: MiDriveFile, callback: (source: string) => Promise<T>): Promise<T> {
		if (file.isLink || !file.accessKey) throw new Error('A stored source is required');
		if (file.storedInternal) {
			if (!/^[a-zA-Z0-9_.-]+$/.test(file.accessKey) || file.accessKey === '.' || file.accessKey === '..') throw new Error('Invalid local storage key');
			return callback(path.join(this.config.rootDir, 'files', file.accessKey));
		}
		const client = this.client();
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'misskey-chat-migrate-'));
		try {
			const response = await client.send(new GetObjectCommand({ Bucket: this.meta.objectStorageBucket!, Key: file.accessKey }), { abortSignal: AbortSignal.timeout(120_000) });
			if (!response.Body) throw new Error('Missing source');
			let size = 0;
			const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) { size += chunk.length; callback(size > file.size ? new Error('Source size mismatch') : null, chunk); } });
			const source = path.join(directory, 'source');
			await pipeline(response.Body as Readable, limit, createWriteStream(source, { mode: 0o600, flags: 'wx' }), { signal: AbortSignal.timeout(120_000) });
			if (size !== file.size) throw new Error('Source size mismatch');
			return await callback(source);
		} finally { client.destroy(); await fs.rm(directory, { recursive: true, force: true }); }
	}

	private async copy(file: MiDriveFile): Promise<MiChatAttachmentMigration> {
		if (!file.userId) throw new Error('Missing source owner');
		return this.db.transaction(async manager => {
		// Share the quota/cleanup lock. The copied blob and its protection record
		// must commit together, including when a prior upload is deduplicated.
		await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`chat-storage:${file.userId}`]);
		const previous = await manager.getRepository(MiChatAttachmentMigration).findOneBy({ sourceFileId: file.id });
		if (previous?.blobId) {
			const blob = await manager.getRepository(MiChatAttachmentBlob).findOneBy({ id: previous.blobId });
			if (blob && await this.storage.hash(this.storage.pathFor(blob.storageKey, 'original')) === blob.sha256) return previous;
			throw new Error('Previously copied private bytes failed verification');
		}
		const blob = await this.sourcePath(file, async source => {
			if ((await fs.stat(source)).size !== file.size) throw new Error('Source size mismatch');
			const sha256 = await this.storage.hash(source);
			let preview: Buffer | undefined;
			let width: number | null = null, height: number | null = null;
			if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') {
				try {
					const result = await sharp(source, { limitInputPixels: 40_000_000 }).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
					preview = result.data; width = result.info.width; height = result.info.height;
				} catch { /* Preserve the original as a downloadable file. */ }
			}
			const kind = preview ? 'image' : 'file';
			const existing = await manager.getRepository(MiChatAttachmentBlob).findOneBy({ ownerId: file.userId!, sha256, kind });
			if (existing) return existing;
			const stored = await this.storage.store(source, preview);
			try {
				if (stored.sha256 !== sha256) throw new Error('Source changed while creating its private copy');
				const value = manager.getRepository(MiChatAttachmentBlob).create({ id: this.ids.gen(), ownerId: file.userId!, storageKey: stored.key, sha256, mime: file.type, size: stored.size, storedSize: stored.size + stored.previewSize, previewSize: stored.previewSize, kind, durationMs: null, peaks: [], width, height, createdAt: new Date() });
				await manager.getRepository(MiChatAttachmentBlob).insert(value);
				return value;
			} catch (error) { await this.storage.delete(stored.key); throw error; }
		});
		const record = manager.getRepository(MiChatAttachmentMigration).create({ sourceFileId: file.id, blobId: blob.id, state: 'copied', sharedReasons: [], sourceSnapshot: { storedInternal: file.storedInternal, keys: [file.accessKey, file.thumbnailAccessKey, file.webpublicAccessKey].filter((v): v is string => Boolean(v)) }, updatedAt: new Date() });
		await manager.getRepository(MiChatAttachmentMigration).save(record);
		return record;
		});
	}

	private async closeSource(record: MiChatAttachmentMigration): Promise<void> {
		if (!record.sourceSnapshot) throw new Error('Missing source closure record');
		// A crash can leave a bound record for hours. Reverify the private copy on
		// every retry before destroying the remaining recoverable public bytes.
		const blob = await this.db.getRepository(MiChatAttachmentBlob).findOneByOrFail({ id: record.blobId! });
		if (await this.storage.hash(this.storage.pathFor(blob.storageKey, 'original')) !== blob.sha256) throw new Error('Private copy verification failed before source closure');
		if (record.sourceSnapshot.storedInternal) {
			for (const key of record.sourceSnapshot.keys) {
				if (!/^[a-zA-Z0-9_.-]+$/.test(key) || key === '.' || key === '..') throw new Error('Invalid source key');
				const source = path.join(this.config.rootDir, 'files', key);
				await fs.rm(source, { force: true });
				try { await fs.stat(source); throw new Error('Source still exists'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
			}
		} else {
			const client = this.client();
			try {
				for (const key of record.sourceSnapshot.keys) {
					const input = { Bucket: this.meta.objectStorageBucket!, Key: key };
					await client.send(new DeleteObjectCommand(input), { abortSignal: AbortSignal.timeout(30_000) });
					try { await client.send(new HeadObjectCommand(input), { abortSignal: AbortSignal.timeout(30_000) }); throw new Error('Source still exists'); } catch (error) { if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404) throw error; }
				}
			} finally { client.destroy(); }
		}
		await this.db.getRepository(MiChatAttachmentMigration).update(record.sourceFileId, { state: 'closed', updatedAt: new Date() });
	}

	public async run(mode: 'dryrun' | 'copy' | 'maintenance-cutover', maintenanceConfirmed = false): Promise<ChatMigrationSummary> {
		if (mode === 'maintenance-cutover' && !maintenanceConfirmed) throw new Error('Stop all application writers and explicitly confirm the maintenance window');
		if (mode === 'maintenance-cutover') {
			const [activity] = await this.db.query("SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'");
			if (activity.count > 0) throw new Error('Other database clients are connected; stop writers and use the dedicated single-connection migration command');
		}
		const summary: ChatMigrationSummary = { total: 0, exclusive: 0, shared: 0, copied: 0, closed: 0, failed: 0, bytes: 0 };
		if (mode === 'dryrun') {
			await this.db.transaction(async manager => {
				await manager.query('SET TRANSACTION READ ONLY');
				const columns = await this.referenceColumns(manager);
				for (const file of await this.sources(manager)) {
					summary.total++; summary.bytes += file.size;
					if ((await this.sharedReferences(manager, file, columns)).length) summary.shared++; else summary.exclusive++;
				}
			});
			return summary;
		}
		await this.storage.ensure();
		const sources = await this.sources(this.db.manager);
		for (const file of sources) {
			summary.total++; summary.bytes += file.size;
			try { await this.copy(file); summary.copied++; } catch { summary.failed++; }
		}
		if (mode === 'copy' || summary.failed > 0) return summary;
		const records = await this.db.getRepository(MiChatAttachmentMigration).findBy({ state: In(['copied', 'bound']) });
		for (const record of records) {
			try {
				if (record.state === 'copied') {
					await this.db.transaction(async manager => {
						await manager.query("SET LOCAL lock_timeout = '5s'");
						// Block writers across every persisted reference surface until classification,
						// message grants and removal of an exclusive Drive row commit together.
						const columns = await this.referenceColumns(manager);
						const tables = [...new Set(['chat_message', 'drive_file', ...columns.map(c => c.table_name)])].sort();
						await manager.query(`LOCK TABLE ${tables.map(quote).join(',')} IN SHARE ROW EXCLUSIVE MODE`);
						const file = await manager.getRepository(MiDriveFile).findOneBy({ id: record.sourceFileId });
						if (!file) throw new Error('Source metadata disappeared');
						const blob = await manager.getRepository(MiChatAttachmentBlob).findOneByOrFail({ id: record.blobId! });
						if (await this.storage.hash(this.storage.pathFor(blob.storageKey, 'original')) !== blob.sha256) throw new Error('Private copy verification failed');
						const reasons = await this.sharedReferences(manager, file, columns);
						const messages = await manager.getRepository(MiChatMessage).findBy({ fileId: file.id });
						if (!messages.some(m => m.toUserId && !m.toRoomId)) reasons.push('no-current-private-reference');
						for (const message of messages.filter(m => m.toUserId && !m.toRoomId)) {
							if (message.fromUserId !== file.userId) throw new Error('Legacy attachment ownership mismatch');
							if (!await manager.getRepository(MiChatAttachment).existsBy({ messageId: message.id })) {
								await manager.getRepository(MiChatAttachment).insert({ id: this.ids.gen(), ownerId: message.fromUserId, toUserId: message.toUserId!, messageId: message.id, blobId: blob.id, position: 0, name: file.name, state: 'attached', legacyExposure: 'possible', sourceRetainedShared: reasons.length > 0, createdAt: new Date(), expiresAt: null });
							}
							await manager.getRepository(MiChatMessage).update(message.id, { fileId: null });
						}
						if (reasons.length === 0) await manager.getRepository(MiDriveFile).delete(file.id);
						record.state = reasons.length ? 'shared' : 'bound';
						record.sharedReasons = reasons;
						record.updatedAt = new Date();
						await manager.getRepository(MiChatAttachmentMigration).save(record);
					});
				}
				if (record.state === 'shared') summary.shared++;
				else { summary.exclusive++; await this.closeSource(record); summary.closed++; }
			} catch { summary.failed++; }
		}
		return summary;
	}
}
