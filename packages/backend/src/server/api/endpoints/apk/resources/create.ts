/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import ms from 'ms';
import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { IdService } from '@/core/IdService.js';
import { DriveFileEntityService } from '@/core/entities/DriveFileEntityService.js';
import { MiApkResource } from '@/models/ApkResource.js';
import { MiDriveFile } from '@/models/DriveFile.js';
import { ApiError } from '../../../error.js';
import { isApkDriveFile, isScreenshotDriveFile, packApkResource, packedApkResourceSchema } from '../../../apk-resource-utils.js';

export const meta = {
	tags: ['apk'],

	requireCredential: true,

	kind: 'write:drive',

	limit: {
		duration: ms('1hour'),
		max: 60,
	},

	res: packedApkResourceSchema,

	errors: {
		noSuchFile: {
			message: 'No such file.',
			code: 'NO_SUCH_FILE',
			id: 'f9dbbd24-6d44-4f9e-90c4-91fc32278976',
		},
		unsupportedFileType: {
			message: 'Unsupported file type.',
			code: 'UNSUPPORTED_FILE_TYPE',
			id: '78e631f8-2d2e-4e74-ae7a-0a6455a18d34',
		},
		alreadyExists: {
			message: 'APK resource already exists for this file.',
			code: 'ALREADY_EXISTS',
			id: 'e66d797e-bff6-4c25-b0a6-d8a41104e30d',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		driveFileId: { type: 'string', format: 'misskey:id' },
		name: { type: 'string', minLength: 1, maxLength: 256 },
		packageName: { type: 'string', nullable: true, maxLength: 256 },
		versionName: { type: 'string', nullable: true, maxLength: 128 },
		versionCode: { type: 'integer', nullable: true, minimum: 0 },
		description: { type: 'string', nullable: true, maxLength: 2048 },
		screenshotFileIds: { type: 'array', uniqueItems: true, maxItems: 8, items: {
			type: 'string', format: 'misskey:id',
		} },
	},
	required: ['driveFileId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db)
		private db: DataSource,

		private idService: IdService,
		private driveFileEntityService: DriveFileEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const filesRepository = this.db.getRepository(MiDriveFile);
			const resourcesRepository = this.db.getRepository(MiApkResource);

			const file = await filesRepository.findOneBy({ id: ps.driveFileId, userId: me.id });
			if (file == null) throw new ApiError(meta.errors.noSuchFile);
			if (!isApkDriveFile(file)) throw new ApiError(meta.errors.unsupportedFileType);

			const exists = await resourcesRepository.existsBy({ driveFileId: file.id });
			if (exists) throw new ApiError(meta.errors.alreadyExists);

			const screenshotFiles = ps.screenshotFileIds == null ? [] : (await Promise.all(ps.screenshotFileIds.map(fileId =>
				filesRepository.findOneBy({
					id: fileId,
					userId: me.id,
				}),
			))).filter((file): file is MiDriveFile => file != null && isScreenshotDriveFile(file));

			const resource = await resourcesRepository.save(new MiApkResource({
				id: this.idService.gen(),
				updatedAt: new Date(),
				userId: me.id,
				driveFileId: file.id,
				driveFile: file,
				name: ps.name ?? file.name.replace(/\.apk$/i, ''),
				packageName: ps.packageName ?? null,
				versionName: ps.versionName ?? null,
				versionCode: ps.versionCode ?? null,
				description: ps.description ?? null,
				screenshotFileIds: screenshotFiles.map(file => file.id),
				status: 'pending',
				downloadCount: 0,
			}));

			return await packApkResource(resource, this.driveFileEntityService);
		});
	}
}
