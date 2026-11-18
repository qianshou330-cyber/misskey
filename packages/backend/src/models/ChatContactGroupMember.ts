/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { MiUser } from './User.js';
import { MiChatContactGroup } from './ChatContactGroup.js';
import { id } from './util/id.js';

@Entity('chat_contact_group_member')
export class MiChatContactGroupMember {
	@PrimaryColumn(id())
	public groupId: string;

	@ManyToOne(() => MiChatContactGroup, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'groupId' })
	public group: MiChatContactGroup | null;

	@Index()
	@PrimaryColumn(id())
	public userId: string;

	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn()
	public user: MiUser | null;
}
