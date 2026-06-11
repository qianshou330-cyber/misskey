/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { QueryService } from '@/core/QueryService.js';
import { DriveFileEntityService } from '@/core/entities/DriveFileEntityService.js';
import { MiApkResource } from '@/models/ApkResource.js';
import { MiApkResourceVersion } from '@/models/ApkResourceVersion.js';
import { ApiError } from '../../../error.js';
import { packedApkResourceVersionSchema, packApkResourceVersion } from '../../../apk-resource-utils.js';

export const meta = {
	tags: ['apk'],

	requireCredential: true,

	kind: 'read:drive',

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: packedApkResourceVersionSchema,
	},

	errors: {
		noSuchResource: {
			message: 'No such APK resource.',
			code: 'NO_SUCH_RESOURCE',
			id: '776c41d9-03a6-40c8-b219-05e1bc6779f4',
		},
		accessDenied: {
			message: 'Access denied.',
			code: 'ACCESS_DENIED',
			id: 'd0aa9985-6ed5-42ec-a55e-9458b96a8e60',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		resourceId: { type: 'string', format: 'misskey:id' },
		limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
	},
	required: ['resourceId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db)
		private db: DataSource,

		private queryService: QueryService,
		private driveFileEntityService: DriveFileEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const resource = await this.db.getRepository(MiApkResource).findOneBy({ id: ps.resourceId });

			if (resource == null) throw new ApiError(meta.errors.noSuchResource);
			if (resource.status !== 'published' && resource.userId !== me.id) throw new ApiError(meta.errors.accessDenied);

			const query = this.queryService.makePaginationQuery(this.db.getRepository(MiApkResourceVersion).createQueryBuilder('version'), ps.sinceId, ps.untilId)
				.innerJoinAndSelect('version.driveFile', 'driveFile')
				.andWhere('version.resourceId = :resourceId', { resourceId: resource.id });

			const versions = await query.limit(ps.limit).getMany();

			return await Promise.all(versions.map(version => packApkResourceVersion(version, this.driveFileEntityService)));
		});
	}
}
