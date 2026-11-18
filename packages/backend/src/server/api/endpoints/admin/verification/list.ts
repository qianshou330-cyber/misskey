/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { VerificationApplicationsRepository, VerificationDocumentsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { VERIFICATION_TYPES } from '@/verification-constants.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';

export const meta = {
	tags: ['admin', 'verification'], requireCredential: true, requireAdmin: true, kind: 'read:admin:show-user',
	res: {
		type: 'array', optional: false, nullable: false,
		items: {
			type: 'object', optional: false, nullable: false,
			properties: {
				id: { type: 'string', optional: false, nullable: false, format: 'misskey:id' },
				userId: { type: 'string', optional: false, nullable: false, format: 'misskey:id' },
				status: { type: 'string', optional: false, nullable: false, enum: ['pending', 'approved', 'rejected', 'revoked'] },
				requestedType: { type: 'string', enum: VERIFICATION_TYPES, optional: false, nullable: false },
				approvedType: { type: 'string', enum: VERIFICATION_TYPES, optional: false, nullable: true },
				description: { type: 'string', optional: false, nullable: false },
				contact: { type: 'string', optional: false, nullable: false },
				submittedAt: { type: 'string', optional: false, nullable: false, format: 'date-time' },
				reviewedAt: { type: 'string', optional: false, nullable: true, format: 'date-time' },
				reviewReason: { type: 'string', optional: false, nullable: true },
				documentCount: { type: 'integer', optional: false, nullable: false },
			},
		},
	},
} as const;
export const paramDef = {
	type: 'object',
	properties: {
		status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'revoked', 'all'], default: 'pending' },
		type: { type: 'string', enum: [...VERIFICATION_TYPES, null], nullable: true, default: null },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
		offset: { type: 'integer', minimum: 0, maximum: 100000, default: 0 },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		@Inject(DI.verificationApplicationsRepository) private applicationsRepository: VerificationApplicationsRepository,
		@Inject(DI.verificationDocumentsRepository) private documentsRepository: VerificationDocumentsRepository,
		private moderationLogService: ModerationLogService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const query = this.applicationsRepository.createQueryBuilder('application').orderBy('application.submittedAt', 'ASC').addOrderBy('application.id', 'ASC').skip(ps.offset ?? 0).take(ps.limit ?? 50);
			if (ps.status !== 'all') query.where('application.status = :status', { status: ps.status ?? 'pending' });
			if (ps.type != null) query.andWhere('application.requestedType = :type', { type: ps.type });
			const rows = await query.getMany();
			await Promise.all(rows.map(application => this.moderationLogService.log(me, 'viewVerificationApplication', {
				applicationId: application.id,
				userId: application.userId,
				view: 'list',
			})));
			return await Promise.all(rows.map(async application => ({
				id: application.id,
				userId: application.userId,
				status: application.status,
				requestedType: application.requestedType,
				approvedType: application.approvedType,
				description: application.description,
				contact: application.contact,
				submittedAt: application.submittedAt.toISOString(),
				reviewedAt: application.reviewedAt?.toISOString() ?? null,
				reviewReason: application.reviewReason,
				documentCount: await this.documentsRepository.countBy({ applicationId: application.id }),
			})));
		});
	}
}
