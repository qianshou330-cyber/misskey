/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { MusicChartKey } from '@/core/music-charts/provider.js';

@Entity('music_chart_state')
export class MiMusicChartState {
	@PrimaryColumn('varchar', { length: 32 })
	public chartKey: MusicChartKey;

	@Column('varchar', { length: 16, default: 'pending' })
	public status: 'pending' | 'available' | 'restricted' | 'unavailable';

	@Column('timestamp with time zone', { nullable: true })
	public checkedAt: Date | null;

	@Column('timestamp with time zone', { nullable: true })
	public nextAttemptAt: Date | null;

	@Column('integer', { default: 0 })
	public failureCount: number;

	@Column('timestamp with time zone', { nullable: true })
	public sourcePeriod: Date | null;

	@Column('timestamp with time zone', { nullable: true })
	public lastSuccessAt: Date | null;

	@Column('varchar', { length: 16, default: 'unknown' })
	public result: 'unknown' | 'ranked' | 'unranked' | 'out_of_scope';

	@Column('integer', { nullable: true })
	public rank: number | null;

	@Column('integer', { nullable: true })
	public previousRank: number | null;

	@Column('integer', { nullable: true })
	public peakRank: number | null;

	@Column('timestamp with time zone', { nullable: true })
	public monitorStartedAt: Date | null;
}
