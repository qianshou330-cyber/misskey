/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { VerificationApplicationsRepository, VerificationDocumentsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { VERIFICATION_CONSENT_VERSION, VERIFICATION_TYPES } from '@/verification-constants.js';

export const meta = {
	tags: ['verification'], requireCredential: true, kind: 'read:account',
	res: {
		type: 'object', optional: false, nullable: true,
		properties: {
			id: { type: 'string', optional: false, nullable: false, format: 'misskey:id' },
			status: { type: 'string', optional: false, nullable: false, enum: ['pending', 'approved', 'rejected', 'revoked'] },
			requestedType: { type: 'string', enum: VERIFICATION_TYPES, optional: false, nullable: false },
			approvedType: { type: 'string', enum: VERIFICATION_TYPES, optional: false, nullable: true },
			description: { type: 'string', optional: false, nullable: false },
			contact: { type: 'string', optional: false, nullable: false },
			consentVersion: { type: 'string', optional: false, nullable: false },
			currentConsentVersion: { type: 'string', optional: false, nullable: false },
			submittedAt: { type: 'string', optional: false, nullable: false, format: 'date-time' },
			reviewedAt: { type: 'string', optional: false, nullable: true, format: 'date-time' },
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
export const paramDef = { type: 'object', properties: {}, required: [] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		@Inject(DI.verificationApplicationsRepository) private applicationsRepository: VerificationApplicationsRepository,
		@Inject(DI.verificationDocumentsRepository) private documentsRepository: VerificationDocumentsRepository,
	) {
		super(meta, paramDef, async (_ps, me) => {
			const application = await this.applicationsRepository.findOneBy({ userId: me.id });
			if (application == null) return null;
			const documents = await this.documentsRepository.find({ where: { applicationId: application.id }, order: { side: 'ASC' } });
			return {
				id: application.id,
				status: application.status,
				requestedType: application.requestedType,
				approvedType: application.approvedType,
				description: application.description,
				contact: application.contact,
				consentVersion: application.consentVersion,
				currentConsentVersion: VERIFICATION_CONSENT_VERSION,
				submittedAt: application.submittedAt.toISOString(),
				reviewedAt: application.reviewedAt?.toISOString() ?? null,
				reviewReason: application.reviewReason,
				documents: documents.map(document => ({ id: document.id, side: document.side, mime: document.mime, size: document.size, sha256: document.sha256 })),
			};
		});
	}
}
