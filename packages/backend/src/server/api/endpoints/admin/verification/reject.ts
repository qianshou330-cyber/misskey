/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { VerificationService, VerificationServiceError } from '@/core/VerificationService.js';

export const meta = {
	tags: ['admin', 'verification'], requireCredential: true, requireAdmin: true, kind: 'write:admin:roles',
	errors: {
		noSuchApplication: { message: 'No such verification application.', code: 'NO_SUCH_VERIFICATION_APPLICATION', id: 'b3ef6ce9-8758-4c24-93a4-3d7bdf4bc72d' },
		invalidStatus: { message: 'This verification application has already been reviewed.', code: 'INVALID_VERIFICATION_STATUS', id: '4a9e00a4-44d3-4e29-b3ef-3e92030d9e11' },
		invalidRole: { message: 'The verification badge role is not configured safely.', code: 'INVALID_VERIFICATION_ROLE', id: 'e7cb6d1a-0c00-4eaf-8f8a-d8ce9ee356d8' },
	},
} as const;
export const paramDef = { type: 'object', properties: { applicationId: { type: 'string', format: 'misskey:id' }, reason: { type: 'string', maxLength: 512, nullable: true } }, required: ['applicationId'] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(private verificationService: VerificationService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				await this.verificationService.review(ps.applicationId, 'reject', me, ps.reason?.trim() || null);
			} catch (error) {
				if (error instanceof VerificationServiceError) {
					if (error.code === 'NO_SUCH_APPLICATION') throw new ApiError(meta.errors.noSuchApplication);
					if (error.code === 'INVALID_ROLE') throw new ApiError(meta.errors.invalidRole);
					throw new ApiError(meta.errors.invalidStatus);
				}
				throw error;
			}
		});
	}
}
