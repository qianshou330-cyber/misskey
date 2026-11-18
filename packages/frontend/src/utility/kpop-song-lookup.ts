/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { KpopChart, KpopChartKey, KpopChartView, KpopEntry } from '@/utility/kpop-charts.js';

export type KpopSongPage = Pick<KpopChart, 'chart' | 'entries'>;
export type KpopSongLookupResult = { entry: KpopEntry | null; chart: KpopChartView | null };
export type KpopSongPageRequest = (params: { chartKey: KpopChartKey; offset: number; limit: number }, signal: AbortSignal) => Promise<KpopChart>;

/** Pagination and filter changes do not by themselves change the collected snapshot. */
export function kpopSongSnapshot(chart: KpopChartView): string {
	return JSON.stringify([chart.chartKey, chart.observedAt, chart.lastChangedAt, chart.sourceUpdatedAt, chart.sourcePeriod, chart.sourceDate, chart.status, chart.coverage, chart.rankBasis]);
}

/** Bounded, unfiltered lookup in this instance's existing cache; never requests collection. */
export async function lookupKpopSong(chartKey: KpopChartKey, songId: string, request: KpopSongPageRequest, signal: AbortSignal): Promise<KpopSongLookupResult> {
	let chart: KpopChartView | null = null;
	for (const offset of [0, 100]) {
		signal.throwIfAborted();
		const page = await request({ chartKey, offset, limit: 100 }, signal);
		signal.throwIfAborted();
		if (page.chart.chartKey !== chartKey) throw new Error('Unexpected chart response');
		if (chart != null && kpopSongSnapshot(chart) !== kpopSongSnapshot(page.chart)) throw new Error('Chart changed during song lookup');
		chart = page.chart;
		const entry = page.entries.find(row => row.songId === songId) ?? null;
		if (entry || !page.hasMore) return { entry, chart };
	}
	return { entry: null, chart };
}
