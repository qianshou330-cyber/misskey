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
		noSuchApplication: { message: 'No such verification application.', code: 'NO_SUCH_VERIFICATION_APPLICATION', id: 'e9fd8f78-9163-406c-bf00-6b6aab2b6b25' },
		invalidStatus: { message: 'Only an approved verification can be revoked.', code: 'INVALID_VERIFICATION_STATUS', id: 'b2dc5895-9a3c-40d2-92a4-0aec5b3b9e5f' },
		invalidRole: { message: 'The verification badge role is not configured safely.', code: 'INVALID_VERIFICATION_ROLE', id: '7fdb72bd-6c46-4ebc-8f06-2bb2ebaf7d6f' },
	},
} as const;
export const paramDef = { type: 'object', properties: { applicationId: { type: 'string', format: 'misskey:id' }, reason: { type: 'string', maxLength: 512, nullable: true } }, required: ['applicationId'] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(private verificationService: VerificationService) {
		super(meta, paramDef, async (ps, me) => {
			try {
				await this.verificationService.review(ps.applicationId, 'revoke', me, ps.reason?.trim() || null);
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
