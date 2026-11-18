/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiChatAttachmentBlob } from './ChatAttachmentBlob.js';
import { MiChatMessage } from './ChatMessage.js';
import { MiUser } from './User.js';

@Entity('chat_attachment')
@Index('IDX_chat_attachment_message_position', ['messageId', 'position'], { unique: true })
@Index('IDX_chat_attachment_blob', ['blobId'])
@Index('IDX_chat_attachment_expiry', ['state', 'expiresAt'])
export class MiChatAttachment {
	@PrimaryColumn(id()) public id: string;
	@Column(id()) public ownerId: string;
	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'ownerId', foreignKeyConstraintName: 'FK_chat_attachment_owner' }) public owner: MiUser;
	@Column(id()) public toUserId: string;
	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'toUserId', foreignKeyConstraintName: 'FK_chat_attachment_recipient' }) public recipient: MiUser;
	@Column(id()) public blobId: string;
	@ManyToOne(() => MiChatAttachmentBlob, { onDelete: 'RESTRICT' })
	@JoinColumn({ name: 'blobId', foreignKeyConstraintName: 'FK_chat_attachment_blob' }) public blob: MiChatAttachmentBlob;
	@Column({ ...id(), nullable: true }) public messageId: string | null;
	@ManyToOne(() => MiChatMessage, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'messageId', foreignKeyConstraintName: 'FK_chat_attachment_message' }) public message: MiChatMessage | null;
	@Column('smallint', { default: 0 }) public position: number;
	@Column('varchar', { length: 256 }) public name: string;
	@Column('varchar', { length: 16, default: 'staged' }) public state: 'staged' | 'attached' | 'revoked';
	@Column('varchar', { length: 16, default: 'none' }) public legacyExposure: 'none' | 'possible';
	@Column('boolean', { default: false }) public sourceRetainedShared: boolean;
	@Column('timestamp with time zone') public createdAt: Date;
	@Column('timestamp with time zone', { nullable: true }) public expiresAt: Date | null;
}
