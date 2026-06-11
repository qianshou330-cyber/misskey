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
import { packedApkResourceSchema, packApkResource } from '../../../../apk-resource-utils.js';

export const meta = {
	tags: ['admin', 'apk'],

	requireCredential: true,
	requireModerator: true,

	kind: 'read:admin:drive',

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: packedApkResourceSchema,
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
		sinceDate: { type: 'integer' },
		untilDate: { type: 'integer' },
		status: { type: 'string', enum: ['all', 'draft', 'pending', 'published', 'rejected'], default: 'pending' },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db)
		private db: DataSource,

		private queryService: QueryService,
		private driveFileEntityService: DriveFileEntityService,
	) {
		super(meta, paramDef, async (ps) => {
			const query = this.queryService.makePaginationQuery(this.db.getRepository(MiApkResource).createQueryBuilder('resource'), ps.sinceId, ps.untilId, ps.sinceDate, ps.untilDate)
				.innerJoinAndSelect('resource.driveFile', 'driveFile');

			if (ps.status !== 'all') {
				query.andWhere('resource.status = :status', { status: ps.status });
			}

			const resources = await query.limit(ps.limit).getMany();

			return await Promise.all(resources.map(resource => packApkResource(resource, this.driveFileEntityService)));
		});
	}
}
