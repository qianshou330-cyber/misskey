/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { MiApkResource } from '@/models/ApkResource.js';
import type { MiApkResourceVersion } from '@/models/ApkResourceVersion.js';
import type { MiDriveFile } from '@/models/DriveFile.js';
import { DriveFileEntityService } from '@/core/entities/DriveFileEntityService.js';

export const APK_MIME = 'application/vnd.android.package-archive';
export const APK_MAX_BYTES = 200 * 1024 * 1024;
const APK_PACKAGE_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

export function isApkDriveFile(file: MiDriveFile): boolean {
	return file.name.toLowerCase().endsWith('.apk') || file.type === APK_MIME;
}

export function isScreenshotDriveFile(file: MiDriveFile): boolean {
	return file.type.startsWith('image/');
}

export function isValidPackageName(packageName: string): boolean {
	return APK_PACKAGE_NAME_RE.test(packageName);
}

export const packedApkResourceSchema = {
	type: 'object',
	optional: false,
	nullable: false,
	properties: {
		id: { type: 'string', optional: false, nullable: false, format: 'id' },
		createdAt: { type: 'string', optional: false, nullable: false, format: 'date-time' },
		updatedAt: { type: 'string', optional: false, nullable: false, format: 'date-time' },
		userId: { type: 'string', optional: false, nullable: false, format: 'id' },
		driveFileId: { type: 'string', optional: false, nullable: false, format: 'id' },
		name: { type: 'string', optional: false, nullable: false },
		packageName: { type: 'string', optional: false, nullable: true },
		versionName: { type: 'string', optional: false, nullable: true },
		versionCode: { type: 'number', optional: false, nullable: true },
		description: { type: 'string', optional: false, nullable: true },
		screenshotFileIds: {
			type: 'array',
			optional: false,
			nullable: false,
			items: { type: 'string', optional: false, nullable: false, format: 'id' },
		},
		status: { type: 'string', optional: false, nullable: false },
		downloadCount: { type: 'number', optional: false, nullable: false },
		reviewerId: { type: 'string', optional: false, nullable: true, format: 'id' },
		reviewedAt: { type: 'string', optional: false, nullable: true, format: 'date-time' },
		reviewNote: { type: 'string', optional: false, nullable: true },
		rejectionReason: { type: 'string', optional: false, nullable: true },
		file: {
			type: 'object',
			optional: false,
			nullable: false,
			ref: 'DriveFile',
		},
		screenshotFiles: {
			type: 'array',
			optional: false,
			nullable: false,
			items: {
				type: 'object',
				optional: false,
				nullable: false,
				ref: 'DriveFile',
			},
		},
	},
} as const;

export const packedApkResourceVersionSchema = {
	type: 'object',
	optional: false,
	nullable: false,
	properties: {
		id: { type: 'string', optional: false, nullable: false, format: 'id' },
		createdAt: { type: 'string', optional: false, nullable: false, format: 'date-time' },
		resourceId: { type: 'string', optional: false, nullable: false, format: 'id' },
		driveFileId: { type: 'string', optional: false, nullable: false, format: 'id' },
		versionName: { type: 'string', optional: false, nullable: true },
		versionCode: { type: 'number', optional: false, nullable: true },
		changelog: { type: 'string', optional: false, nullable: true },
		file: {
			type: 'object',
			optional: false,
			nullable: false,
			ref: 'DriveFile',
		},
	},
} as const;

export async function packApkResource(
	resource: MiApkResource,
	driveFileEntityService: DriveFileEntityService,
) {
	const driveFile = resource.driveFile ?? resource.driveFileId;

	return {
		id: resource.id,
		createdAt: resource.updatedAt.toISOString(),
		updatedAt: resource.updatedAt.toISOString(),
		userId: resource.userId,
		driveFileId: resource.driveFileId,
		name: resource.name,
		packageName: resource.packageName,
		versionName: resource.versionName,
		versionCode: resource.versionCode,
		description: resource.description,
		screenshotFileIds: resource.screenshotFileIds,
		status: resource.status,
		downloadCount: resource.downloadCount,
		reviewerId: resource.reviewerId,
		reviewedAt: resource.reviewedAt?.toISOString() ?? null,
		reviewNote: resource.reviewNote,
		rejectionReason: resource.rejectionReason,
		file: await driveFileEntityService.pack(driveFile, {
			detail: true,
			withUser: true,
			self: false,
		}),
		screenshotFiles: await driveFileEntityService.packManyByIds(resource.screenshotFileIds, {
			detail: false,
			self: false,
		}),
	};
}

export async function packApkResourceVersion(
	version: MiApkResourceVersion,
	driveFileEntityService: DriveFileEntityService,
) {
	const driveFile = version.driveFile ?? version.driveFileId;

	return {
		id: version.id,
		createdAt: version.createdAt.toISOString(),
		resourceId: version.resourceId,
		driveFileId: version.driveFileId,
		versionName: version.versionName,
		versionCode: version.versionCode,
		changelog: version.changelog,
		file: await driveFileEntityService.pack(driveFile, {
			detail: true,
			withUser: true,
			self: false,
		}),
	};
}
