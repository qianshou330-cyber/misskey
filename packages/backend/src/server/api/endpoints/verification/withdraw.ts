/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { VerificationApplicationsRepository } from '@/models/_.js';
import { MiVerificationApplication } from '@/models/VerificationApplication.js';
import { MiVerificationDocument } from '@/models/VerificationDocument.js';
import { MiRole } from '@/models/Role.js';
import { MiRoleAssignment } from '@/models/RoleAssignment.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { VerificationStorageService } from '@/core/VerificationStorageService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { LoggerService } from '@/core/LoggerService.js';
import type Logger from '@/logger.js';
import { VERIFICATION_ROLE_ID } from '@/verification-constants.js';

export const meta = {
	tags: ['verification'], requireCredential: true, kind: 'write:account',
	errors: {
		noApplication: { message: 'No verification application exists.', code: 'NO_VERIFICATION_APPLICATION', id: 'ca7b702a-e060-44dc-ae7d-95f68bcbbd4a' },
		invalidStatus: { message: 'This verification application cannot be withdrawn.', code: 'INVALID_VERIFICATION_STATUS', id: 'ad1f4cc8-e5b4-4f99-b70c-7a5f37b50f8f' },
	},
} as const;
export const paramDef = { type: 'object', properties: {}, required: [] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	private readonly logger: Logger;

	constructor(
		@Inject(DI.db) private db: DataSource,
		@Inject(DI.verificationApplicationsRepository) private applicationsRepository: VerificationApplicationsRepository,
		private storage: VerificationStorageService,
		private globalEventService: GlobalEventService,
		loggerService: LoggerService,
	) {
		super(meta, paramDef, async (_ps, me) => {
			const application = await this.applicationsRepository.findOneBy({ userId: me.id });
			if (application == null) throw new ApiError(meta.errors.noApplication);
			const roleAssignment = await this.db.transaction(async manager => {
				const applications = manager.getRepository(MiVerificationApplication);
				const documents = manager.getRepository(MiVerificationDocument);
				const lockedApplication = await applications.createQueryBuilder('application')
					.setLock('pessimistic_write')
					.where('application.id = :id', { id: application.id })
					.getOne();
				if (lockedApplication == null) throw new ApiError(meta.errors.noApplication);
				if (lockedApplication.status !== 'pending' && lockedApplication.status !== 'approved') {
					throw new ApiError(meta.errors.invalidStatus);
				}

				let assignment: MiRoleAssignment | null = null;
				if (lockedApplication.status === 'approved') {
					const assignments = manager.getRepository(MiRoleAssignment);
					assignment = await assignments.findOneBy({ userId: me.id, roleId: VERIFICATION_ROLE_ID });
					if (assignment != null) {
						await assignments.delete(assignment.id);
						await manager.getRepository(MiRole).update(VERIFICATION_ROLE_ID, { lastUsedAt: new Date() });
					}
				}

				const applicationDocuments = await documents.findBy({ applicationId: lockedApplication.id });
				await applications.update(lockedApplication.id, { status: 'revoked', reviewedAt: new Date(), reviewerId: null, reviewReason: 'Withdrawn by account owner.' });
				await documents.delete({ applicationId: lockedApplication.id });
				return { assignment, documents: applicationDocuments };
			});
			if (roleAssignment.assignment != null) this.globalEventService.publishInternalEvent('userRoleUnassigned', roleAssignment.assignment);
			await Promise.all(roleAssignment.documents.map(document => this.storage.delete(document.storageKey).catch(error => this.logger.warn(`Unable to remove withdrawn verification document ${document.id}: ${error}`))));
		});
		this.logger = loggerService.getLogger('verification');
	}
}
