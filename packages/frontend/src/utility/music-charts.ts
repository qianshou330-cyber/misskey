/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Endpoints } from 'misskey-js';

export type MusicChartSummary = Endpoints['music-charts/summary']['res'];
export type MusicChartRow = MusicChartSummary['charts'][number];
export type MusicChartReference = NonNullable<MusicChartRow['reference']>;
export type MusicChartKey = MusicChartRow['key'];
export type MusicChartHistory = Endpoints['music-charts/history']['res'];

export const musicChartDefinitions = [
	{ key: 'melon-daily', labelKey: 'melonDaily', sourceUrl: 'https://www.melon.com/chart/day/index.htm', periodHours: 24, maxRank: 100 },
	{ key: 'melon-hot100', labelKey: 'melonHot100', sourceUrl: 'https://www.melon.com/chart/hot100/index.htm', periodHours: 1, maxRank: 100 },
	{ key: 'melon-top100', labelKey: 'melonTop100', sourceUrl: 'https://www.melon.com/chart/index.htm', periodHours: 1, maxRank: 100 },
	{ key: 'genie-realtime', labelKey: 'genieRealtime', sourceUrl: 'https://www.genie.co.kr/chart/top200?ditc=D&rtm=Y', periodHours: 1, maxRank: 200 },
	{ key: 'bugs-realtime', labelKey: 'bugsRealtime', sourceUrl: 'https://music.bugs.co.kr/chart/track/realtime/total', periodHours: 1, maxRank: 100 },
] as const;

export function musicChartRows(summary: MusicChartSummary | null): MusicChartRow[] {
	return musicChartDefinitions.map(definition => summary?.charts.find(chart => chart.key === definition.key) ?? {
		key: definition.key,
		label: '',
		sourceUrl: definition.sourceUrl,
		periodHours: definition.periodHours,
		maxRank: definition.maxRank,
		status: 'pending',
		result: 'unknown',
		rank: null,
		previousRank: null,
		change: null,
		sourcePeriod: null,
		checkedAt: null,
		lastSuccessAt: null,
		peakRank: null,
		monitorStartedAt: null,
		reference: null,
	});
}

export function musicChartReferenceHasResult(reference: MusicChartReference | null): boolean {
	if (reference?.result === 'not_found') return true;
	return reference?.result === 'ranked' && reference.rank != null && Number.isInteger(reference.rank) && reference.rank >= 1 && reference.rank <= (reference.scope === 'reference-top200' ? 200 : 100);
}

export function musicChartUsesReference(row: MusicChartRow): boolean {
	// Eligibility is an official boundary; HOT100 has no third-party reference feed.
	if (row.key === 'melon-hot100' || row.result === 'out_of_scope') return false;
	if (row.status === 'available' && row.sourcePeriod != null && row.result !== 'unknown') return false;
	return musicChartReferenceHasResult(row.reference);
}

export function formatMusicChartPeriod(value: string | null, daily = false): string | null {
	if (value == null) return null;
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp)) return null;
	// The source period is always shown in Korea Standard Time, regardless of device timezone.
	const kstDate = new Date(timestamp + 9 * 60 * 60 * 1000);
	if (!Number.isFinite(kstDate.getTime())) return null;
	const kst = kstDate.toISOString();
	return daily ? kst.slice(0, 10) : `${kst.slice(0, 10)} ${kst.slice(11, 16)}`;
}

export function musicChartPoints(chartHistory: MusicChartHistory): { x: number; y: number | null }[] {
	return chartHistory.points.map(point => ({
		x: Date.parse(point.period),
		y: point.result === 'ranked' && point.rank != null && Number.isInteger(point.rank) && point.rank >= 1 && point.rank <= chartHistory.maxRank ? point.rank : null,
	})).filter(point => Number.isFinite(point.x));
}

export function musicChartChange(row: MusicChartRow): number | null {
	// A change is meaningful only between two actually ranked observations.
	if (row.result !== 'ranked' || row.rank == null || row.previousRank == null) return null;
	return row.previousRank - row.rank;
}
