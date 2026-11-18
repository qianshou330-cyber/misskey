/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from 'node:crypto';
import type { Artist, ChartEntry } from './parser-types.js';

export type ExternalProvider = 'melon' | 'bugs' | 'spotify' | 'tencent' | 'apple' | 'flo' | 'genie' | 'billboard';
export interface ExternalEntry {
	songId: string; rank: number; title: string; artists: Artist[];
	album: string | null; albumId: string | null; albumCoverUrl: string | null;
	sourceMovement: ChartEntry['sourceMovement'];
}
export interface ExternalSnapshot {
	provider: ExternalProvider; chartKey: string; sourceUrl: string;
	sourceUpdatedAt: string | null; chartDate: string | null; fetchedAt: string;
	expectedCount: number; entries: ExternalEntry[]; contentHash: string; rawHash: string;
	coverage?: 'complete' | 'preview'; sourceTotal?: number | null;
}
export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
/** Fetch time is evidence, never an invented official chart date. */
export function finishSnapshot(value: Omit<ExternalSnapshot, 'contentHash' | 'rawHash'>, raw: string): ExternalSnapshot {
	return { ...value, contentHash: sha256(JSON.stringify({ provider: value.provider, chartKey: value.chartKey,
																																																									sourceUpdatedAt: value.sourceUpdatedAt, chartDate: value.chartDate, entries: value.entries,
																																																									...(value.coverage ? { coverage: value.coverage } : {}), ...(value.sourceTotal !== undefined ? { sourceTotal: value.sourceTotal } : {}) })), rawHash: sha256(raw) };
}
