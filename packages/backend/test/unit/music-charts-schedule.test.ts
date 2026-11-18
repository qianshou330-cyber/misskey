/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import { MUSIC_CHARTS } from '@/core/music-charts/provider.js';
import { REFERENCE_INTERVAL_MS } from '@/core/music-charts/reference-state.js';
import { MUSIC_CHART_INTERVAL_MS, MUSIC_CHART_RESERVED_MINUTES, MUSIC_CHART_SCHEDULE_MINUTES, hourlyMusicChartSchedule, musicChartCollectionGate, musicChartJobSlot, musicChartSchedule, nextMusicChartSlot, type MusicChartTask } from '@/core/music-charts/schedule.js';

describe('Stable hourly collection scheduling', () => {
	it('uses one shared hourly interval and distinct stable slots including reserved providers', () => {
		expect(MUSIC_CHART_INTERVAL_MS).toBe(3600000);
		expect(REFERENCE_INTERVAL_MS).toBe(MUSIC_CHART_INTERVAL_MS);
		expect(MUSIC_CHARTS.every(chart => chart.intervalMs === MUSIC_CHART_INTERVAL_MS)).toBe(true);
		const minutes = [...Object.values(MUSIC_CHART_SCHEDULE_MINUTES), ...Object.values(MUSIC_CHART_RESERVED_MINUTES)];
		expect(minutes).toEqual([5, 7, 9, 11, 13, 15, 17, 19, 21, 23]);
		expect(new Set(minutes).size).toBe(minutes.length);
		expect(hourlyMusicChartSchedule(MUSIC_CHART_RESERVED_MINUTES.qq)).toEqual({ pattern: '0 21 * * * *', tz: 'UTC' });
	});
	it.each([-1, 60, 1.5, NaN])('rejects invalid minute %s', minute => {
		expect(() => hourlyMusicChartSchedule(minute)).toThrow();
	});
	it('rejects inherited or unknown schedule names', () => {
		expect(() => musicChartSchedule('constructor' as MusicChartTask)).toThrow();
	});
	it('never chooses an immediate or elapsed startup slot, including the exact boundary', () => {
		const boundary = Date.parse('2026-10-16T16:15:00.000Z');
		expect(nextMusicChartSlot('reference:melon', boundary - 1)).toBe(boundary);
		expect(nextMusicChartSlot('reference:melon', boundary)).toBe(boundary + MUSIC_CHART_INTERVAL_MS);
		expect(nextMusicChartSlot('reference:melon', boundary + 1)).toBe(boundary + MUSIC_CHART_INTERVAL_MS);
		expect(musicChartCollectionGate(null, boundary - 1, boundary)).toEqual({ action: 'skip' });
		expect(musicChartCollectionGate(null, boundary, boundary)).toEqual({ action: 'run' });
	});
	it('accepts only canonical scheduler jobs at their fixed minute', () => {
		const slot = Date.parse('2026-10-16T16:15:00.000Z');
		expect(musicChartJobSlot('reference:melon', `repeat:reference:melon:${slot}`)).toBe(slot);
		for (const id of [undefined, `repeat:reference:bugs:${slot}`, `repeat:reference:melon:${slot + 1}`, `repeat:reference:melon:0${slot}`, `manual:${slot}`]) {
			expect(musicChartJobSlot('reference:melon', id)).toBeNull();
		}
	});
	it('defers a successful early job and runs exactly at the cooldown boundary instead of skipping two hours', () => {
		const slot = Date.parse('2026-10-16T17:15:00.000Z');
		const previous = { checkedAt: slot - MUSIC_CHART_INTERVAL_MS + 51, nextAttemptAt: slot + 51, status: 'available' };
		expect(musicChartCollectionGate(previous, slot, slot)).toEqual({ action: 'defer', deferUntil: slot + 51 });
		expect(musicChartCollectionGate(previous, slot + 50, slot)).toEqual({ action: 'defer', deferUntil: slot + 51 });
		expect(musicChartCollectionGate(previous, slot + 51, slot)).toEqual({ action: 'run' });
		const current = { checkedAt: slot + 51, nextAttemptAt: slot + MUSIC_CHART_INTERVAL_MS + 51, status: 'available' };
		expect(musicChartCollectionGate(current, slot + 100, slot)).toEqual({ action: 'skip' });
		expect(musicChartCollectionGate(current, slot + MUSIC_CHART_INTERVAL_MS, slot + MUSIC_CHART_INTERVAL_MS)).toEqual({ action: 'defer', deferUntil: current.nextAttemptAt });
		expect(musicChartCollectionGate(current, current.nextAttemptAt, slot + MUSIC_CHART_INTERVAL_MS)).toEqual({ action: 'run' });
	});
	it.each(['restricted', 'unavailable'])('preserves %s backoff and only permits collection after it expires', status => {
		const now = Date.parse('2026-10-16T17:15:00.000Z');
		const state = { checkedAt: now - 1000, nextAttemptAt: now + 86400000, status };
		expect(musicChartCollectionGate(state, now)).toEqual({ action: 'skip' });
		expect(musicChartCollectionGate(state, state.nextAttemptAt)).toEqual({ action: 'run' });
		expect(musicChartCollectionGate({ ...state, nextAttemptAt: now + 1000 }, now)).toEqual({ action: 'skip' });
	});
	it('does not defer expired scope checks or duplicate logical attempts', () => {
		const current = { checkedAt: 1000, nextAttemptAt: 2000, status: 'available', result: 'out_of_scope' };
		expect(musicChartCollectionGate(current, 1500)).toEqual({ action: 'skip' });
		expect(musicChartCollectionGate(current, 2500, 1000)).toEqual({ action: 'skip' });
		expect(musicChartCollectionGate(null, 1500)).toEqual({ action: 'run' });
	});
	it('upgrades an old successful 15-minute cooldown without rewriting it or shortening restrictions', () => {
		const now = Date.parse('2026-10-16T17:15:00.000Z');
		const old = { checkedAt: now - 1800000, nextAttemptAt: now - 900000, status: 'available' };
		expect(musicChartCollectionGate(old, now, now)).toEqual({ action: 'defer', deferUntil: old.checkedAt + MUSIC_CHART_INTERVAL_MS });
		expect(old.nextAttemptAt).toBe(now - 900000);
		expect(musicChartCollectionGate({ ...old, nextAttemptAt: now + 86400000, status: 'restricted' }, now, now)).toEqual({ action: 'skip' });
	});
});
