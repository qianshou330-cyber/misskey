/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { MiKpopChartSnapshot } from '@/models/KpopChartSnapshot.js';
import { KPOP_CHARTS, matchKpopGroups } from './catalog.js';
import { assertKpopSnapshot, kpopContentHash } from './parser.js';
import { KpopSourceError, type KpopArtist, type KpopChartKey, type KpopEntry, type KpopSource } from './types.js';

/** Classification is a current view of complete stored entries, never a write. */
export function projectKpopGroups<T extends { artists: KpopArtist[] }>(source: KpopSource, entries: T[]) {
	return entries.map(entry => ({ ...entry, groupIds: matchKpopGroups(source, entry.artists) }));
}

/** Keep the published hash format. Reclassify a verified old snapshot in memory
 * only when comparing it with a new observation after the catalogue changes. */
export function reclassifiedKpopHash(previous: MiKpopChartSnapshot, entries: KpopEntry[]): string {
	const key = previous.chartKey as KpopChartKey;
	if (!Object.hasOwn(KPOP_CHARTS, key)) throw new KpopSourceError({ phase: 'parse', reason: 'invalid_payload', httpStatus: null, retryAfterAt: null, elapsedMs: 0 });
	const snapshot = {
		schemaVersion: 1 as const, chartKey: key, source: previous.source as KpopSource, sourceUrl: KPOP_CHARTS[key].url,
		sourcePeriod: previous.sourcePeriod, sourceUpdatedAt: previous.sourceUpdatedAt?.toISOString() ?? null, sourceDate: previous.sourceDate,
		observedAt: previous.observedAt.toISOString(), coverage: previous.coverage as 'complete' | 'preview', sourceTotal: previous.sourceTotal,
		expectedCount: previous.expectedCount, rankBasis: previous.rankBasis as 'official_rank' | 'playlist_order',
		entries: entries.map(entry => ({ songId: entry.songId, rank: entry.rank, title: entry.title, artists: entry.artists, album: entry.album,
			albumId: entry.albumId, albumCoverUrl: entry.albumCoverUrl, sourceMovement: entry.sourceMovement, groupIds: entry.groupIds })),
		contentHash: previous.contentHash, rawHash: previous.rawHash,
	};
	if (kpopContentHash(snapshot) !== previous.contentHash) throw new KpopSourceError({ phase: 'parse', reason: 'invalid_payload', httpStatus: null, retryAfterAt: null, elapsedMs: 0 });
	const current = { ...snapshot, entries: projectKpopGroups(snapshot.source, snapshot.entries) };
	current.contentHash = kpopContentHash(current);
	assertKpopSnapshot(current);
	return current.contentHash;
}
