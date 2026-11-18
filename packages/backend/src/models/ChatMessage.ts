/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PrimaryColumn, Entity, Index, JoinColumn, Column, ManyToOne } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiDriveFile } from './DriveFile.js';
import { MiChatRoom } from './ChatRoom.js';

@Entity('chat_message')
@Index('IDX_chat_message_client_nonce', ['fromUserId', 'clientMessageId'], { unique: true })
@Index('IDX_chat_message_unread', ['toUserId', 'fromUserId'], { where: '"readTracked" = true AND "readAt" IS NULL AND "recalledAt" IS NULL' })
export class MiChatMessage {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column({
		...id(),
	})
	public fromUserId: MiUser['id'];

	@ManyToOne(() => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public fromUser: MiUser | null;

	@Index()
	@Column({
		...id(), nullable: true,
	})
	public toUserId: MiUser['id'] | null;

	@ManyToOne(() => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public toUser: MiUser | null;

	@Index()
	@Column({
		...id(), nullable: true,
	})
	public toRoomId: MiChatRoom['id'] | null;

	@ManyToOne(() => MiChatRoom, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public toRoom: MiChatRoom | null;

	@Column('varchar', {
		length: 4096, nullable: true,
	})
	public text: string | null;

	@Column('varchar', {
		length: 512, nullable: true,
	})
	public uri: string | null;

	@Column({
		...id(),
		array: true, default: '{}',
	})
	public reads: MiUser['id'][];

	@Column({
		...id(),
		nullable: true,
	})
	public fileId: MiDriveFile['id'] | null;

	@ManyToOne(() => MiDriveFile, {
		onDelete: 'SET NULL',
	})
	@JoinColumn()
	public file: MiDriveFile | null;

	@Column('varchar', {
		length: 1024, array: true, default: '{}',
	})
	public reactions: string[];

	@Column('varchar', { length: 64, nullable: true })
	public clientMessageId: string | null;

	@Column('varchar', { length: 64, nullable: true })
	public requestFingerprint: string | null;

	@Column('boolean', { default: false })
	public readTracked: boolean;

	@Column('timestamp with time zone', { nullable: true })
	public readAt: Date | null;

	@Column('integer', { default: 0 })
	public revision: number;

	@Column('timestamp with time zone', { nullable: true })
	public editedAt: Date | null;

	@Column('timestamp with time zone', { nullable: true })
	public recalledAt: Date | null;

	// No FK: a deleted target must remain an unavailable reference, not silently disappear.
	@Column({ ...id(), nullable: true })
	public replyToId: string | null;

	/** Internal only. A mute during the notification delay permanently suppresses it. */
	@Column('boolean', { default: false })
	public notificationSuppressed: boolean;
}
