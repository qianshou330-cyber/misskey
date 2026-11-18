/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Endpoints } from 'misskey-js';
import { i18n } from '@/i18n.js';
import { formatMusicChartPeriod } from '@/utility/music-charts.js';

export type KpopSummary = Endpoints['music-charts/kpop-summary']['res'];
export type KpopChart = Endpoints['music-charts/kpop-chart']['res'];
export type KpopHistory = Endpoints['music-charts/kpop-history']['res'];
export type KpopChartView = KpopChart['chart'];
export type KpopEntry = KpopChart['entries'][number];
export type KpopChartKey = Endpoints['music-charts/kpop-chart']['req']['chartKey'];
export type KpopGroupId = NonNullable<Endpoints['music-charts/kpop-chart']['req']['groupId']>;

export const kpopPlatforms = [
	{ provider: 'melon', label: 'Melon', chartKey: 'melon-top100' },
	{ provider: 'genie', label: 'Genie', chartKey: 'genie-realtime' },
	{ provider: 'bugs', label: 'Bugs', chartKey: 'bugs-realtime' },
	{ provider: 'flo', label: 'FLO', chartKey: 'flo' },
	{ provider: 'apple', label: 'Apple Music', chartKey: 'apple' },
	{ provider: 'spotify', label: 'Spotify', chartKey: 'spotify' },
	{ provider: 'tencent', label: 'Tencent', chartKey: 'tencent' },
	{ provider: 'billboard', label: 'Billboard', chartKey: 'billboard-korea-global-k-songs' },
] as const;

export const kpopMelonScopes = ['melon-top100', 'melon-hot100', 'melon-hot100-d30', 'melon-daily'] as const;

export const kpopGroups = [
	{ id: 'a2o-lite', label: 'A2O LITE' },
	{ id: 'hearts2hearts', label: 'Hearts2Hearts' },
	{ id: 'kiiikiii', label: 'KiiiKiii' },
	{ id: 'baby-dont-cry', label: 'Baby DONT Cry' },
	{ id: 'ifeye', label: 'ifeye' },
	{ id: 'babymonster', label: 'BABYMONSTER' },
	{ id: 'illit', label: 'ILLIT' },
	{ id: 'meovv', label: 'MEOVV' },
	{ id: 'triples', label: 'tripleS' },
	{ id: 'aespa', label: 'aespa' },
	{ id: 'newjeans', label: 'NewJeans' },
	{ id: 'le-sserafim', label: 'LE SSERAFIM' },
	{ id: 'ive', label: 'IVE' },
] as const satisfies readonly { id: KpopGroupId; label: string }[];

export function validKpopChartKey(value: string | undefined): KpopChartKey {
	return [...kpopMelonScopes, ...kpopPlatforms.map(platform => platform.chartKey)].find(key => key === value) ?? 'melon-top100';
}

export function kpopPlatform(key: KpopChartKey): typeof kpopPlatforms[number] {
	return kpopPlatforms.find(platform => platform.chartKey === key) ?? kpopPlatforms[0];
}

export function kpopChartLabel(key: KpopChartKey): string {
	switch (key) {
		case 'melon-top100': return i18n.ts._musicCharts.melonTop100;
		case 'melon-hot100': return i18n.ts._musicCharts.kpopHot100;
		case 'melon-hot100-d30': return i18n.ts._musicCharts.kpopHot30;
		case 'melon-daily': return i18n.ts._musicCharts.melonDaily;
		case 'genie-realtime': return i18n.ts._musicCharts.genieRealtime;
		case 'bugs-realtime': return i18n.ts._musicCharts.bugsRealtime;
		case 'flo': return i18n.ts._musicCharts.kpopFlo;
		case 'apple': return i18n.ts._musicCharts.kpopApple;
		case 'spotify': return i18n.ts._musicCharts.kpopSpotify;
		case 'tencent': return i18n.ts._musicCharts.kpopTencent;
		case 'billboard-korea-global-k-songs': return i18n.ts._musicCharts.kpopBillboard;
	}
}

export function kpopPrevious(chart: KpopChartView | null, failed = false): boolean {
	return chart?.observedAt != null && (failed || chart.status !== 'available');
}

export function kpopStatus(chart: KpopChartView | null, loading = false, failed = false): string {
	if (loading && chart?.observedAt == null) return i18n.ts._musicCharts.compactLoading;
	if (failed) return i18n.ts._musicCharts.refreshFailed;
	switch (chart?.status) {
		case 'available': return i18n.ts._musicCharts.updated;
		case 'stale': return i18n.ts._musicCharts.kpopStale;
		case 'restricted': return i18n.ts._musicCharts.kpopRestricted;
		case 'unavailable': return i18n.ts._musicCharts.compactUnavailable;
		case 'disabled': return i18n.ts._musicCharts.kpopDisabled;
		default: return i18n.ts._musicCharts.compactPending;
	}
}

export function kpopScope(chart: KpopChartView | null): string {
	if (!chart || chart.observedAt == null) return '';
	const coverage = chart.coverage === 'preview'
		? chart.sourceTotal != null ? i18n.tsx._musicCharts.kpopPreviewCount({ count: chart.expectedCount, total: chart.sourceTotal }) : i18n.tsx._musicCharts.kpopPreview({ count: chart.expectedCount })
		: i18n.tsx._musicCharts.kpopComplete({ count: chart.expectedCount });
	return chart.rankBasis === 'playlist_order' ? `${coverage} · ${i18n.ts._musicCharts.kpopPlaylist}` : coverage;
}

export function kpopEmpty(chart: KpopChartView | null): string {
	if (chart?.observedAt == null) return i18n.ts._musicCharts.kpopNoData;
	return chart.coverage === 'preview' ? i18n.ts._musicCharts.kpopPreviewMissing : i18n.ts._musicCharts.kpopNoMatch;
}

export function kpopTime(chart: KpopChartView | null): { label: string; value: string; datetime: string | null } {
	// A supplied date/period is displayed as supplied; an observation never becomes an official period.
	if (chart?.chartKey === 'billboard-korea-global-k-songs' && chart.sourceDate) return { label: i18n.ts._musicCharts.kpopBillboardIssueDate, value: chart.sourceDate, datetime: null };
	if (chart?.sourceUpdatedAt) return { label: i18n.ts._musicCharts.period, value: formatMusicChartPeriod(chart.sourceUpdatedAt) ?? i18n.ts._musicCharts.placeholder, datetime: chart.sourceUpdatedAt };
	if (chart?.sourcePeriod) return { label: i18n.ts._musicCharts.period, value: /^\d{4}-\d{2}-\d{2}$/.test(chart.sourcePeriod) ? chart.sourcePeriod : formatMusicChartPeriod(chart.sourcePeriod) ?? chart.sourcePeriod, datetime: null };
	if (chart?.sourceDate) return { label: i18n.ts._musicCharts.kpopSourceDate, value: chart.sourceDate, datetime: null };
	return { label: i18n.ts._musicCharts.kpopObserved, value: formatMusicChartPeriod(chart?.observedAt ?? null) ?? i18n.ts._musicCharts.placeholder, datetime: chart?.observedAt ?? null };
}

export function kpopPeriodHint(chart: KpopChartView | null): string | null {
	if (chart?.chartKey === 'billboard-korea-global-k-songs' && chart.sourceDate) return i18n.ts._musicCharts.kpopBillboardPeriodHint;
	return chart?.sourcePeriod ? null : i18n.ts._musicCharts.kpopPeriodUnknown;
}

export function kpopDiagnostic(chart: KpopChartView | null): string | null {
	const diagnostic = chart?.diagnostic;
	if (!diagnostic) return null;
	const labels = {
		http_401: i18n.ts._musicCharts.failureUnauthorized,
		http_403: i18n.ts._musicCharts.failureForbidden,
		http_429: i18n.ts._musicCharts.failureRateLimited,
		http_error: i18n.ts._musicCharts.failureHttpError,
		redirect: i18n.ts._musicCharts.failureRedirect,
		timeout: i18n.ts._musicCharts.failureTimeout,
		network_error: i18n.ts._musicCharts.failureNetworkError,
		response_too_large: i18n.ts._musicCharts.failureTooLarge,
		content_type: i18n.ts._musicCharts.failureContentType,
		access_challenge: i18n.ts._musicCharts.kpopChallenge,
		robots_denied: i18n.ts._musicCharts.failureRobotsDenied,
		robots_invalid: i18n.ts._musicCharts.failureRobotsInvalid,
		crawl_delay: i18n.ts._musicCharts.kpopCrawlDelay,
		invalid_payload: i18n.ts._musicCharts.failureInvalidPayload,
		identity_unverified: i18n.ts._musicCharts.failureInvalidPayload,
		url_not_allowed: i18n.ts._musicCharts.kpopUrlNotAllowed,
	};
	return labels[diagnostic.reason] ?? null;
}

export function kpopArtists(entry: KpopEntry): string {
	return entry.artists.map(artist => artist.name).join(' / ');
}

export function kpopTopTwo(entries: readonly KpopEntry[]): KpopEntry[] {
	return entries.filter(entry => Number.isInteger(entry.rank) && entry.rank > 0 && entry.groupIds.length > 0).toSorted((a, b) => a.rank - b.rank).slice(0, 2);
}

export type KpopMovement = { direction: 'up' | 'down' | 'none'; text: string; label: string; basis: 'source' | 'comparison' | 'none' };

export function kpopMovement(entry: KpopEntry): KpopMovement {
	const source = entry.sourceMovement;
	if (source.type === 'up' && source.amount != null && Number.isInteger(source.amount) && source.amount > 0) return { direction: 'up', text: i18n.tsx._musicCharts.rise({ count: source.amount }), label: `↑${source.amount}`, basis: 'source' };
	if (source.type === 'down' && source.amount != null && Number.isInteger(source.amount) && source.amount > 0) return { direction: 'down', text: i18n.tsx._musicCharts.fall({ count: source.amount }), label: `↓${source.amount}`, basis: 'source' };
	if (source.type === 'new') return { direction: 'none', text: i18n.ts._musicCharts.kpopNew, label: 'NEW', basis: 'source' };
	if (source.type === 'same') return { direction: 'none', text: i18n.ts._musicCharts.unchanged, label: '＝', basis: 'source' };
	if (entry.previousRank != null && Number.isInteger(entry.previousRank) && entry.previousRank > 0 && entry.change != null && Number.isInteger(entry.change)) {
		if (entry.change > 0) return { direction: 'up', text: i18n.tsx._musicCharts.rise({ count: entry.change }), label: `↑${entry.change}`, basis: 'comparison' };
		if (entry.change < 0) return { direction: 'down', text: i18n.tsx._musicCharts.fall({ count: -entry.change }), label: `↓${-entry.change}`, basis: 'comparison' };
		return { direction: 'none', text: i18n.ts._musicCharts.unchanged, label: '＝', basis: 'comparison' };
	}
	return { direction: 'none', text: i18n.ts._musicCharts.noComparison, label: '—', basis: 'none' };
}

export function kpopHistoryTimestamp(point: KpopHistory['points'][number], basis: KpopHistory['basis']): number {
	if (basis === 'observation') return Date.parse(point.observedAt);
	if (point.sourcePeriod == null) return NaN;
	// Date-only daily periods use KST day start as a coordinate, never as a claimed publication time.
	if (/^\d{4}-\d{2}-\d{2}$/.test(point.sourcePeriod)) {
		const timestamp = Date.parse(`${point.sourcePeriod}T00:00:00+09:00`);
		return Number.isFinite(timestamp) && formatMusicChartPeriod(new Date(timestamp).toISOString(), true) === point.sourcePeriod ? timestamp : NaN;
	}
	return Date.parse(point.sourcePeriod);
}

export function kpopHistoryRecords(history: KpopHistory): KpopHistory['points'] {
	const from = Date.parse(history.from);
	const to = Date.parse(history.to);
	return history.points.filter(point => {
		const x = kpopHistoryTimestamp(point, history.basis);
		return Number.isFinite(x) && x >= from && x <= to;
	}).toSorted((a, b) => kpopHistoryTimestamp(a, history.basis) - kpopHistoryTimestamp(b, history.basis));
}

export function kpopHistoryPeriod(value: string | null): string {
	if (value == null) return i18n.ts._musicCharts.kpopPeriodUnknown;
	return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : formatMusicChartPeriod(value) ?? i18n.ts._musicCharts.kpopPeriodUnknown;
}

export function kpopHistoryResult(point: KpopHistory['points'][number], preview = false, playlist = false): string {
	if (point.result === 'ranked' && point.rank != null && point.rank > 0) return playlist ? i18n.tsx._musicCharts.kpopPlaylistRank({ rank: point.rank }) : i18n.tsx._musicCharts.rank({ rank: point.rank });
	if (point.result === 'not_listed') return i18n.ts._musicCharts.kpopNotListed;
	return preview ? i18n.ts._musicCharts.kpopPreviewMissing : i18n.ts._musicCharts.missing;
}

export function kpopHistoryPoints(history: KpopHistory): { x: number; y: number | null }[] {
	const points: { x: number; y: number | null }[] = [];
	for (const point of kpopHistoryRecords(history)) {
		const x = kpopHistoryTimestamp(point, history.basis);
		if (point.gapBefore && points.length) points.push({ x: x - 1, y: null });
		points.push({ x, y: point.result === 'ranked' && point.rank != null && point.rank > 0 ? point.rank : null });
	}
	return points;
}
