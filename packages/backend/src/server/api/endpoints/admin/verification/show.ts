/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { VerificationApplicationsRepository, VerificationDocumentsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { VERIFICATION_TYPES } from '@/verification-constants.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';

export const meta = {
	tags: ['admin', 'verification'], requireCredential: true, requireAdmin: true, kind: 'read:admin:show-user',
	errors: { noSuchApplication: { message: 'No such verification application.', code: 'NO_SUCH_VERIFICATION_APPLICATION', id: '1ec4d26a-a2c1-4d2a-bf2f-f22e55d2bf50' } },
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			id: { type: 'string', optional: false, nullable: false, format: 'misskey:id' },
			userId: { type: 'string', optional: false, nullable: false, format: 'misskey:id' },
			status: { type: 'string', optional: false, nullable: false, enum: ['pending', 'approved', 'rejected', 'revoked'] },
			requestedType: { type: 'string', enum: VERIFICATION_TYPES, optional: false, nullable: false },
			approvedType: { type: 'string', enum: VERIFICATION_TYPES, optional: false, nullable: true },
			description: { type: 'string', optional: false, nullable: false },
			contact: { type: 'string', optional: false, nullable: false },
			consentVersion: { type: 'string', optional: false, nullable: false },
			submittedAt: { type: 'string', optional: false, nullable: false, format: 'date-time' },
			reviewedAt: { type: 'string', optional: false, nullable: true, format: 'date-time' },
			reviewerId: { type: 'string', optional: false, nullable: true, format: 'misskey:id' },
			reviewReason: { type: 'string', optional: false, nullable: true },
			documents: {
				type: 'array', optional: false, nullable: false,
				items: {
					type: 'object', optional: false, nullable: false,
					properties: {
						id: { type: 'string', optional: false, nullable: false, format: 'misskey:id' },
						side: { type: 'string', optional: false, nullable: false, enum: ['front', 'back'] },
						mime: { type: 'string', optional: false, nullable: false },
						size: { type: 'integer', optional: false, nullable: false },
						sha256: { type: 'string', optional: false, nullable: false },
					},
				},
			},
		},
	},
} as const;
export const paramDef = { type: 'object', properties: { applicationId: { type: 'string', format: 'misskey:id' } }, required: ['applicationId'] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		@Inject(DI.verificationApplicationsRepository) private applicationsRepository: VerificationApplicationsRepository,
		@Inject(DI.verificationDocumentsRepository) private documentsRepository: VerificationDocumentsRepository,
		private moderationLogService: ModerationLogService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const application = await this.applicationsRepository.findOneBy({ id: ps.applicationId });
			if (application == null) throw new ApiError(meta.errors.noSuchApplication);
			const documents = await this.documentsRepository.find({ where: { applicationId: application.id }, order: { side: 'ASC' } });
			await this.moderationLogService.log(me, 'viewVerificationApplication', {
				applicationId: application.id,
				userId: application.userId,
				view: 'detail',
			});
			return {
				id: application.id,
				userId: application.userId,
				status: application.status,
				requestedType: application.requestedType,
				approvedType: application.approvedType,
				description: application.description,
				contact: application.contact,
				consentVersion: application.consentVersion,
				submittedAt: application.submittedAt.toISOString(),
				reviewedAt: application.reviewedAt?.toISOString() ?? null,
				reviewerId: application.reviewerId,
				reviewReason: application.reviewReason,
				documents: documents.map(document => ({ id: document.id, side: document.side, mime: document.mime, size: document.size, sha256: document.sha256 })),
			};
		});
	}
}
