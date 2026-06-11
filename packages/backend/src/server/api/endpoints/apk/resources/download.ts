/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { MiApkResource } from '@/models/ApkResource.js';
import { ApiError } from '../../../error.js';

export const meta = {
	tags: ['apk'],

	requireCredential: true,

	kind: 'read:drive',

	res: {
		type: 'object',
		optional: false,
		nullable: false,
		properties: {
			url: { type: 'string', optional: false, nullable: false },
			downloadCount: { type: 'number', optional: false, nullable: false },
		},
	},

	errors: {
		noSuchResource: {
			message: 'No such APK resource.',
			code: 'NO_SUCH_RESOURCE',
			id: '41e61799-d4b8-4ce4-9f5d-b29a82d75e57',
		},
		accessDenied: {
			message: 'Access denied.',
			code: 'ACCESS_DENIED',
			id: '8fc469c6-5772-4477-a3b6-52d4d6fabf8f',
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
	) {
		super(meta, paramDef, async (ps, me) => {
			const repository = this.db.getRepository(MiApkResource);
			const resource = await repository.findOne({
				where: { id: ps.resourceId },
				relations: { driveFile: true },
			});

			if (resource == null || resource.driveFile == null) throw new ApiError(meta.errors.noSuchResource);
			if (resource.status !== 'published' && resource.userId !== me.id) throw new ApiError(meta.errors.accessDenied);

			const shouldCountDownload = resource.status === 'published';
			if (shouldCountDownload) {
				await repository.increment({ id: resource.id }, 'downloadCount', 1);
			}

			return {
				url: resource.driveFile.url,
				downloadCount: shouldCountDownload ? resource.downloadCount + 1 : resource.downloadCount,
			};
		});
	}
}
