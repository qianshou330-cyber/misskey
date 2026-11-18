/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In, IsNull } from 'typeorm';
import type { VerificationApplicationsRepository, VerificationDocumentsRepository } from '@/models/_.js';
import { MiVerificationApplication } from '@/models/VerificationApplication.js';
import { MiVerificationDocument } from '@/models/VerificationDocument.js';
import { DI } from '@/di-symbols.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { IdService } from '@/core/IdService.js';
import { VerificationStorageService } from '@/core/VerificationStorageService.js';
import { LoggerService } from '@/core/LoggerService.js';
import type Logger from '@/logger.js';
import { VERIFICATION_CONSENT_VERSION, VERIFICATION_TYPES } from '@/verification-constants.js';

export const meta = {
	tags: ['verification'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:account',
	limit: { duration: 1000 * 60 * 60 * 24, max: 3 },
	errors: {
		invalid: { message: 'The verification application is invalid.', code: 'INVALID_VERIFICATION_APPLICATION', id: '0b0b0e58-7f0f-4b7e-97fc-54aa42b78e9f' },
		alreadyPending: { message: 'A verification application is already pending.', code: 'VERIFICATION_ALREADY_PENDING', id: '4f90d369-7f2d-4d53-a5bd-fc9d6681c09a' },
		alreadyApproved: { message: 'Your account is already verified.', code: 'ALREADY_VERIFIED', id: 'c5a7ee4e-4a8b-49a3-a4b9-befb9bc8f4a4' },
	},
	res: { type: 'object', optional: false, nullable: false, properties: { id: { type: 'string', optional: false, nullable: false, format: 'misskey:id' }, status: { type: 'string', optional: false, nullable: false, enum: ['pending'] } } },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		documentIds: { type: 'array', minItems: 2, maxItems: 2, uniqueItems: true, items: { type: 'string', format: 'misskey:id' } },
		type: { type: 'string', enum: VERIFICATION_TYPES },
		description: { type: 'string', minLength: 1, maxLength: 2000 },
		contact: { type: 'string', minLength: 1, maxLength: 512 },
		consentVersion: { type: 'string', maxLength: 64 },
	},
	required: ['documentIds', 'type', 'description', 'contact', 'consentVersion'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	private readonly logger: Logger;

	constructor(
		@Inject(DI.verificationApplicationsRepository)
		private applicationsRepository: VerificationApplicationsRepository,

		@Inject(DI.verificationDocumentsRepository)
		private documentsRepository: VerificationDocumentsRepository,

		private idService: IdService,
		private storage: VerificationStorageService,
		loggerService: LoggerService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (ps.consentVersion !== VERIFICATION_CONSENT_VERSION) throw new ApiError(meta.errors.invalid);
			const description = ps.description.trim();
			const contact = ps.contact.trim();
			if (description.length === 0 || contact.length === 0) throw new ApiError(meta.errors.invalid);

			const result = await this.applicationsRepository.manager.transaction(async manager => {
				const applications = manager.getRepository(MiVerificationApplication);
				const documents = manager.getRepository(MiVerificationDocument);
				const existing = await applications.findOne({ where: { userId: me.id }, lock: { mode: 'pessimistic_write' } });
				if (existing?.status === 'pending') throw new ApiError(meta.errors.alreadyPending);
				if (existing?.status === 'approved') throw new ApiError(meta.errors.alreadyApproved);

				const documentsToAttach = await documents.createQueryBuilder('document')
					.setLock('pessimistic_write')
					.where('document.id IN (:...documentIds)', { documentIds: ps.documentIds })
					.andWhere('document.userId = :userId', { userId: me.id })
					.andWhere('document.applicationId IS NULL')
					.getMany();
				if (documentsToAttach.length !== 2 || new Set(documentsToAttach.map(doc => doc.side)).size !== 2) throw new ApiError(meta.errors.invalid);

				let application: MiVerificationApplication;
				let oldDocuments: MiVerificationDocument[] = [];
				if (existing == null) {
					application = applications.create({
						id: this.idService.gen(),
						userId: me.id,
						requestedType: ps.type,
						approvedType: null,
						description,
						contact,
						consentVersion: ps.consentVersion,
						consentedAt: new Date(),
						status: 'pending',
						submittedAt: new Date(),
						reviewedAt: null,
						reviewerId: null,
						reviewReason: null,
					});
					await applications.insert(application);
				} else {
					application = existing;
					oldDocuments = await documents.findBy({ applicationId: existing.id });
					await applications.update(existing.id, {
						requestedType: ps.type,
						approvedType: null,
						description,
						contact,
						consentVersion: ps.consentVersion,
						consentedAt: new Date(),
						status: 'pending',
						submittedAt: new Date(),
						reviewedAt: null,
						reviewerId: null,
						reviewReason: null,
					});
					await documents.delete({ applicationId: existing.id });
				}

				const updateResult = await documents.update({
					id: In(ps.documentIds),
					userId: me.id,
					applicationId: IsNull(),
				}, { applicationId: application.id });
				if (updateResult.affected !== 2) throw new ApiError(meta.errors.invalid);
				return { applicationId: application.id, oldDocuments };
			});

			await Promise.all(result.oldDocuments.map(document => this.storage.delete(document.storageKey).catch(error => this.logger.warn(`Unable to remove replaced verification document ${document.id}: ${error}`))));
			return { id: result.applicationId, status: 'pending' as const };
		});
		this.logger = loggerService.getLogger('verification');
	}
}
