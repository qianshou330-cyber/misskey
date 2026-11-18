/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { MiUser } from './User.js';
import { MiAccessToken } from './AccessToken.js';
import { id } from './util/id.js';

@Entity('native_push_subscription')
@Index('IDX_native_push_device', ['deviceToken', 'environment', 'bundleId'], { unique: true })
@Index('IDX_native_push_install', ['installationId', 'environment', 'bundleId', 'userId'], { unique: true })
export class MiNativePushSubscription {
	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_native_push_subscription' })
	public id: string;

	@Index('IDX_native_push_user')
	@Column(id())
	public userId: string;

	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn({ foreignKeyConstraintName: 'FK_native_push_user' })
	public user: MiUser | null;

	@Column({ ...id(), nullable: true })
	public accessTokenId: string | null;

	@ManyToOne(() => MiAccessToken, { onDelete: 'CASCADE', nullable: true })
	@JoinColumn({ foreignKeyConstraintName: 'FK_native_push_access_token' })
	public accessToken: MiAccessToken | null;

	@Column('varchar', { length: 64 })
	public credentialHash: string;

	@Column('varchar', { length: 36 })
	public installationId: string;

	@Column('varchar', { length: 512, nullable: true })
	public deviceToken: string | null;

	@Column('bigint')
	public revision: number;

	@Column('varchar', { length: 16 })
	public environment: 'development' | 'production';

	@Column('varchar', { length: 128 })
	public bundleId: string;

	@Column('boolean', { default: true })
	public enabled: boolean;

	@Column('timestamp with time zone')
	public updatedAt: Date;

	@Column('timestamp with time zone')
	public expiresAt: Date;
}
