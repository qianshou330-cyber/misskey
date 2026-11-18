/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export type KpopMotionRow = { songId: string; rank: number };
export type KpopRankChange = { from: number; to: number };

/** Compare displayed identities and real ranks, never poll timestamps or source arrows. */
export function planKpopListMotion(previous: readonly KpopMotionRow[] | null, next: readonly KpopMotionRow[]): { changed: boolean; rankChanges: Map<string, KpopRankChange>; changedIds: Set<string> } {
	const rankChanges = new Map<string, KpopRankChange>();
	const changedIds = new Set<string>();
	const valid = (rows: readonly KpopMotionRow[]): boolean => new Set(rows.map(row => row.songId)).size === rows.length
		&& rows.every(row => row.songId.length > 0 && Number.isInteger(row.rank) && row.rank > 0);
	if (!previous || !valid(previous) || !valid(next)) return { changed: false, rankChanges, changedIds };
	const old = new Map(previous.map(row => [row.songId, row.rank]));
	for (const row of next) {
		const rank = old.get(row.songId);
		if (rank === undefined || rank !== row.rank) changedIds.add(row.songId);
		if (rank !== undefined && rank !== row.rank) rankChanges.set(row.songId, { from: rank, to: row.rank });
	}
	const changed = previous.length !== next.length || next.some((row, index) => previous[index]?.songId !== row.songId || previous[index]?.rank !== row.rank);
	return { changed, rankChanges, changedIds };
}
