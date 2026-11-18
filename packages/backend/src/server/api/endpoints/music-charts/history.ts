/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { MusicChartService } from '@/core/MusicChartService.js';
import { musicChartKeys } from './summary.js';

export const meta = {
	tags: ['music-charts'],
	requireCredential: false,
	allowGet: true,
	cacheSec: 30,
	limit: { duration: 60000, max: 120 },
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			chartKey: { type: 'string', enum: musicChartKeys, optional: false, nullable: false },
			maxRank: { type: 'integer', minimum: 100, maximum: 200, optional: false, nullable: false },
			from: { type: 'string', format: 'date-time', optional: false, nullable: false },
			to: { type: 'string', format: 'date-time', optional: false, nullable: false },
			points: {
				type: 'array', optional: false, nullable: false,
				items: {
					type: 'object', optional: false, nullable: false,
					properties: {
						period: { type: 'string', format: 'date-time', optional: false, nullable: false },
						rank: { type: 'integer', optional: false, nullable: true },
						result: { type: 'string', enum: ['ranked', 'unranked', 'out_of_scope', 'missing'], optional: false, nullable: false },
					},
				},
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: { chartKey: { type: 'string', enum: musicChartKeys } },
	required: ['chartKey'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private musicChartService: MusicChartService) {
		super(meta, paramDef, ps => this.musicChartService.history(ps.chartKey));
	}
}
