/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { MusicChartKey, MusicChartReference, MusicChartRow } from '@/utility/music-charts.js';
import { musicChartChange, musicChartDefinitions, musicChartReferenceHasResult, musicChartUsesReference } from '@/utility/music-charts.js';
import { i18n } from '@/i18n.js';

export function musicChartLabel(key: MusicChartKey): string {
	const definition = musicChartDefinitions.find(chart => chart.key === key)!;
	return i18n.ts._musicCharts[definition.labelKey];
}

export function musicChartShortLabel(key: MusicChartKey): string {
	const labels = {
		'melon-daily': i18n.ts._musicCharts.shortMelonDaily,
		'melon-hot100': i18n.ts._musicCharts.shortMelonHot100,
		'melon-top100': i18n.ts._musicCharts.shortMelonTop100,
		'genie-realtime': i18n.ts._musicCharts.shortGenieRealtime,
		'bugs-realtime': i18n.ts._musicCharts.shortBugsRealtime,
	};
	return labels[key];
}

export function musicChartAccessibleLabel(key: MusicChartKey): string {
	const name = musicChartLabel(key);
	if (key === 'melon-hot100') return i18n.tsx._musicCharts.accessibleName({ name, scope: i18n.ts._musicCharts.hot100Scope });
	if (key === 'melon-daily' || key === 'bugs-realtime') return i18n.tsx._musicCharts.accessibleName({ name, scope: i18n.tsx._musicCharts.chartRange({ maxRank: 100 }) });
	return name;
}

export function musicChartIsPreviousResult(row: MusicChartRow, failed = false): boolean {
	return (row.result === 'out_of_scope' || (row.sourcePeriod != null && row.result !== 'unknown')) && (failed || row.status !== 'available');
}

export function musicChartCompactResult(row: MusicChartRow, options: { loading?: boolean; failed?: boolean } = {}): string {
	if (options.loading) return i18n.ts._musicCharts.compactLoading;
	if (musicChartUsesReference(row)) return musicChartReferenceResult(row.reference!, options.failed);
	// HOT100 eligibility can be known without inventing an official source period.
	if (row.result === 'out_of_scope' || (row.sourcePeriod != null && row.result !== 'unknown')) {
		const result = row.result === 'ranked' && row.rank != null
			? i18n.tsx._musicCharts.compactRank({ rank: row.rank })
			: row.result === 'unranked' ? i18n.ts._musicCharts.unranked
				: row.result === 'out_of_scope' ? i18n.ts._musicCharts.compactOutOfScope : null;
		if (result != null) return musicChartIsPreviousResult(row, options.failed) ? i18n.tsx._musicCharts.compactPrevious({ result }) : result;
	}
	if (options.failed) return i18n.ts._musicCharts.compactUnavailable;
	if (row.status === 'pending') return i18n.ts._musicCharts.compactPending;
	if (row.status === 'restricted') return i18n.ts._musicCharts.compactRestricted;
	return i18n.ts._musicCharts.compactUnavailable;
}

export function musicChartReferenceResult(reference: MusicChartReference, failed = false): string {
	if (!musicChartReferenceHasResult(reference)) return i18n.ts._musicCharts.referenceUnavailable;
	const result = reference.result === 'ranked'
		? i18n.tsx._musicCharts.referenceRank({ rank: reference.rank! })
		: i18n.ts._musicCharts.referenceNotFound;
	return failed || reference.status !== 'available' ? i18n.tsx._musicCharts.compactPrevious({ result }) : result;
}

export function musicChartReferenceScope(reference: MusicChartReference): string {
	return reference.scope === 'reference-top200' ? i18n.ts._musicCharts.referenceTop200 : i18n.ts._musicCharts.referenceTop100;
}

export function musicChartReferenceStatus(reference: MusicChartReference, failed = false): string {
	if (failed) return i18n.ts._musicCharts.refreshFailed;
	if (reference.status === 'available') return i18n.ts._musicCharts.updated;
	if (reference.status === 'restricted') return i18n.ts._musicCharts.referenceRestricted;
	if (reference.status === 'stale') return i18n.ts._musicCharts.referenceStale;
	return i18n.ts._musicCharts.referencePaused;
}

export function musicChartReferenceFailure(reference: MusicChartReference): string | null {
	if (reference.status === 'available') return null;
	const diagnostic = reference.diagnostic;
	if (diagnostic == null) return reference.status === 'restricted' || reference.status === 'unavailable' ? i18n.ts._musicCharts.referenceFailureUnknown : null;
	const reasons: Record<NonNullable<MusicChartReference['diagnostic']>['reason'], string> = {
		robots_denied: i18n.ts._musicCharts.failureRobotsDenied,
		robots_invalid: i18n.ts._musicCharts.failureRobotsInvalid,
		http_401: i18n.ts._musicCharts.failureUnauthorized,
		http_403: i18n.ts._musicCharts.failureForbidden,
		http_429: i18n.ts._musicCharts.failureRateLimited,
		timeout: i18n.ts._musicCharts.failureTimeout,
		redirect: i18n.ts._musicCharts.failureRedirect,
		content_type: i18n.ts._musicCharts.failureContentType,
		invalid_payload: i18n.ts._musicCharts.failureInvalidPayload,
		http_error: i18n.ts._musicCharts.failureHttpError,
		network_error: i18n.ts._musicCharts.failureNetworkError,
		response_too_large: i18n.ts._musicCharts.failureTooLarge,
	};
	const phases = {
		robots: i18n.ts._musicCharts.failurePhaseRobots,
		page: i18n.ts._musicCharts.failurePhasePage,
		parse: i18n.ts._musicCharts.failurePhaseParse,
	};
	return i18n.tsx._musicCharts.referenceFailureDetail({ phase: phases[diagnostic.phase], reason: reasons[diagnostic.reason] });
}

export function musicChartCompactAccessibleResult(row: MusicChartRow, options: { loading?: boolean; failed?: boolean } = {}): string {
	const result = musicChartCompactResult(row, options);
	if (options.loading) return result;
	if (!musicChartUsesReference(row)) {
		return row.status === 'restricted' && row.result === 'unknown' && !options.failed ? i18n.ts._musicCharts.restricted : result;
	}
	return i18n.tsx._musicCharts.referenceAccessible({ result, scope: musicChartReferenceScope(row.reference!) });
}

export function musicChartRankLabel(row: { result: MusicChartRow['result'] | 'missing'; rank: number | null }): string {
	if (row.result === 'ranked' && row.rank != null) return i18n.tsx._musicCharts.rank({ rank: row.rank });
	if (row.result === 'unranked') return i18n.ts._musicCharts.unranked;
	if (row.result === 'out_of_scope') return i18n.ts._musicCharts.outOfScope;
	return i18n.ts._musicCharts.placeholder;
}

export function musicChartStatusLabel(row: MusicChartRow): string {
	if (row.status === 'pending') return i18n.ts._musicCharts.pending;
	if (row.status === 'restricted') return i18n.ts._musicCharts.restricted;
	if (row.status === 'available') return i18n.ts._musicCharts.updated;
	return row.sourcePeriod ? i18n.ts._musicCharts.lastResult : i18n.ts._musicCharts.unavailable;
}

export function musicChartChangeLabel(row: MusicChartRow): string {
	const difference = musicChartChange(row);
	if (difference == null) return i18n.ts._musicCharts.noComparison;
	if (difference === 0) return i18n.ts._musicCharts.unchanged;
	return difference > 0 ? i18n.tsx._musicCharts.rise({ count: difference }) : i18n.tsx._musicCharts.fall({ count: -difference });
}
