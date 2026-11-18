/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export type ChartType = 'DAILY' | 'TOP100' | 'HOT100';
export type HotWindow = 'D30' | 'D100';
export interface Artist { id: string | null; name: string }
export interface ChartEntry {
	songId: string;
	rank: number;
	title: string;
	artists: Artist[];
	album: string;
	albumId: string | null;
	albumCoverUrl?: string | null;
	sourceMovement: { type: 'up' | 'down' | 'same' | 'new' | 'unknown'; amount: number | null };
}
export interface ParsedSnapshot {
	chartType: ChartType;
	window: HotWindow | null;
	chartDate: string;
	chartHour: number | null;
	sourceTimestamp: string;
	sourceUrl: string;
	fetchedAt: string;
	contentHash: string;
	rawHtmlHash: string;
	entries: ChartEntry[];
}
export interface ChartTarget { chartType: ChartType; window: HotWindow | null; url: string; key: string }
export const TARGETS: ChartTarget[] = [
	{ chartType: 'DAILY', window: null, key: 'DAILY', url: 'https://www.melon.com/chart/day/index.htm' },
	{ chartType: 'TOP100', window: null, key: 'TOP100', url: 'https://www.melon.com/chart/index.htm' },
	{ chartType: 'HOT100', window: 'D100', key: 'HOT100:D100', url: 'https://www.melon.com/chart/hot100/index.htm' },
	{ chartType: 'HOT100', window: 'D30', key: 'HOT100:D30', url: 'https://www.melon.com/chart/hot100/index.htm?chartType=D30' },
];
export function chartKey(type: ChartType, window: HotWindow | null): string {
	return window ? `${type}:${window}` : type;
}
