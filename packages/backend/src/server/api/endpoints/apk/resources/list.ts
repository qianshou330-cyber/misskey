/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Brackets, DataSource } from 'typeorm';
import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { QueryService } from '@/core/QueryService.js';
import { DriveFileEntityService } from '@/core/entities/DriveFileEntityService.js';
import { MiApkResource } from '@/models/ApkResource.js';
import { packedApkResourceSchema, packApkResource } from '../../../apk-resource-utils.js';

export const meta = {
	tags: ['apk'],

	requireCredential: true,

	kind: 'read:drive',

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
		super(meta, paramDef, async (ps, me) => {
			const query = this.queryService.makePaginationQuery(this.db.getRepository(MiApkResource).createQueryBuilder('resource'), ps.sinceId, ps.untilId, ps.sinceDate, ps.untilDate)
				.innerJoinAndSelect('resource.driveFile', 'driveFile')
				.andWhere(new Brackets(qb => {
					qb.where('resource.status = :status', { status: 'published' })
						.orWhere('resource.userId = :userId', { userId: me.id });
				}));

			const resources = await query.limit(ps.limit).getMany();

			return await Promise.all(resources.map(resource => packApkResource(resource, this.driveFileEntityService)));
		});
	}
}
