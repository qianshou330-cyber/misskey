/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { VerificationApplicationsRepository, VerificationDocumentsRepository, UsersRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';
import { VerificationStorageService } from '@/core/VerificationStorageService.js';

export const meta = {
	tags: ['admin', 'verification'], requireCredential: true, requireAdmin: true, kind: 'read:admin:show-user',
	errors: {
		noSuchApplication: { message: 'No such verification application.', code: 'NO_SUCH_VERIFICATION_APPLICATION', id: '9de28ad3-8f8f-4b7a-ae23-131c52cb9165' },
		noSuchDocument: { message: 'No such verification document.', code: 'NO_SUCH_VERIFICATION_DOCUMENT', id: 'a7f90d4a-0f56-46fc-97cf-9bb3f7f5f27f' },
	},
	res: { type: 'object', properties: { mime: { type: 'string' }, data: { type: 'string' } }, required: ['mime', 'data'] },
} as const;
export const paramDef = { type: 'object', properties: { applicationId: { type: 'string', format: 'misskey:id' }, documentId: { type: 'string', format: 'misskey:id' } }, required: ['applicationId', 'documentId'] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		@Inject(DI.verificationApplicationsRepository) private applicationsRepository: VerificationApplicationsRepository,
		@Inject(DI.verificationDocumentsRepository) private documentsRepository: VerificationDocumentsRepository,
		@Inject(DI.usersRepository) private usersRepository: UsersRepository,
		private storage: VerificationStorageService,
		private moderationLogService: ModerationLogService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const application = await this.applicationsRepository.findOneBy({ id: ps.applicationId });
			if (application == null) throw new ApiError(meta.errors.noSuchApplication);
			const user = await this.usersRepository.findOneBy({ id: application.userId });
			if (user == null) throw new ApiError(meta.errors.noSuchApplication);
			const logViewAttempt = async (side: 'front' | 'back' | null, result: 'success' | 'failed') => {
				await this.moderationLogService.log(me, 'viewVerificationDocument', {
					applicationId: application.id,
					documentId: ps.documentId,
					userId: user.id,
					userUsername: user.username,
					userHost: user.host,
					side,
					result,
				});
			};
			const document = await this.documentsRepository.findOneBy({ id: ps.documentId, applicationId: application.id });
			if (document == null) {
				await logViewAttempt(null, 'failed').catch(() => undefined);
				throw new ApiError(meta.errors.noSuchDocument);
			}
			try {
				const data = await this.storage.read(document.storageKey);
				await logViewAttempt(document.side, 'success');
				return { mime: document.mime, data: data.toString('base64') };
			} catch {
				await logViewAttempt(document.side, 'failed').catch(() => undefined);
				throw new ApiError(meta.errors.noSuchDocument);
			}
		});
	}
}
