/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('kpop_chart_snapshot')
@Index('IDX_kpop_snapshot_period', ['chartKey', 'periodKey'], { unique: true })
@Index('IDX_kpop_snapshot_observed', ['chartKey', 'observedAt'])
export class MiKpopChartSnapshot {
	@PrimaryColumn('uuid', { primaryKeyConstraintName: 'PK_kpop_chart_snapshot' }) public id: string;
	@Column('varchar', { length: 32 }) public chartKey: string;
	@Column('varchar', { length: 16 }) public source: string;
	@Column('varchar', { length: 128 }) public periodKey: string;
	@Column('varchar', { length: 100, nullable: true }) public sourcePeriod: string | null;
	@Column('timestamp with time zone', { nullable: true }) public sourceUpdatedAt: Date | null;
	@Column('varchar', { length: 10, nullable: true }) public sourceDate: string | null;
	@Column('timestamp with time zone') public observedAt: Date;
	@Column('varchar', { length: 16 }) public coverage: string;
	@Column('varchar', { length: 32 }) public rankBasis: string;
	@Column('integer') public expectedCount: number;
	@Column('integer', { nullable: true }) public sourceTotal: number | null;
	@Column('varchar', { length: 64 }) public contentHash: string;
	@Column('varchar', { length: 64 }) public rawHash: string;
}
