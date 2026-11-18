/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { KpopMusicChartService } from '@/core/KpopMusicChartService.js';
import { KPOP_CHART_KEYS } from '@/core/kpop-charts/types.js';
import { kpopHistorySchema } from '@/models/json-schema/kpop-charts.js';

export const meta = {
	tags: ['music-charts'], requireCredential: false, allowGet: true, cacheSec: 30,
	limit: { duration: 60000, max: 120 }, res: kpopHistorySchema,
} as const;

export const paramDef = { type: 'object', properties: { chartKey: { type: 'string', enum: KPOP_CHART_KEYS }, songId: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['chartKey', 'songId'] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(service: KpopMusicChartService) { super(meta, paramDef, ps => service.history(ps.chartKey, ps.songId)); }
}
