/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';

@Entity('chat_upload_reservation')
@Index('IDX_chat_reservation_owner_expiry', ['ownerId', 'expiresAt'])
export class MiChatUploadReservation {
	@PrimaryColumn(id()) public id: string;
	@Column(id()) public ownerId: string;
	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'ownerId', foreignKeyConstraintName: 'FK_chat_reservation_owner' }) public owner: MiUser;
	@Column('integer') public size: number;
	@Column('timestamp with time zone') public expiresAt: Date;
}
