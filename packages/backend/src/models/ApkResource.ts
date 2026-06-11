/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Index, JoinColumn, Column, PrimaryColumn, ManyToOne } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiDriveFile } from './DriveFile.js';

export type MiApkResourceStatus = 'draft' | 'pending' | 'published' | 'rejected';

@Entity('apk_resource')
export class MiApkResource {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column('timestamp with time zone')
	public updatedAt: Date;

	@Index()
	@Column({
		...id(),
		comment: 'The ID of owner.',
	})
	public userId: MiUser['id'];

	@ManyToOne(() => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user: MiUser | null;

	@Index({ unique: true })
	@Column({
		...id(),
		comment: 'The DriveFile ID of the APK binary.',
	})
	public driveFileId: MiDriveFile['id'];

	@ManyToOne(() => MiDriveFile, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public driveFile: MiDriveFile | null;

	@Column('varchar', {
		length: 256,
	})
	public name: string;

	@Column('varchar', {
		length: 256, nullable: true,
	})
	public packageName: string | null;

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
	public description: string | null;

	@Column({
		...id(),
		array: true, default: '{}',
	})
	public screenshotFileIds: MiDriveFile['id'][];

	@Index()
	@Column('varchar', {
		length: 32,
		default: 'pending',
	})
	public status: MiApkResourceStatus;

	@Index()
	@Column('integer', {
		default: 0,
	})
	public downloadCount: number;

	@Index()
	@Column({
		...id(),
		nullable: true,
		comment: 'The ID of reviewer.',
	})
	public reviewerId: MiUser['id'] | null;

	@ManyToOne(() => MiUser, {
		onDelete: 'SET NULL',
	})
	@JoinColumn()
	public reviewer: MiUser | null;

	@Column('timestamp with time zone', {
		nullable: true,
	})
	public reviewedAt: Date | null;

	@Column('varchar', {
		length: 2048, nullable: true,
	})
	public reviewNote: string | null;

	@Column('varchar', {
		length: 2048, nullable: true,
	})
	public rejectionReason: string | null;

	constructor(data: Partial<MiApkResource>) {
		if (data == null) return;

		for (const [k, v] of Object.entries(data)) {
			(this as any)[k] = v;
		}
	}
}
