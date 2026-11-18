/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { VerificationStatus, VerificationType } from '@/verification-constants.js';
import { id } from './util/id.js';
import { MiUser } from './User.js';

@Entity('verification_application')
@Index('IDX_verification_application_status_submitted', ['status', 'submittedAt'])
@Check('CHK_verification_application_status', '"status" IN (\'pending\', \'approved\', \'rejected\', \'revoked\')')
@Check('CHK_verification_application_requested_type', '"requestedType" IN (\'actor\', \'singer\', \'model\', \'contentCreator\', \'novelist\', \'other\')')
@Check('CHK_verification_application_approved_type', '"approvedType" IS NULL OR "approvedType" IN (\'actor\', \'singer\', \'model\', \'contentCreator\', \'novelist\', \'other\')')
export class MiVerificationApplication {
	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_verification_application' })
	public id: string;

	@Index('IDX_verification_application_user', { unique: true })
	@Column({ ...id() })
	public userId: MiUser['id'];

	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_verification_application_user' })
	public user: MiUser | null;

	@Column('varchar', { length: 32 })
	public requestedType: VerificationType;

	@Column('varchar', { length: 32, nullable: true })
	public approvedType: VerificationType | null;

	@Column('varchar', { length: 2000 })
	public description: string;

	@Column('varchar', { length: 512 })
	public contact: string;

	@Column('varchar', { length: 64 })
	public consentVersion: string;

	@Column('timestamptz')
	public consentedAt: Date;

	@Column('varchar', { length: 16, default: 'pending' })
	public status: VerificationStatus;

	@Column('timestamptz', { default: () => 'CURRENT_TIMESTAMP' })
	public submittedAt: Date;

	@Column('timestamptz', { nullable: true })
	public reviewedAt: Date | null;

	@Column({ ...id(), nullable: true })
	public reviewerId: MiUser['id'] | null;

	@ManyToOne(() => MiUser, { onDelete: 'SET NULL', nullable: true })
	@JoinColumn({ name: 'reviewerId', foreignKeyConstraintName: 'FK_verification_application_reviewer' })
	public reviewer: MiUser | null;

	@Column('varchar', { length: 512, nullable: true })
	public reviewReason: string | null;
}
