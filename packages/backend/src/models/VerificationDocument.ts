/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiVerificationApplication } from './VerificationApplication.js';

@Entity('verification_document')
@Index('IDX_verification_document_user_created', ['userId', 'createdAt'])
@Index('IDX_verification_document_application_side', ['applicationId', 'side'], { unique: true })
@Index('IDX_verification_document_staged_side', ['userId', 'side'], { unique: true, where: '"applicationId" IS NULL' })
@Check('CHK_verification_document_side', '"side" IN (\'front\', \'back\')')
export class MiVerificationDocument {
	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_verification_document' })
	public id: string;

	@Column({ ...id() })
	public userId: MiUser['id'];

	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_verification_document_user' })
	public user: MiUser | null;

	@Column({ ...id(), nullable: true })
	public applicationId: MiVerificationApplication['id'] | null;

	@ManyToOne(() => MiVerificationApplication, { onDelete: 'CASCADE', nullable: true })
	@JoinColumn({ name: 'applicationId', foreignKeyConstraintName: 'FK_verification_document_application' })
	public application: MiVerificationApplication | null;

	@Column('varchar', { length: 16 })
	public side: 'front' | 'back';

	@Column('varchar', { length: 128 })
	public storageKey: string;

	@Column('varchar', { length: 128 })
	public mime: string;

	@Column('integer')
	public size: number;

	@Column('varchar', { length: 64 })
	public sha256: string;

	@Column('timestamptz', { default: () => 'CURRENT_TIMESTAMP' })
	public createdAt: Date;
}
