/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { KpopChartKey, KpopGroupId } from '@/utility/kpop-charts.js';
import { kpopGroups, kpopMelonScopes, validKpopChartKey } from '@/utility/kpop-charts.js';

export type KpopMelonChartKey = typeof kpopMelonScopes[number];
export type KpopPreferences = {
	chartKey: KpopChartKey;
	lastMelonChart: KpopMelonChartKey;
	groupId: KpopGroupId | '';
};
type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;
type PreferenceListener = (accountId: string | null, value: KpopPreferences) => void;

export function kpopPreferenceDefaults(): KpopPreferences {
	return { chartKey: 'melon-top100', lastMelonChart: 'melon-top100', groupId: '' };
}

export function isKpopChartKey(value: unknown): value is KpopChartKey {
	return typeof value === 'string' && validKpopChartKey(value) === value;
}

export function isKpopMelonChartKey(value: unknown): value is KpopMelonChartKey {
	return kpopMelonScopes.some(key => key === value);
}

export function isKpopGroupId(value: unknown): value is KpopGroupId | '' {
	return value === '' || kpopGroups.some(group => group.id === value);
}

export function kpopPreferenceStorageKey(accountId: string | null): string {
	return `pubo:kpop-preferences:v1:${accountId == null ? 'guest' : `account:${encodeURIComponent(accountId)}`}`;
}

export function parseKpopPreferences(raw: string | null): KpopPreferences {
	const defaults = kpopPreferenceDefaults();
	if (raw == null) return defaults;
	try {
		const value: unknown = JSON.parse(raw);
		if (value == null || typeof value !== 'object' || Array.isArray(value)) return defaults;
		const record = value as Record<string, unknown>;
		if (record.version !== 1) return defaults;
		const chartKey = isKpopChartKey(record.chartKey) ? record.chartKey : defaults.chartKey;
		return {
			chartKey,
			lastMelonChart: isKpopMelonChartKey(chartKey) ? chartKey : isKpopMelonChartKey(record.lastMelonChart) ? record.lastMelonChart : defaults.lastMelonChart,
			groupId: isKpopGroupId(record.groupId) ? record.groupId : defaults.groupId,
		};
	} catch {
		return defaults;
	}
}

/** Local only. Memory keeps manual choices usable when storage is blocked or full. */
export function createKpopPreferenceStore(getStorage: () => PreferenceStorage) {
	const memory = new Map<string | null, KpopPreferences>();
	const listeners = new Set<PreferenceListener>();
	const unsaved = new Set<string | null>();

	function read(accountId: string | null): KpopPreferences {
		if (unsaved.has(accountId)) return { ...memory.get(accountId)! };
		try {
			const value = parseKpopPreferences(getStorage().getItem(kpopPreferenceStorageKey(accountId)));
			memory.set(accountId, value);
			return { ...value };
		} catch {
			return { ...(memory.get(accountId) ?? kpopPreferenceDefaults()) };
		}
	}

	function update(accountId: string | null, patch: Partial<KpopPreferences>): KpopPreferences {
		const current = read(accountId);
		const chartKey = isKpopChartKey(patch.chartKey) ? patch.chartKey : current.chartKey;
		const value: KpopPreferences = {
			chartKey,
			lastMelonChart: isKpopMelonChartKey(patch.chartKey) ? patch.chartKey : current.lastMelonChart,
			groupId: isKpopGroupId(patch.groupId) ? patch.groupId : current.groupId,
		};
		memory.set(accountId, value);
		try {
			getStorage().setItem(kpopPreferenceStorageKey(accountId), JSON.stringify({ version: 1, ...value }));
			unsaved.delete(accountId);
		} catch {
			unsaved.add(accountId);
		}
		for (const listener of listeners) listener(accountId, { ...value });
		return { ...value };
	}

	function subscribe(listener: PreferenceListener): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	}

	return { read, update, subscribe };
}
