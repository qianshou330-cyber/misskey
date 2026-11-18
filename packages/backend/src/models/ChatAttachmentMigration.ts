/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';

// Deliberately no Drive FK: this audit record must survive closing the old source.
@Entity('chat_attachment_migration')
export class MiChatAttachmentMigration {
	@PrimaryColumn(id()) public sourceFileId: string;
	@Column({ ...id(), nullable: true }) public blobId: string | null;
	@Column('varchar', { length: 32, default: 'pending' }) public state: 'pending' | 'copied' | 'bound' | 'shared' | 'closed' | 'failed';
	@Column('jsonb', { default: [] }) public sharedReasons: string[];
	@Column('jsonb', { nullable: true }) public sourceSnapshot: { storedInternal: boolean; keys: string[] } | null;
	@Column('timestamp with time zone') public updatedAt: Date;
}
