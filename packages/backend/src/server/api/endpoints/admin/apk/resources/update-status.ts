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
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		resourceId: { type: 'string', format: 'misskey:id' },
		status: { type: 'string', enum: ['pending', 'published', 'rejected'] },
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
		super(meta, paramDef, async (ps) => {
			const repository = this.db.getRepository(MiApkResource);
			const resource = await repository.findOne({
				where: { id: ps.resourceId },
				relations: { driveFile: true },
			});

			if (resource == null) throw new ApiError(meta.errors.noSuchResource);

			resource.status = ps.status;
			resource.updatedAt = new Date();

			const saved = await repository.save(resource);
			return await packApkResource(saved, this.driveFileEntityService);
		});
	}
}
