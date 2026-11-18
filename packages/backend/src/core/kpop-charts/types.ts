/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const KPOP_CHART_KEYS = ['melon-daily', 'melon-hot100', 'melon-top100', 'melon-hot100-d30', 'genie-realtime', 'bugs-realtime', 'flo', 'apple', 'spotify', 'tencent', 'billboard-korea-global-k-songs'] as const;
export type KpopChartKey = typeof KPOP_CHART_KEYS[number];
export const KPOP_SOURCES = ['melon', 'genie', 'bugs', 'flo', 'apple', 'spotify', 'tencent', 'billboard'] as const;
export type KpopSource = typeof KPOP_SOURCES[number];
export const KPOP_GROUP_IDS = ['a2o-lite', 'hearts2hearts', 'kiiikiii', 'baby-dont-cry', 'ifeye', 'babymonster', 'illit', 'meovv', 'triples', 'aespa', 'newjeans', 'le-sserafim', 'ive'] as const;
export type KpopGroupId = typeof KPOP_GROUP_IDS[number];
export type KpopArtist = { id: string | null; name: string };
export type KpopEntry = {
	songId: string; rank: number; title: string; artists: KpopArtist[];
	album: string | null; albumId: string | null; albumCoverUrl: string | null;
	sourceMovement: { type: 'up' | 'down' | 'same' | 'new' | 'unknown'; amount: number | null };
	groupIds: KpopGroupId[];
};
export type KpopSnapshot = {
	schemaVersion: 1; chartKey: KpopChartKey; source: KpopSource; sourceUrl: string;
	sourcePeriod: string | null; sourceUpdatedAt: string | null; sourceDate: string | null; observedAt: string;
	coverage: 'complete' | 'preview'; sourceTotal: number | null; expectedCount: number;
	rankBasis: 'official_rank' | 'playlist_order'; entries: KpopEntry[]; contentHash: string; rawHash: string;
};
export type KpopReader = (url: string) => Promise<{ body: string; observedAt: string }>;
export const KPOP_FAILURE_REASONS = ['http_401', 'http_403', 'http_429', 'http_error', 'redirect', 'timeout', 'network_error', 'response_too_large', 'content_type', 'access_challenge', 'robots_invalid', 'crawl_delay', 'invalid_payload', 'identity_unverified', 'url_not_allowed', 'robots_denied'] as const;
export type KpopDiagnostic = {
	phase: 'robots' | 'page' | 'parse'; reason: typeof KPOP_FAILURE_REASONS[number];
	httpStatus: number | null; retryAfterAt: string | null; elapsedMs: number;
};
export type KpopRobotsAudit = {
	source: KpopSource; url: string; checkedAt: string; robotsHash: string;
	mode: 'record'; allowed: boolean | null; crawlDelaySeconds: number; httpStatus: number;
};
export class KpopSourceError extends Error {
	public readonly code: KpopDiagnostic['reason'];
	public robotsAudit: KpopRobotsAudit[] = [];
	constructor(public readonly diagnostic: KpopDiagnostic) {
		super(diagnostic.reason);
		this.name = 'KpopSourceError';
		this.code = diagnostic.reason;
	}
}
