/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const MUSIC_CHART_INTERVAL_MS = 60 * 60_000;
export const MUSIC_CHART_SCHEDULE_VERSION = 1;

// Stable slots never depend on which sources are enabled or their array order.
// Future QQ and official Melon-query providers reserve minutes 21 and 23.
export const MUSIC_CHART_SCHEDULE_MINUTES = {
	'melon-daily': 5,
	'melon-hot100': 7,
	'melon-top100': 9,
	'genie-realtime': 11,
	'bugs-realtime': 13,
	'reference:melon': 15,
	'reference:genie': 17,
	'reference:bugs': 19,
} as const;
export const MUSIC_CHART_RESERVED_MINUTES = { qq: 21, melonQuery: 23 } as const;
export type MusicChartTask = keyof typeof MUSIC_CHART_SCHEDULE_MINUTES;

export function hourlyMusicChartSchedule(minute: number) {
	if (!Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error('Invalid chart schedule minute');
	return { pattern: `0 ${minute} * * * *`, tz: 'UTC' };
}

export function musicChartSchedule(task: MusicChartTask) {
	if (!Object.hasOwn(MUSIC_CHART_SCHEDULE_MINUTES, task)) throw new Error('Unknown chart schedule');
	return hourlyMusicChartSchedule(MUSIC_CHART_SCHEDULE_MINUTES[task]);
}

export function nextMusicChartSlot(task: MusicChartTask, now: number): number {
	musicChartSchedule(task);
	const slot = Math.floor(now / MUSIC_CHART_INTERVAL_MS) * MUSIC_CHART_INTERVAL_MS + MUSIC_CHART_SCHEDULE_MINUTES[task] * 60_000;
	return slot > now ? slot : slot + MUSIC_CHART_INTERVAL_MS;
}

export function musicChartJobSlot(task: MusicChartTask, jobId: string | undefined): number | null {
	const prefix = `repeat:${task}:`;
	if (!jobId?.startsWith(prefix)) return null;
	const suffix = jobId.slice(prefix.length);
	if (!/^\d{13}$/.test(suffix)) return null;
	const slot = Number(suffix);
	return Number.isSafeInteger(slot) && slot % MUSIC_CHART_INTERVAL_MS === MUSIC_CHART_SCHEDULE_MINUTES[task] * 60_000 ? slot : null;
}

export type MusicChartCollectionResult = { deferUntil: number } | undefined;
type CollectionGate = { action: 'run' | 'skip' } | { action: 'defer'; deferUntil: number };

/** Failures retain their longer backoff. Successful jobs which arrive a little
 * before the last actual start + one hour wait without losing the whole slot.
 * A completed observation in this logical slot also suppresses stale retries.
 */
export function musicChartCollectionGate(current: { checkedAt: number; nextAttemptAt: number; status: string; result?: string } | null, now: number, scheduledAt?: number): CollectionGate {
	if (scheduledAt != null && scheduledAt > now) return { action: 'skip' };
	if (!current) return { action: 'run' };
	if (scheduledAt != null && current.checkedAt >= scheduledAt) return { action: 'skip' };
	const successful = current.status === 'available' && current.result !== 'out_of_scope';
	// Old successful cache entries still carry the previous 15-minute interval.
	// Enforce the new interval without rewriting them or shortening any backoff.
	const nextAttemptAt = successful ? Math.max(current.nextAttemptAt, current.checkedAt + MUSIC_CHART_INTERVAL_MS) : current.nextAttemptAt;
	if (nextAttemptAt <= now) return { action: 'run' };
	if (successful && nextAttemptAt - now <= MUSIC_CHART_INTERVAL_MS) return { action: 'defer', deferUntil: nextAttemptAt };
	return { action: 'skip' };
}
