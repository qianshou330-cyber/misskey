/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Index, JoinColumn, Column, PrimaryColumn, ManyToOne } from 'typeorm';
import { id } from './util/id.js';
import { MiApkResource } from './ApkResource.js';
import { MiDriveFile } from './DriveFile.js';

@Entity('apk_resource_version')
export class MiApkResourceVersion {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column('timestamp with time zone')
	public createdAt: Date;

	@Index()
	@Column({
		...id(),
		comment: 'The APK resource ID.',
	})
	public resourceId: MiApkResource['id'];

	@ManyToOne(() => MiApkResource, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public resource: MiApkResource | null;

	@Column({
		...id(),
		comment: 'The DriveFile ID of the APK binary for this version.',
	})
	public driveFileId: MiDriveFile['id'];

	@ManyToOne(() => MiDriveFile, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public driveFile: MiDriveFile | null;

	@Column('varchar', {
		length: 128, nullable: true,
	})
	public versionName: string | null;

	@Column('integer', {
		nullable: true,
	})
	public versionCode: number | null;

	@Column('varchar', {
		length: 2048, nullable: true,
	})
	public changelog: string | null;

	constructor(data: Partial<MiApkResourceVersion>) {
		if (data == null) return;

		for (const [k, v] of Object.entries(data)) {
			(this as any)[k] = v;
		}
	}
}
