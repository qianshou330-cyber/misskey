/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';

/** These preferences belong only to userId, never to the conversation's peer. */
@Entity('chat_conversation_setting')
@Index('IDX_chat_conversation_pinned', ['userId', 'pinnedAt'], { where: '"pinnedAt" IS NOT NULL' })
export class MiChatConversationSetting {
	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_chat_conversation_setting' })
	public userId: string;

	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn({ foreignKeyConstraintName: 'FK_chat_conversation_setting_user' })
	public user: MiUser | null;

	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_chat_conversation_setting' })
	public otherId: string;

	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn({ foreignKeyConstraintName: 'FK_chat_conversation_setting_other' })
	public other: MiUser | null;

	@Column('timestamp with time zone', { nullable: true })
	public pinnedAt: Date | null;

	@Column('boolean', { default: false })
	public isMuted: boolean;
}
