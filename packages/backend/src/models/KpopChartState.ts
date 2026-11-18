/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { KpopDiagnostic, KpopRobotsAudit } from '@/core/kpop-charts/types.js';

/** Chart rows and source gates live only in this module's table. */
@Entity('kpop_chart_state')
export class MiKpopChartState {
	@PrimaryColumn('varchar', { length: 64, primaryKeyConstraintName: 'PK_kpop_chart_state' }) public key: string;
	@Column('varchar', { length: 16 }) public source: string;
	@Column('varchar', { length: 32, nullable: true }) public chartKey: string | null;
	@Column('varchar', { length: 16, default: 'pending' }) public status: 'pending' | 'available' | 'restricted' | 'unavailable';
	@Column('boolean', { default: false }) public disabled: boolean;
	@Column('integer', { default: 0 }) public failureCount: number;
	@Column('timestamp with time zone', { nullable: true }) public checkedAt: Date | null;
	@Column('timestamp with time zone', { nullable: true }) public lastChangedAt: Date | null;
	@Column('timestamp with time zone', { nullable: true }) public lastSuccessAt: Date | null;
	@Column('timestamp with time zone', { nullable: true }) public nextAttemptAt: Date | null;
	@Column('timestamp with time zone', { nullable: true }) public lastSlotAt: Date | null;
	@Column('uuid', { nullable: true }) public latestSnapshotId: string | null;
	@Column('jsonb', { nullable: true }) public diagnostic: KpopDiagnostic | null;
	@Column('jsonb', { default: '[]' }) public robots: KpopRobotsAudit[];
}
