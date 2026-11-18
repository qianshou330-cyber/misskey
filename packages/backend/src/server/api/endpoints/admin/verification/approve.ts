/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { VerificationService, VerificationServiceError } from '@/core/VerificationService.js';
import { VERIFICATION_TYPES } from '@/verification-constants.js';

export const meta = {
	tags: ['admin', 'verification'], requireCredential: true, requireAdmin: true, kind: 'write:admin:roles',
	errors: {
		noSuchApplication: { message: 'No such verification application.', code: 'NO_SUCH_VERIFICATION_APPLICATION', id: 'a2d8e8b3-9f8d-4cf4-85e6-4e6d3d6a8e32' },
		invalidStatus: { message: 'This verification application has already been reviewed.', code: 'INVALID_VERIFICATION_STATUS', id: 'd2e1f438-7af8-44e5-97f8-0b9d65ff6e8c' },
		incompleteDocuments: { message: 'Two verification documents are required.', code: 'INCOMPLETE_VERIFICATION_DOCUMENTS', id: 'e97a6ee0-1a04-4d7d-a4ea-116c8b0c0dc8' },
		invalidRole: { message: 'The verification badge role is not configured safely.', code: 'INVALID_VERIFICATION_ROLE', id: '96a4d9f0-9244-4d6f-8e31-3f4d3bff51d8' },
	},
} as const;
export const paramDef = { type: 'object', properties: { applicationId: { type: 'string', format: 'misskey:id' }, approvedType: { type: 'string', enum: [...VERIFICATION_TYPES, null], nullable: true }, reason: { type: 'string', maxLength: 512, nullable: true } }, required: ['applicationId'] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(private verificationService: VerificationService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				await this.verificationService.review(ps.applicationId, 'approve', me, ps.reason?.trim() || null, ps.approvedType ?? undefined);
			} catch (error) {
				if (error instanceof VerificationServiceError) {
					if (error.code === 'NO_SUCH_APPLICATION') throw new ApiError(meta.errors.noSuchApplication);
					if (error.code === 'INCOMPLETE_DOCUMENTS') throw new ApiError(meta.errors.incompleteDocuments);
					if (error.code === 'INVALID_ROLE') throw new ApiError(meta.errors.invalidRole);
					throw new ApiError(meta.errors.invalidStatus);
				}
				throw error;
			}
		});
	}
}
