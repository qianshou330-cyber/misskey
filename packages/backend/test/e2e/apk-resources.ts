/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'assert';
import { describe, beforeAll, test } from 'vitest';
import { api, castAsError, signup, uploadFile } from '../utils.js';
import type * as misskey from 'misskey-js';

type ApkResource = {
	id: string;
	status: 'draft' | 'pending' | 'published' | 'rejected';
	driveFileId: string;
	downloadCount: number;
	name: string;
};

describe('APK resources', () => {
	let alice: misskey.entities.SignupResponse;
	let bob: misskey.entities.SignupResponse;
	let apkFile: misskey.entities.DriveFile;
	let screenshotFile: misskey.entities.DriveFile;

	beforeAll(async () => {
		alice = await signup({ username: 'alice' });
		bob = await signup({ username: 'bob' });

		const apkUpload = await uploadFile(alice, {
			blob: new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], {
				type: 'application/vnd.android.package-archive',
			}),
			name: 'nexushub-smoke.apk',
		});
		assert.strictEqual(apkUpload.status, 200);
		assert.ok(apkUpload.body);
		apkFile = apkUpload.body;

		const screenshotUpload = await uploadFile(alice, {
			path: '192.png',
			name: 'nexushub-smoke.png',
		});
		assert.strictEqual(screenshotUpload.status, 200);
		assert.ok(screenshotUpload.body);
		screenshotFile = screenshotUpload.body;
	}, 1000 * 60 * 2);

	test('resource review flow and visibility rules', async () => {
		const created = await api('apk/resources/create', {
			driveFileId: apkFile.id,
			name: 'NexusHub Smoke APK',
			packageName: 'com.nexushub.smoke',
			versionName: '1.0.0',
			versionCode: 1,
			description: 'smoke test resource',
			screenshotFileIds: [screenshotFile.id],
		}, alice);
		assert.strictEqual(created.status, 200);
		const resource = created.body as ApkResource;
		assert.strictEqual(resource.status, 'pending');
		assert.strictEqual(resource.downloadCount, 0);

		const hiddenFromOtherUser = await api('apk/resources/show', {
			resourceId: resource.id,
		}, bob);
		assert.strictEqual(hiddenFromOtherUser.status, 400);
		assert.strictEqual(castAsError(hiddenFromOtherUser.body as any).error.code, 'ACCESS_DENIED');

		const ownerPendingDownload = await api('apk/resources/download', {
			resourceId: resource.id,
		}, alice);
		assert.strictEqual(ownerPendingDownload.status, 200);
		assert.strictEqual(ownerPendingDownload.body.downloadCount, 0);

		const published = await api('admin/apk/resources/update-status', {
			resourceId: resource.id,
			status: 'published',
		}, alice);
		assert.strictEqual(published.status, 200);
		assert.strictEqual((published.body as ApkResource).status, 'published');

		const visibleToOtherUser = await api('apk/resources/show', {
			resourceId: resource.id,
		}, bob);
		assert.strictEqual(visibleToOtherUser.status, 200);
		assert.strictEqual((visibleToOtherUser.body as ApkResource).id, resource.id);

		const otherUserDownload = await api('apk/resources/download', {
			resourceId: resource.id,
		}, bob);
		assert.strictEqual(otherUserDownload.status, 200);
		assert.strictEqual(otherUserDownload.body.downloadCount, 1);

		const rejected = await api('admin/apk/resources/update-status', {
			resourceId: resource.id,
			status: 'rejected',
		}, alice);
		assert.strictEqual(rejected.status, 200);
		assert.strictEqual((rejected.body as ApkResource).status, 'rejected');

		const resubmitted = await api('apk/resources/update', {
			resourceId: resource.id,
			name: 'NexusHub Smoke APK Resubmitted',
			versionName: '1.0.1',
			versionCode: 2,
			screenshotFileIds: [screenshotFile.id],
		}, alice);
		assert.strictEqual(resubmitted.status, 200);
		assert.strictEqual((resubmitted.body as ApkResource).status, 'pending');

		const deleted = await api('admin/apk/resources/delete', {
			resourceId: resource.id,
		}, alice);
		assert.strictEqual(deleted.status, 200);

		const driveFileStillExists = await api('drive/files/show', {
			fileId: apkFile.id,
		}, alice);
		assert.strictEqual(driveFileStillExists.status, 200);
		assert.strictEqual(driveFileStillExists.body.id, apkFile.id);
	});
});
