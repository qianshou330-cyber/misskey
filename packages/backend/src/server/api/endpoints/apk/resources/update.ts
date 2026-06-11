/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import ms from 'ms';
import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DriveFileEntityService } from '@/core/entities/DriveFileEntityService.js';
import { MiApkResource } from '@/models/ApkResource.js';
import { MiDriveFile } from '@/models/DriveFile.js';
import { ApiError } from '../../../error.js';
import { packedApkResourceSchema, packApkResource, isScreenshotDriveFile } from '../../../apk-resource-utils.js';

export const meta = {
	tags: ['apk'],

	requireCredential: true,

	kind: 'write:drive',

	limit: {
		duration: ms('1hour'),
		max: 300,
	},

	res: packedApkResourceSchema,

	errors: {
		noSuchResource: {
			message: 'No such APK resource.',
			code: 'NO_SUCH_RESOURCE',
			id: 'bbfb9b6c-73ae-4382-ae6d-d173e77ad0f9',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		resourceId: { type: 'string', format: 'misskey:id' },
		name: { type: 'string', minLength: 1, maxLength: 256 },
		packageName: { type: 'string', nullable: true, maxLength: 256 },
		versionName: { type: 'string', nullable: true, maxLength: 128 },
		versionCode: { type: 'integer', nullable: true, minimum: 0 },
		description: { type: 'string', nullable: true, maxLength: 2048 },
		screenshotFileIds: { type: 'array', uniqueItems: true, maxItems: 8, items: {
			type: 'string', format: 'misskey:id',
		} },
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
			const repository = this.db.getRepository(MiApkResource);
			const resource = await repository.findOne({
				where: { id: ps.resourceId, userId: me.id },
				relations: { driveFile: true },
			});

			if (resource == null) throw new ApiError(meta.errors.noSuchResource);

			resource.updatedAt = new Date();
			if (resource.status === 'rejected') {
				resource.status = 'pending';
				resource.reviewerId = null;
				resource.reviewedAt = null;
				resource.reviewNote = null;
				resource.rejectionReason = null;
			}
			resource.name = ps.name ?? resource.name;
			resource.packageName = ps.packageName === undefined ? resource.packageName : ps.packageName;
			resource.versionName = ps.versionName === undefined ? resource.versionName : ps.versionName;
			resource.versionCode = ps.versionCode === undefined ? resource.versionCode : ps.versionCode;
			resource.description = ps.description === undefined ? resource.description : ps.description;
			if (ps.screenshotFileIds !== undefined) {
				const filesRepository = this.db.getRepository(MiDriveFile);
				const screenshotFiles = (await Promise.all(ps.screenshotFileIds.map(fileId =>
					filesRepository.findOneBy({
						id: fileId,
						userId: me.id,
					}),
				))).filter((file): file is MiDriveFile => file != null && isScreenshotDriveFile(file));
				resource.screenshotFileIds = screenshotFiles.map(file => file.id);
			}

			const saved = await repository.save(resource);
			return await packApkResource(saved, this.driveFileEntityService);
		});
	}
}
