/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { MusicChartService } from '@/core/MusicChartService.js';
import { REFERENCE_FAILURE_REASONS } from '@/core/music-charts/reference-diagnostic.js';

export const musicChartKeys = ['melon-daily', 'melon-hot100', 'melon-top100', 'genie-realtime', 'bugs-realtime'] as const;

const nullableDate = { type: 'string', format: 'date-time', nullable: true, optional: false } as const;
const nullableRank = { type: 'integer', nullable: true, optional: false } as const;

export const meta = {
	tags: ['music-charts'],
	requireCredential: false,
	allowGet: true,
	cacheSec: 30,
	limit: { duration: 60000, max: 120 },
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			charts: {
				type: 'array', optional: false, nullable: false,
				items: {
					type: 'object', optional: false, nullable: false,
					properties: {
						key: { type: 'string', enum: musicChartKeys, optional: false, nullable: false },
						label: { type: 'string', optional: false, nullable: false },
						sourceUrl: { type: 'string', optional: false, nullable: false },
						periodHours: { type: 'integer', optional: false, nullable: false },
						maxRank: { type: 'integer', minimum: 100, maximum: 200, optional: false, nullable: false },
						status: { type: 'string', enum: ['pending', 'available', 'restricted', 'unavailable', 'stale'], optional: false, nullable: false },
						result: { type: 'string', enum: ['unknown', 'ranked', 'unranked', 'out_of_scope'], optional: false, nullable: false },
						rank: nullableRank,
						previousRank: nullableRank,
						change: nullableRank,
						sourcePeriod: nullableDate,
						checkedAt: nullableDate,
						lastSuccessAt: nullableDate,
						peakRank: nullableRank,
						monitorStartedAt: nullableDate,
						reference: {
							type: 'object', optional: false, nullable: true,
							properties: {
								provider: { type: 'string', enum: ['chartradar'], optional: false, nullable: false },
								sourceUrl: { type: 'string', optional: false, nullable: false },
								scope: { type: 'string', enum: ['top100', 'reference-top200'], optional: false, nullable: false },
								status: { type: 'string', enum: ['available', 'stale', 'restricted', 'unavailable'], optional: false, nullable: false },
								result: { type: 'string', enum: ['ranked', 'not_found', 'unknown'], optional: false, nullable: false },
								rank: { ...nullableRank, minimum: 1, maximum: 200 },
								sourceTimeLabel: { type: 'string', optional: false, nullable: true },
								sourceFetchedAt: nullableDate,
								checkedAt: nullableDate,
								lastSuccessAt: nullableDate,
								nextAttemptAt: nullableDate,
								diagnostic: {
									type: 'object', nullable: true, optional: false,
									properties: {
										phase: { type: 'string', enum: ['robots', 'page', 'parse'], nullable: false, optional: false },
										reason: { type: 'string', enum: REFERENCE_FAILURE_REASONS, nullable: false, optional: false },
										httpStatus: { type: 'integer', minimum: 100, maximum: 599, nullable: true, optional: false },
										retryAfterAt: nullableDate,
										elapsedMs: { type: 'integer', minimum: 0, maximum: 600000, nullable: true, optional: false },
									},
								},
								basis: { type: 'string', enum: ['title_artist'], optional: false, nullable: false },
							},
						},
					},
				},
			},
		},
	},
} as const;

export const paramDef = { type: 'object', properties: {}, required: [] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private musicChartService: MusicChartService) {
		super(meta, paramDef, () => this.musicChartService.summary());
	}
}
