/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { In } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { VerificationDocumentsRepository } from '@/models/_.js';
import { MiVerificationDocument } from '@/models/VerificationDocument.js';
import { LoggerService } from '@/core/LoggerService.js';
import { VerificationStorageService } from '@/core/VerificationStorageService.js';
import type Logger from '@/logger.js';

const HOUR = 60 * 60 * 1000;

@Injectable()
export class VerificationCleanupService implements OnModuleInit, OnApplicationShutdown {
	private readonly logger: Logger;
	private interval: NodeJS.Timeout | null = null;
	private initial: NodeJS.Timeout | null = null;
	private running = false;

	constructor(
		@Inject(DI.verificationDocumentsRepository)
		private documentsRepository: VerificationDocumentsRepository,
		private storage: VerificationStorageService,
		loggerService: LoggerService,
	) {
		this.logger = loggerService.getLogger('verification-cleanup');
	}

	public onModuleInit(): void {
		this.initial = setTimeout(() => { void this.cleanup(); }, 10 * 60 * 1000);
		this.initial.unref();
		this.interval = setInterval(() => { void this.cleanup(); }, HOUR);
		this.interval.unref();
	}

	public onApplicationShutdown(): void {
		if (this.initial != null) clearTimeout(this.initial);
		if (this.interval != null) clearInterval(this.interval);
	}

	public async cleanup(): Promise<void> {
		if (this.running) return;
		this.running = true;
		try {
			const cutoff = new Date(Date.now() - 24 * HOUR);
			const stale = await this.documentsRepository.manager.transaction(async manager => {
				const documents = manager.getRepository(MiVerificationDocument);
				const candidates = await documents.createQueryBuilder('document')
					.setLock('pessimistic_write')
					.where('document.applicationId IS NULL')
					.andWhere('document.createdAt < :cutoff', { cutoff })
					.take(1000)
					.getMany();
				if (candidates.length > 0) await documents.delete(candidates.map(document => document.id));
				return candidates;
			});
			if (stale.length > 0) {
				await Promise.all(stale.map(document => this.storage.delete(document.storageKey).catch(error => this.logger.warn(`Unable to delete stale verification file ${document.id}: ${error}`))));
			}

			const keys = await this.storage.listStoredKeysOlderThan(new Date(Date.now() - HOUR));
			for (let i = 0; i < keys.length; i += 100) {
				const batch = keys.slice(i, i + 100);
				const known = await this.documentsRepository.find({ where: { storageKey: In(batch) }, select: { storageKey: true } });
				const knownKeys = new Set(known.map(document => document.storageKey));
				await Promise.all(batch.filter(key => !knownKeys.has(key)).map(key => this.storage.delete(key).catch(error => this.logger.warn(`Unable to delete orphan verification file ${key}: ${error}`))));
			}
		} catch (error) {
			this.logger.error(error instanceof Error ? error : `Verification cleanup failed: ${error}`);
		} finally {
			this.running = false;
		}
	}
}
