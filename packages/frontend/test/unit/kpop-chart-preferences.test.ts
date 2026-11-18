/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import { createKpopPreferenceStore, kpopPreferenceDefaults, kpopPreferenceStorageKey, parseKpopPreferences } from '@/utility/kpop-chart-preferences.js';

function storage() {
	const data = new Map<string, string>();
	return { getItem: vi.fn((key: string) => data.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { data.set(key, value); }) };
}

describe('K-pop local preference storage', () => {
	it('defaults corrupt, absent and unsupported data safely without retaining arbitrary properties', () => {
		for (const raw of [null, '', '{broken', 'null', '[]', 'true', '{"version":2,"chartKey":"spotify"}']) expect(parseKpopPreferences(raw)).toEqual(kpopPreferenceDefaults());
		expect(parseKpopPreferences(JSON.stringify({ version: 1, chartKey: 'unknown', lastMelonChart: 'invalid', groupId: 'unknown', query: 'not stored', songId: 'not stored' }))).toEqual(kpopPreferenceDefaults());
		expect(parseKpopPreferences(JSON.stringify({ version: 1, chartKey: 'spotify', lastMelonChart: 'melon-hot100-d30', groupId: 'ive', query: 'not stored' }))).toEqual({ chartKey: 'spotify', lastMelonChart: 'melon-hot100-d30', groupId: 'ive' });
	});
	it('keeps the latest Melon category when moving to another platform and survives a fresh store', () => {
		const disk = storage();
		const first = createKpopPreferenceStore(() => disk);
		first.update(null, { chartKey: 'melon-daily' });
		first.update(null, { chartKey: 'genie-realtime' });
		first.update(null, { groupId: 'aespa' });
		const reopened = createKpopPreferenceStore(() => disk);
		expect(reopened.read(null)).toEqual({ chartKey: 'genie-realtime', lastMelonChart: 'melon-daily', groupId: 'aespa' });
		expect(JSON.parse(disk.getItem(kpopPreferenceStorageKey(null))!)).toEqual({ version: 1, chartKey: 'genie-realtime', lastMelonChart: 'melon-daily', groupId: 'aespa' });
	});
	it('isolates guests and accounts, including an account literally named guest', () => {
		const disk = storage();
		const store = createKpopPreferenceStore(() => disk);
		store.update(null, { chartKey: 'apple', groupId: 'ive' });
		store.update('guest', { chartKey: 'spotify' });
		store.update('another-account', { chartKey: 'melon-hot100', groupId: 'aespa' });
		expect(store.read(null).chartKey).toBe('apple');
		expect(store.read('guest')).toEqual({ chartKey: 'spotify', lastMelonChart: 'melon-top100', groupId: '' });
		expect(store.read('another-account').groupId).toBe('aespa');
		expect(store.read('new-account')).toEqual(kpopPreferenceDefaults());
	});
	it('persists Billboard selection with the existing Melon scope and group on reopen', () => {
		const disk = storage();
		const first = createKpopPreferenceStore(() => disk);
		first.update('synthetic-account', { chartKey: 'melon-hot100-d30', groupId: 'ive' });
		first.update('synthetic-account', { chartKey: 'billboard-korea-global-k-songs' });
		expect(createKpopPreferenceStore(() => disk).read('synthetic-account')).toEqual({ chartKey: 'billboard-korea-global-k-songs', lastMelonChart: 'melon-hot100-d30', groupId: 'ive' });
		expect(first.read(null)).toEqual(kpopPreferenceDefaults());
	});
	it('does not write while reading and releases subscriptions', () => {
		const disk = storage();
		const store = createKpopPreferenceStore(() => disk);
		const listener = vi.fn();
		const release = store.subscribe(listener);
		store.read(null);
		expect(disk.setItem).not.toHaveBeenCalled();
		store.update(null, { chartKey: 'flo' });
		expect(listener).toHaveBeenCalledTimes(1);
		release();
		store.update(null, { chartKey: 'apple' });
		expect(listener).toHaveBeenCalledTimes(1);
	});
	it('keeps usable session choices when storage access or quota fails', () => {
		const denied = createKpopPreferenceStore(() => { throw new Error('denied'); });
		expect(denied.read(null)).toEqual(kpopPreferenceDefaults());
		denied.update(null, { chartKey: 'melon-hot100-d30' });
		denied.update(null, { chartKey: 'bugs-realtime' });
		expect(denied.read(null).lastMelonChart).toBe('melon-hot100-d30');
		const disk = storage();
		disk.setItem.mockImplementation(() => { throw new Error('quota'); });
		const full = createKpopPreferenceStore(() => disk);
		full.update(null, { chartKey: 'spotify' });
		full.update(null, { groupId: 'aespa' });
		expect(full.read(null)).toEqual({ chartKey: 'spotify', lastMelonChart: 'melon-top100', groupId: 'aespa' });
		expect(full.read('another-account')).toEqual(kpopPreferenceDefaults());
	});
});
