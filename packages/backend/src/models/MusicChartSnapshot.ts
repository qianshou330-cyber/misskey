/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { MusicChartKey } from '@/core/music-charts/provider.js';

@Entity('music_chart_snapshot')
export class MiMusicChartSnapshot {
	@PrimaryColumn('varchar', { length: 32 })
	public chartKey: MusicChartKey;

	@PrimaryColumn('timestamp with time zone')
	public sourcePeriod: Date;

	@Column('timestamp with time zone')
	public observedAt: Date;

	@Column('integer', { nullable: true })
	public rank: number | null;

	@Column('boolean')
	public eligible: boolean;
}
