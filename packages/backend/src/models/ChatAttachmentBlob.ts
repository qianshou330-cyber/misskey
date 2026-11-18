/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';

@Entity('chat_attachment_blob')
@Index('IDX_chat_blob_owner_hash', ['ownerId', 'sha256', 'kind'], { unique: true })
export class MiChatAttachmentBlob {
	@PrimaryColumn(id()) public id: string;
	@Column(id()) public ownerId: string;
	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'ownerId', foreignKeyConstraintName: 'FK_chat_blob_owner' }) public owner: MiUser;
	@Column('varchar', { length: 64, unique: true }) public storageKey: string;
	@Column('varchar', { length: 64 }) public sha256: string;
	@Column('varchar', { length: 128 }) public mime: string;
	@Column('integer') public size: number;
	@Column('integer') public storedSize: number;
	@Column('varchar', { length: 16 }) public kind: 'file' | 'image' | 'voice';
	@Column('integer', { nullable: true }) public durationMs: number | null;
	@Column('jsonb', { default: [] }) public peaks: number[];
	@Column('integer', { nullable: true }) public width: number | null;
	@Column('integer', { nullable: true }) public height: number | null;
	@Column('integer', { default: 0 }) public previewSize: number;
	@Column('timestamp with time zone') public createdAt: Date;
}
