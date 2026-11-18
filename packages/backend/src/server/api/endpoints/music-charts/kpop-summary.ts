/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { KpopMusicChartService } from '@/core/KpopMusicChartService.js';
import { KPOP_CHART_KEYS } from '@/core/kpop-charts/types.js';
import { kpopSummarySchema } from '@/models/json-schema/kpop-charts.js';

export const meta = {
	tags: ['music-charts'], requireCredential: false, allowGet: true, cacheSec: 30,
	limit: { duration: 60000, max: 120 }, res: kpopSummarySchema,
} as const;

export const paramDef = { type: 'object', properties: { chartKey: { type: 'string', enum: KPOP_CHART_KEYS, default: 'melon-top100' } }, required: [] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(service: KpopMusicChartService) { super(meta, paramDef, ps => service.summary(ps.chartKey)); }
}
