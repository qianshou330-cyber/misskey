/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as Misskey from 'misskey-js';

export type ApkResourceStatus = 'draft' | 'pending' | 'published' | 'rejected';

export type ApkResource = {
	id: string;
	createdAt: string;
	updatedAt: string;
	userId: string;
	driveFileId: string;
	name: string;
	packageName: string | null;
	versionName: string | null;
	versionCode: number | null;
	description: string | null;
	screenshotFileIds: string[];
	screenshotFiles: Misskey.entities.DriveFile[];
	status: ApkResourceStatus;
	downloadCount: number;
	file: Misskey.entities.DriveFile;
};

export type ApkResourceDownload = {
	url: string;
	downloadCount: number;
};
