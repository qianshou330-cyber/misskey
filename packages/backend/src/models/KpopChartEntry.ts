/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { MiKpopChartSnapshot } from './KpopChartSnapshot.js';
import type { KpopEntry } from '@/core/kpop-charts/types.js';

@Entity('kpop_chart_entry')
@Index('IDX_kpop_entry_song', ['snapshotId', 'songId'], { unique: true })
export class MiKpopChartEntry {
	@PrimaryColumn('uuid', { primaryKeyConstraintName: 'PK_kpop_chart_entry' }) public snapshotId: string;
	@PrimaryColumn('integer', { primaryKeyConstraintName: 'PK_kpop_chart_entry' }) public rank: number;
	@ManyToOne(() => MiKpopChartSnapshot, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'snapshotId', foreignKeyConstraintName: 'FK_kpop_entry_snapshot' }) public snapshot: MiKpopChartSnapshot;
	@Column('varchar', { length: 200 }) public songId: string;
	@Column('varchar', { length: 500 }) public title: string;
	@Column('jsonb') public artists: KpopEntry['artists'];
	@Column('varchar', { length: 500, nullable: true }) public album: string | null;
	@Column('varchar', { length: 200, nullable: true }) public albumId: string | null;
	@Column('varchar', { length: 2048, nullable: true }) public albumCoverUrl: string | null;
	@Column('jsonb') public groupIds: KpopEntry['groupIds'];
	@Column('jsonb') public sourceMovement: KpopEntry['sourceMovement'];
}
