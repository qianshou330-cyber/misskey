/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { Inject, Injectable } from '@nestjs/common';
import { IsNull } from 'typeorm';
import type { VerificationDocumentsRepository } from '@/models/_.js';
import { MiVerificationDocument } from '@/models/VerificationDocument.js';
import { DI } from '@/di-symbols.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { FileInfoService } from '@/core/FileInfoService.js';
import { IdService } from '@/core/IdService.js';
import { InternalStorageService } from '@/core/InternalStorageService.js';
import { VerificationFileRejectedError, VerificationScannerUnavailableError, VerificationStorageService } from '@/core/VerificationStorageService.js';
import { VerificationService } from '@/core/VerificationService.js';
import { LoggerService } from '@/core/LoggerService.js';
import type Logger from '@/logger.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export const meta = {
	tags: ['verification'],
	requireCredential: true,
	prohibitMoved: true,
	requireFile: true,
	kind: 'write:account',
	limit: { duration: 1000 * 60 * 60, max: 10 },
	errors: {
		invalidFile: { message: 'The verification document must be a JPEG, PNG, or WebP image no larger than 10 MB.', code: 'INVALID_VERIFICATION_FILE', id: 'f2e0dbd1-1e69-4a76-91ac-3eaf6ebf0da7' },
		malwareDetected: { message: 'The verification document failed malware scanning.', code: 'VERIFICATION_MALWARE_DETECTED', id: 'f083fe1e-c332-46db-a3c6-c2f78f5c2777' },
		storageUnavailable: { message: 'Verification storage is not configured.', code: 'VERIFICATION_STORAGE_UNAVAILABLE', id: '63d8f6ce-4cf5-4ef6-a4d7-cf1e7e9c8b1f' },
		alreadyApproved: { message: 'Your account is already verified.', code: 'ALREADY_VERIFIED', id: 'a2afde79-5eb3-4f59-9f67-9c8a3f2f5b3c' },
	},
	res: {
		type: 'object',
		properties: {
			id: { type: 'string', format: 'misskey:id' },
			side: { type: 'string', enum: ['front', 'back'] },
			mime: { type: 'string' },
			size: { type: 'integer' },
			sha256: { type: 'string' },
		},
		required: ['id', 'side', 'mime', 'size', 'sha256'],
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		side: { type: 'string', enum: ['front', 'back'] },
	},
	required: ['side'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	private readonly logger: Logger;

	constructor(
		@Inject(DI.verificationDocumentsRepository)
		private documentsRepository: VerificationDocumentsRepository,

		private verificationService: VerificationService,
		private fileInfoService: FileInfoService,
		private internalStorage: InternalStorageService,
		private storage: VerificationStorageService,
		private idService: IdService,
		loggerService: LoggerService,
	) {
		super(meta, paramDef, async (ps, me, _token, file, cleanup) => {
			try {
				const application = await this.verificationService.getApplication(me.id);
				if (application?.status === 'approved') throw new ApiError(meta.errors.alreadyApproved);

				const sourcePath = this.internalStorage.resolvePath(file!.path);
				const stat = await fs.stat(sourcePath);
				if (stat.size <= 0 || stat.size > MAX_FILE_SIZE) throw new ApiError(meta.errors.invalidFile);
				try {
					await this.storage.scan(sourcePath);
				} catch (error) {
					if (error instanceof VerificationFileRejectedError) throw new ApiError(meta.errors.malwareDetected);
					if (error instanceof VerificationScannerUnavailableError) throw new ApiError(meta.errors.storageUnavailable);
					throw error;
				}
				const info = await this.fileInfoService.getFileInfo(sourcePath, { fileName: file!.name ?? undefined, skipSensitiveDetection: true });
				const mime = info.type.mime;
				if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime) || info.size <= 0 || info.size > MAX_FILE_SIZE) {
					throw new ApiError(meta.errors.invalidFile);
				}

				const staleDocuments = await this.documentsRepository.manager.transaction(async manager => {
					const documents = manager.getRepository(MiVerificationDocument);
					const candidates = await documents.createQueryBuilder('document')
						.setLock('pessimistic_write')
						.where('document.userId = :userId', { userId: me.id })
						.andWhere('document.applicationId IS NULL')
						.andWhere('document.createdAt < :cutoff', { cutoff: new Date(Date.now() - 24 * 60 * 60 * 1000) })
						.getMany();
					if (candidates.length > 0) await documents.delete(candidates.map(document => document.id));
					return candidates;
				});
				if (staleDocuments.length > 0) {
					await Promise.all(staleDocuments.map(document => this.storage.delete(document.storageKey).catch(error => this.logger.warn(`Unable to remove stale verification document ${document.id}: ${error}`))));
				}

				const storageKey = randomBytes(24).toString('base64url');
				let stored: { sha256: string; size: number };
				try {
					stored = await this.storage.store(storageKey, sourcePath);
				} catch {
					throw new ApiError(meta.errors.storageUnavailable);
				}

				let saved: { document: MiVerificationDocument; previous: MiVerificationDocument | null };
				try {
					saved = await this.documentsRepository.manager.transaction(async manager => {
						const documents = manager.getRepository(MiVerificationDocument);
						const previous = await documents.findOne({
							where: { userId: me.id, applicationId: IsNull(), side: ps.side },
							lock: { mode: 'pessimistic_write' },
						});
						if (previous != null) await documents.delete(previous.id);
						const next = documents.create({
							id: this.idService.gen(),
							userId: me.id,
							applicationId: null,
							side: ps.side,
							storageKey,
							mime,
							size: stored.size,
							sha256: stored.sha256,
							createdAt: new Date(),
						});
						await documents.insert(next);
						return { document: next, previous };
					});
				} catch (error) {
					await this.storage.delete(storageKey).catch(cleanupError => this.logger.warn(`Unable to remove failed verification upload ${storageKey}: ${cleanupError}`));
					throw error;
				}

				if (saved.previous != null) {
					await this.storage.delete(saved.previous.storageKey).catch(error => this.logger.warn(`Unable to remove replaced verification document ${saved.previous!.id}: ${error}`));
				}

				return { id: saved.document.id, side: ps.side, mime, size: stored.size, sha256: stored.sha256 };
			} finally {
				cleanup!();
			}
		});
		this.logger = loggerService.getLogger('verification');
	}
}
