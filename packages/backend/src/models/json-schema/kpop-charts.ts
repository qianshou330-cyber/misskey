/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { KPOP_CHART_KEYS, KPOP_FAILURE_REASONS, KPOP_GROUP_IDS, KPOP_SOURCES } from '@/core/kpop-charts/types.js';

const text = { type: 'string', optional: false, nullable: false } as const;
const nullableText = { ...text, nullable: true } as const;
const number = { type: 'integer', optional: false, nullable: false } as const;
const nullableNumber = { ...number, nullable: true } as const;
const date = { ...nullableText, format: 'date-time' } as const;
const boolean = { type: 'boolean', optional: false, nullable: false } as const;
export const kpopEntrySchema = {
	type: 'object', optional: false, nullable: false, properties: {
		songId: text, rank: number, title: text,
		artists: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false, properties: { id: nullableText, name: text } } },
		album: nullableText, albumId: nullableText, albumCoverUrl: nullableText,
		groupIds: { type: 'array', optional: false, nullable: false, items: { ...text, enum: KPOP_GROUP_IDS } },
		sourceMovement: { type: 'object', optional: false, nullable: false, properties: { type: { ...text, enum: ['up', 'down', 'same', 'new', 'unknown'] }, amount: nullableNumber } },
		previousRank: nullableNumber, change: nullableNumber, bestRank7d: nullableNumber,
	},
} as const;
export const kpopChartSchema = {
	type: 'object', optional: false, nullable: false, properties: {
		chartKey: { ...text, enum: KPOP_CHART_KEYS }, provider: { ...text, enum: KPOP_SOURCES }, label: text, sourceUrl: text,
		maxRank: number, periodHours: number, coverage: { ...text, enum: ['complete', 'preview'] }, sourceTotal: nullableNumber, expectedCount: number,
		rankBasis: { ...text, enum: ['official_rank', 'playlist_order'] },
		status: { ...text, enum: ['pending', 'available', 'stale', 'restricted', 'unavailable', 'disabled'] },
		checkedAt: date, lastSuccessAt: date, lastChangedAt: date, nextAttemptAt: date,
		diagnostic: { type: 'object', optional: false, nullable: true, properties: {
			phase: { ...text, enum: ['robots', 'page', 'parse'] }, reason: { ...text, enum: KPOP_FAILURE_REASONS }, httpStatus: nullableNumber, retryAfterAt: date, elapsedMs: number,
		} },
		sourcePeriod: nullableText, sourceUpdatedAt: date, sourceDate: nullableText, observedAt: date,
	},
} as const;
export const kpopSummarySchema = {
	type: 'object', optional: false, nullable: false, properties: {
		charts: { type: 'array', optional: false, nullable: false, items: kpopChartSchema },
		groups: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false, properties: { id: { ...text, enum: KPOP_GROUP_IDS }, label: text } } },
		selected: kpopChartSchema, entries: { type: 'array', optional: false, nullable: false, items: kpopEntrySchema },
	},
} as const;
export const kpopDetailSchema = {
	type: 'object', optional: false, nullable: false, properties: {
		chart: kpopChartSchema, entries: { type: 'array', optional: false, nullable: false, items: kpopEntrySchema }, total: number, hasMore: boolean,
	},
} as const;
export const kpopHistorySchema = {
	type: 'object', optional: false, nullable: false, properties: {
		chartKey: { ...text, enum: KPOP_CHART_KEYS }, songId: text, basis: { ...text, enum: ['official_period', 'observation'] }, from: { ...date, nullable: false }, to: { ...date, nullable: false },
		points: { type: 'array', optional: false, nullable: false, items: { type: 'object', optional: false, nullable: false, properties: {
			observedAt: { ...date, nullable: false }, sourcePeriod: nullableText, sourceUpdatedAt: date, rank: nullableNumber,
			result: { ...text, enum: ['ranked', 'not_listed', 'unknown'] }, gapBefore: boolean,
		} } },
	},
} as const;
