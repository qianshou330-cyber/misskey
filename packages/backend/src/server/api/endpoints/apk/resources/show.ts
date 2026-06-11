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
import { ApiError } from '../../../error.js';
import { packedApkResourceSchema, packApkResource } from '../../../apk-resource-utils.js';

export const meta = {
	tags: ['apk'],

	requireCredential: true,

	kind: 'read:drive',

	res: packedApkResourceSchema,

	errors: {
		noSuchResource: {
			message: 'No such APK resource.',
			code: 'NO_SUCH_RESOURCE',
			id: '7df795e8-fbd2-4c3e-ad92-0d62867a970e',
		},
		accessDenied: {
			message: 'Access denied.',
			code: 'ACCESS_DENIED',
			id: 'a9407d29-bf9a-4f07-9e93-384146740a9c',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		resourceId: { type: 'string', format: 'misskey:id' },
	},
	required: ['resourceId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db)
		private db: DataSource,

		private driveFileEntityService: DriveFileEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const resource = await this.db.getRepository(MiApkResource).findOne({
				where: { id: ps.resourceId },
				relations: { driveFile: true },
			});

			if (resource == null) throw new ApiError(meta.errors.noSuchResource);
			if (resource.status !== 'published' && resource.userId !== me.id) throw new ApiError(meta.errors.accessDenied);

			return await packApkResource(resource, this.driveFileEntityService);
		});
	}
}
