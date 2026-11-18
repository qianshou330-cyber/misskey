/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';

/** A false row also records that the old Redis flag was already imported. */
@Entity('chat_legacy_unread')
export class MiChatLegacyUnread {
	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_chat_legacy_unread' })
	public userId: MiUser['id'];

	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn({ foreignKeyConstraintName: 'FK_chat_legacy_unread_user' })
	public user: MiUser | null;

	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_chat_legacy_unread' })
	public otherId: MiUser['id'];

	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn({ foreignKeyConstraintName: 'FK_chat_legacy_unread_other' })
	public other: MiUser | null;

	@Column('boolean', { default: false })
	public hasUnread: boolean;

	@Column({ ...id(), nullable: true })
	public messageId: string | null;
}
