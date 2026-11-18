/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { MiMusicChartState } from '@/models/MusicChartState.js';
import type { MiMusicChartSnapshot } from '@/models/MusicChartSnapshot.js';
import { MUSIC_CHARTS, type MusicChartKey } from './provider.js';

export type MusicChartOutcome = { snapshot: { period: string; rank: number | null; eligible: boolean } } | { ineligible: true } | { failure: 'restricted' | 'unavailable' };

function chartDefinition(chartKey: MusicChartKey) {
	const definition = MUSIC_CHARTS.find(chart => chart.key === chartKey);
	if (!definition) throw new Error('Unknown music chart');
	return definition;
}

export function initialMusicChartState(chartKey: MusicChartKey): MiMusicChartState {
	return { chartKey, status: 'pending', checkedAt: null, nextAttemptAt: null, failureCount: 0, sourcePeriod: null, lastSuccessAt: null, result: 'unknown', rank: null, previousRank: null, peakRank: null, monitorStartedAt: null };
}

/** A delayed response cannot overwrite a later attempt or move the source period backwards. */
export function applyMusicChartOutcome(state: MiMusicChartState, outcome: MusicChartOutcome, checkedAt: Date): { state: MiMusicChartState; snapshot: MiMusicChartSnapshot | null } | null {
	if (state.checkedAt && state.checkedAt.getTime() >= checkedAt.getTime()) return null;
	const definition = chartDefinition(state.chartKey);
	const next = { ...state, checkedAt };
	if ('ineligible' in outcome) {
		// Eligibility is a local rule, never an observation of a new official period.
		next.status = 'available';
		next.result = 'out_of_scope';
		next.rank = null;
		next.failureCount = 0;
		next.nextAttemptAt = new Date(checkedAt.getTime() + 24 * 3600000);
		return { state: next, snapshot: null };
	}
	if ('snapshot' in outcome) {
		const sourcePeriod = new Date(outcome.snapshot.period);
		const { rank, eligible } = outcome.snapshot;
		if (!Number.isFinite(sourcePeriod.getTime()) || sourcePeriod.getTime() > checkedAt.getTime() || (rank !== null && (!Number.isInteger(rank) || rank < 1 || rank > definition.maxRank)) || !eligible) {
			throw new Error('Invalid music chart snapshot');
		}
		if (state.sourcePeriod && sourcePeriod < state.sourcePeriod) {
			return applyMusicChartOutcome(state, { failure: 'unavailable' }, checkedAt);
		}
		Object.assign(next, {
			status: 'available',
			result: rank === null ? 'unranked' : 'ranked',
			rank,
			previousRank: state.sourcePeriod?.getTime() === sourcePeriod.getTime() ? state.previousRank : state.rank,
			sourcePeriod,
			lastSuccessAt: checkedAt,
			monitorStartedAt: state.monitorStartedAt ?? checkedAt,
			peakRank: rank === null ? state.peakRank : Math.min(state.peakRank ?? rank, rank),
			failureCount: 0,
			nextAttemptAt: new Date(checkedAt.getTime() + definition.intervalMs),
		});
		return { state: next, snapshot: { chartKey: state.chartKey, sourcePeriod, observedAt: checkedAt, rank, eligible } };
	}
	next.status = outcome.failure;
	next.failureCount = Math.min(state.failureCount + 1, 16);
	// Restricted sources are checked at most daily. Transient failures back off to six hours.
	const delay = outcome.failure === 'restricted' ? 24 * 3600000 : Math.min(6 * 3600000, definition.failureIntervalMs * 2 ** (next.failureCount - 1));
	next.nextAttemptAt = new Date(checkedAt.getTime() + delay);
	return { state: next, snapshot: null };
}

export function packMusicChartState(state: MiMusicChartState, now: Date) {
	const definition = chartDefinition(state.chartKey);
	const periodAgeLimit = definition.periodHours === 1 && state.chartKey.startsWith('melon-') ? 12 * 3600000 : definition.periodHours * 3 * 3600000;
	// Scheduling changes must not silently relax the existing freshness rules.
	const lastSuccessAgeLimit = definition.periodHours === 24 ? 3 * 3600000 : 3600000;
	const stale = state.status === 'available' && state.result !== 'out_of_scope' && ((state.lastSuccessAt && now.getTime() - state.lastSuccessAt.getTime() > lastSuccessAgeLimit) || (state.sourcePeriod && now.getTime() - state.sourcePeriod.getTime() > periodAgeLimit));
	return {
		key: state.chartKey,
		label: definition.label,
		sourceUrl: definition.sourceUrl,
		periodHours: definition.periodHours,
		maxRank: definition.maxRank,
		status: stale ? 'stale' as const : state.status,
		result: state.result,
		rank: state.rank,
		previousRank: state.previousRank,
		change: state.rank !== null && state.previousRank !== null ? state.previousRank - state.rank : null,
		sourcePeriod: state.sourcePeriod?.toISOString() ?? null,
		checkedAt: state.checkedAt?.toISOString() ?? null,
		lastSuccessAt: state.lastSuccessAt?.toISOString() ?? null,
		peakRank: state.peakRank,
		monitorStartedAt: state.monitorStartedAt?.toISOString() ?? null,
	};
}

/** KST-aligned slots preserve missing observations instead of joining across gaps. */
export function musicChartHistory(chartKey: MusicChartKey, samples: MiMusicChartSnapshot[], now: Date) {
	const definition = chartDefinition(chartKey);
	const step = definition.periodHours * 3600000;
	const kstOffset = 9 * 3600000;
	const to = Math.floor((now.getTime() + kstOffset) / step) * step - kstOffset;
	const from = to - 7 * 24 * 3600000;
	const byPeriod = new Map(samples.filter(sample => sample.chartKey === chartKey).map(sample => [sample.sourcePeriod.getTime(), sample]));
	const points: { period: string; rank: number | null; result: 'ranked' | 'unranked' | 'out_of_scope' | 'missing' }[] = [];
	for (let period = from; period <= to; period += step) {
		const sample = byPeriod.get(period);
		points.push({ period: new Date(period).toISOString(), rank: sample?.rank ?? null, result: sample ? !sample.eligible ? 'out_of_scope' : sample.rank === null ? 'unranked' : 'ranked' : 'missing' });
	}
	return { chartKey, maxRank: definition.maxRank, from: new Date(from).toISOString(), to: new Date(to).toISOString(), points };
}
