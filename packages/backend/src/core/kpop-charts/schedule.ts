/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { KpopChartKey } from './types.js';

export const KPOP_HOUR_MS = 3600000;
export const KPOP_SCHEDULE_VERSION = 1;
export const KPOP_SLOTS = {
	'melon-daily': 5, 'melon-hot100': 7, 'melon-top100': 9, 'melon-hot100-d30': 11,
	'genie-realtime': 13, 'bugs-realtime': 15, flo: 17, apple: 19, spotify: 21, tencent: 23,
	'billboard-korea-global-k-songs': 25,
} as const;
export const KPOP_KEYS = Object.keys(KPOP_SLOTS) as KpopChartKey[];
export function kpopEnabled(): boolean { return process.env.PUBO_KPOP_CHARTS_ENABLED === 'true'; }
export function enabledKpopKeys(value = process.env.PUBO_KPOP_CHARTS_KEYS ?? ''): KpopChartKey[] {
	const requested = new Set(value.split(',').map(x => x.trim()));
	return KPOP_KEYS.filter(key => requested.has(key));
}
export function kpopSchedule(key: KpopChartKey) { return { pattern: `0 ${KPOP_SLOTS[key]} * * * *`, tz: 'UTC' }; }
export function nextKpopSlot(key: KpopChartKey, now: number): number {
	const slot = Math.floor(now / KPOP_HOUR_MS) * KPOP_HOUR_MS + KPOP_SLOTS[key] * 60000;
	return slot > now ? slot : slot + KPOP_HOUR_MS;
}
export function kpopJobSlot(key: KpopChartKey, jobId?: string): number | null {
	const prefix = `repeat:${key}:`;
	if (!jobId?.startsWith(prefix)) return null;
	const text = jobId.slice(prefix.length);
	if (!/^\d{13}$/.test(text)) return null;
	const slot = Number(text);
	return Number.isSafeInteger(slot) && slot % KPOP_HOUR_MS === KPOP_SLOTS[key] * 60000 ? slot : null;
}
