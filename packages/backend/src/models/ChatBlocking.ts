/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { MiUser } from './User.js';
import { id } from './util/id.js';

@Entity('chat_blocking')
@Index(['userId', 'targetId'], { unique: true })
export class MiChatBlocking {
	@PrimaryColumn(id())
	public id: string;

	@Column(id())
	public userId: string;

	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn()
	public user: MiUser | null;

	@Index()
	@Column(id())
	public targetId: string;

	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'targetId' })
	public target: MiUser | null;

	@Column('timestamp with time zone')
	public createdAt: Date;
}
