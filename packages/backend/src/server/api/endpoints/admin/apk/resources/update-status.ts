/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DriveFileEntityService } from '@/core/entities/DriveFileEntityService.js';
import { MiApkResource } from '@/models/ApkResource.js';
import { ApiError } from '../../../../error.js';
import { packedApkResourceSchema, packApkResource } from '../../../../apk-resource-utils.js';

export const meta = {
	tags: ['admin', 'apk'],

	requireCredential: true,
	requireModerator: true,

	kind: 'write:admin:drive',

	res: packedApkResourceSchema,

	errors: {
		noSuchResource: {
			message: 'No such APK resource.',
			code: 'NO_SUCH_RESOURCE',
			id: '9cfcd9ac-91d9-4d57-8f29-86bb5be70b4e',
		},
		rejectionReasonRequired: {
			message: 'Rejection reason is required.',
			code: 'REJECTION_REASON_REQUIRED',
			id: 'f31a2929-04ce-43db-bb70-c04578472999',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		resourceId: { type: 'string', format: 'misskey:id' },
		status: { type: 'string', enum: ['pending', 'published', 'rejected'] },
		rejectionReason: { type: 'string', nullable: true, maxLength: 2048 },
		reviewNote: { type: 'string', nullable: true, maxLength: 2048 },
	},
	required: ['resourceId', 'status'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db)
		private db: DataSource,

		private driveFileEntityService: DriveFileEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const repository = this.db.getRepository(MiApkResource);
			const resource = await repository.findOne({
				where: { id: ps.resourceId },
				relations: { driveFile: true },
			});

			if (resource == null) throw new ApiError(meta.errors.noSuchResource);
			if (ps.status === 'rejected' && !ps.rejectionReason?.trim()) throw new ApiError(meta.errors.rejectionReasonRequired);

			resource.status = ps.status;
			resource.updatedAt = new Date();
			resource.reviewerId = me.id;
			resource.reviewedAt = new Date();
			resource.reviewNote = ps.reviewNote?.trim() || null;
			resource.rejectionReason = ps.status === 'rejected' ? ps.rejectionReason?.trim() ?? null : null;

			const saved = await repository.save(resource);
			return await packApkResource(saved, this.driveFileEntityService);
		});
	}
}
