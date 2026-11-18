/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { MUSIC_CHART_INTERVAL_MS } from './schedule.js';

export const MUSIC_CHARTS = [
	{ key: 'melon-daily', label: 'Melon 日榜', sourceUrl: 'https://www.melon.com/chart/day/index.htm', maxRank: 100, periodHours: 24, intervalMs: MUSIC_CHART_INTERVAL_MS, failureIntervalMs: 60 * 60_000 },
	{ key: 'melon-hot100', label: 'Melon HOT100', sourceUrl: 'https://www.melon.com/chart/hot100/index.htm', maxRank: 100, periodHours: 1, intervalMs: MUSIC_CHART_INTERVAL_MS, failureIntervalMs: 15 * 60_000 },
	{ key: 'melon-top100', label: 'Melon TOP100', sourceUrl: 'https://www.melon.com/chart/index.htm', maxRank: 100, periodHours: 1, intervalMs: MUSIC_CHART_INTERVAL_MS, failureIntervalMs: 15 * 60_000 },
	{ key: 'genie-realtime', label: 'Genie 实时榜', sourceUrl: 'https://www.genie.co.kr/chart/top200?ditc=D&rtm=Y', maxRank: 200, periodHours: 1, intervalMs: MUSIC_CHART_INTERVAL_MS, failureIntervalMs: 15 * 60_000 },
	{ key: 'bugs-realtime', label: 'Bugs 实时榜', sourceUrl: 'https://music.bugs.co.kr/chart/track/realtime/total', maxRank: 100, periodHours: 1, intervalMs: MUSIC_CHART_INTERVAL_MS, failureIntervalMs: 15 * 60_000 },
] as const;

export type MusicChartKey = typeof MUSIC_CHARTS[number]['key'];

export type MusicChartSnapshot = {
	/** The beginning of the source's KST chart period, represented in UTC. */
	period: string;
	rank: number | null;
	eligible: boolean;
};

export class MusicChartSourceError extends Error {
	constructor(public readonly kind: 'restricted' | 'unavailable' | 'invalid' | 'out_of_scope', message: string) {
		super(message);
		this.name = 'MusicChartSourceError';
	}
}
