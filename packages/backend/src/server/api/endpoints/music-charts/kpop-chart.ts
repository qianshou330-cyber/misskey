/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { KpopMusicChartService } from '@/core/KpopMusicChartService.js';
import { KPOP_CHART_KEYS, KPOP_GROUP_IDS } from '@/core/kpop-charts/types.js';
import { kpopDetailSchema } from '@/models/json-schema/kpop-charts.js';

export const meta = {
	tags: ['music-charts'], requireCredential: false, allowGet: true, cacheSec: 30,
	limit: { duration: 60000, max: 120 }, res: kpopDetailSchema,
} as const;

export const paramDef = { type: 'object', properties: { chartKey: { type: 'string', enum: KPOP_CHART_KEYS }, groupId: { type: 'string', enum: KPOP_GROUP_IDS }, query: { type: 'string', maxLength: 200, default: '' }, offset: { type: 'integer', minimum: 0, maximum: 1000, default: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 } }, required: ['chartKey'] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(service: KpopMusicChartService) { super(meta, paramDef, ps => service.chart(ps.chartKey, ps.groupId, ps.query, ps.offset, ps.limit)); }
}
