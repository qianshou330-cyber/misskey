/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { MusicChartKey } from './types.js';
import type { ReferenceSnapshot, ReferenceSource } from './reference-parser.js';
import { MUSIC_CHART_INTERVAL_MS } from './schedule.js';
import { parseReferenceDiagnostic, type ReferenceDiagnostic } from './reference-diagnostic.js';

export const REFERENCE_RETENTION_MS = 7 * 24 * 3600000;
export const REFERENCE_INTERVAL_MS = MUSIC_CHART_INTERVAL_MS;
// Preserve the existing failure policy independently of the successful cadence.
export const REFERENCE_FAILURE_INTERVAL_MS = 15 * 60000;
export const REFERENCE_SOURCES = ['melon', 'genie', 'bugs'] as const;
export const REFERENCE_CHARTS = {
	'melon-daily': { source: 'melon', maxRank: 100, maxAge: 72 * 3600000 },
	'melon-top100': { source: 'melon', maxRank: 100, maxAge: 3 * 3600000 },
	'genie-realtime': { source: 'genie', maxRank: 200, maxAge: 3 * 3600000 },
	'bugs-realtime': { source: 'bugs', maxRank: 100, maxAge: 3 * 3600000 },
} as const;
export type ReferenceChartKey = keyof typeof REFERENCE_CHARTS;
export const REFERENCE_ORIGIN = 'https://www.chartradar.app';

export function referenceUrl(source: ReferenceSource): string {
	if (!REFERENCE_SOURCES.includes(source)) throw new Error('Unknown reference source');
	return `${REFERENCE_ORIGIN}/charts/${source}`;
}

export function enabledReferenceCharts(value = process.env.PUBO_MUSIC_CHART_REFERENCES): ReferenceChartKey[] {
	const requested = new Set((value ?? '').split(',').map(key => key.trim()));
	return (Object.keys(REFERENCE_CHARTS) as ReferenceChartKey[]).filter(key => requested.has(key));
}

export function referenceAttemptKey(source: ReferenceSource): string {
	return `musicChartReference:v1:attempt:${source}`;
}

export function referenceSnapshotKey(chart: ReferenceChartKey): string {
	return `musicChartReference:v1:snapshot:${chart}`;
}

export type ReferenceAttempt = {
	checkedAt: number;
	nextAttemptAt: number;
	status: 'available' | 'restricted' | 'unavailable';
	failureCount: number;
	diagnostic?: ReferenceDiagnostic | null;
};

export type CachedReferenceSnapshot = ReferenceSnapshot & { lastSuccessAt: string };
export type MusicChartReference = {
	provider: 'chartradar';
	sourceUrl: string;
	scope: 'top100' | 'reference-top200';
	status: 'available' | 'stale' | 'restricted' | 'unavailable';
	result: 'ranked' | 'not_found' | 'unknown';
	rank: number | null;
	sourceTimeLabel: string | null;
	sourceFetchedAt: string | null;
	checkedAt: string | null;
	lastSuccessAt: string | null;
	nextAttemptAt: string | null;
	diagnostic: ReferenceDiagnostic | null;
	basis: 'title_artist';
};

function parseJson(raw: string | null): unknown {
	try { return raw && raw.length <= 4096 ? JSON.parse(raw) : null; } catch { return null; }
}

export function parseReferenceAttempt(raw: string | null): ReferenceAttempt | null {
	const value = parseJson(raw) as Partial<ReferenceAttempt> | null;
	if (!value || !['available', 'restricted', 'unavailable'].includes(value.status ?? '') || !Number.isSafeInteger(value.checkedAt) || !Number.isSafeInteger(value.nextAttemptAt) || !Number.isSafeInteger(value.failureCount)) return null;
	if (value.checkedAt! <= 0 || value.nextAttemptAt! < value.checkedAt! || value.nextAttemptAt! > 8640000000000000 - REFERENCE_INTERVAL_MS || value.failureCount! < 0 || value.failureCount! > 100) return null;
	return { checkedAt: value.checkedAt!, nextAttemptAt: value.nextAttemptAt!, status: value.status!, failureCount: value.failureCount!, diagnostic: value.status === 'available' ? null : parseReferenceDiagnostic(value.diagnostic) };
}

export function validateReferenceSnapshot(snapshot: ReferenceSnapshot, now: Date): ReferenceChartKey {
	if (!snapshot || !Object.hasOwn(REFERENCE_CHARTS, snapshot.chartKey)) throw new Error('Unknown reference chart');
	const key = snapshot.chartKey as ReferenceChartKey;
	const timestamp = Date.parse(snapshot.sourceFetchedAt);
	if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== snapshot.sourceFetchedAt || timestamp > now.getTime() || timestamp <= 0) throw new Error('Invalid reference timestamp');
	if (typeof snapshot.sourceTimeLabel !== 'string' || !snapshot.sourceTimeLabel.trim() || snapshot.sourceTimeLabel.length > 200) throw new Error('Invalid reference time label');
	if (snapshot.result === 'ranked') {
		if (!Number.isInteger(snapshot.rank) || snapshot.rank! < 1 || snapshot.rank! > REFERENCE_CHARTS[key].maxRank) throw new Error('Invalid reference rank');
	} else if (snapshot.result !== 'not_found' || snapshot.rank !== null) throw new Error('Invalid reference result');
	return key;
}

export function packReference(key: ReferenceChartKey, snapshotRaw: string | null, attemptRaw: string | null, now: Date): MusicChartReference | null {
	const parsedAttempt = parseReferenceAttempt(attemptRaw);
	const attempt = parsedAttempt && parsedAttempt.checkedAt <= now.getTime() && Math.max(parsedAttempt.checkedAt + REFERENCE_RETENTION_MS, parsedAttempt.nextAttemptAt + REFERENCE_INTERVAL_MS) > now.getTime() ? parsedAttempt : null;
	let snapshot = parseJson(snapshotRaw) as CachedReferenceSnapshot | null;
	try {
		if (!snapshot || validateReferenceSnapshot(snapshot, now) !== key || Date.parse(snapshot.sourceFetchedAt) + REFERENCE_RETENTION_MS <= now.getTime() || !Number.isFinite(Date.parse(snapshot.lastSuccessAt)) || Date.parse(snapshot.lastSuccessAt) > now.getTime()) snapshot = null;
	} catch { snapshot = null; }
	if (!snapshot && (!attempt || attempt.status === 'available')) return null;
	const definition = REFERENCE_CHARTS[key];
	const failed = attempt?.status === 'restricted' || attempt?.status === 'unavailable';
	return {
		provider: 'chartradar', sourceUrl: referenceUrl(definition.source), scope: definition.maxRank === 200 ? 'reference-top200' : 'top100',
		status: failed ? attempt.status : snapshot && now.getTime() - Date.parse(snapshot.sourceFetchedAt) > definition.maxAge ? 'stale' : 'available',
		result: snapshot?.result ?? 'unknown', rank: snapshot?.rank ?? null,
		sourceTimeLabel: snapshot?.sourceTimeLabel ?? null, sourceFetchedAt: snapshot?.sourceFetchedAt ?? null,
		checkedAt: attempt ? new Date(attempt.checkedAt).toISOString() : null, lastSuccessAt: snapshot?.lastSuccessAt ?? null, basis: 'title_artist',
		nextAttemptAt: attempt ? new Date(attempt.nextAttemptAt).toISOString() : null, diagnostic: failed ? attempt.diagnostic ?? null : null,
	};
}

/** All keys are module-owned. Metadata and snapshots are committed in one Redis operation.
 * Snapshot expiry is absolute source age; duplicate fetches and failures cannot renew it.
 * A newer request start or source timestamp wins, including across separate workers.
 */
export const REFERENCE_WRITE_SCRIPT = `
local checked = tonumber(ARGV[1])
local status = ARGV[2]
local snapshots = cjson.decode(ARGV[3])
local retention = tonumber(ARGV[4])
local interval = tonumber(ARGV[5])
local failureInterval = tonumber(ARGV[6]) or 900000
local diagnostic = ARGV[7] and cjson.decode(ARGV[7]) or cjson.null
local retryAfter = tonumber(ARGV[8]) or 0
local currentRaw = redis.call('GET', KEYS[1])
local current = nil
if currentRaw then current = cjson.decode(currentRaw) end
if current and current.checkedAt >= checked then return 0 end
-- A collection that started before a concurrent failure was committed must
-- not clear its pause. Only the separately guarded recovery CAS may do that.
if status == 'available' and current and current.status ~= 'available' and current.nextAttemptAt > checked then return 0 end
local existing = {}
for i, incoming in ipairs(snapshots) do
  local raw = redis.call('GET', KEYS[i + 1])
  if raw then
    existing[i] = cjson.decode(raw)
    if existing[i].sourceFetchedAt > incoming.sourceFetchedAt then return 0 end
  end
end
local failures = 0
local delay = interval
if status ~= 'available' then
  failures = math.min(100, (current and current.failureCount or 0) + 1)
  if status == 'restricted' then delay = 86400000
  else delay = math.min(21600000, failureInterval * (2 ^ math.min(10, failures - 1))) end
end
local nextAttempt = checked + delay
if status ~= 'available' then nextAttempt = math.max(nextAttempt, retryAfter, current and current.nextAttemptAt or 0) else diagnostic = cjson.null end
for i, incoming in ipairs(snapshots) do
  if not existing[i] or existing[i].sourceFetchedAt < incoming.sourceFetchedAt then
    local expires = incoming.sourceFetchedMs + retention
    if expires > checked then
      incoming.sourceFetchedMs = nil
      redis.call('SET', KEYS[i + 1], cjson.encode(incoming), 'PXAT', expires)
    end
  end
end
local attempt = {checkedAt=checked, nextAttemptAt=nextAttempt, status=status, failureCount=failures, diagnostic=diagnostic}
redis.call('SET', KEYS[1], cjson.encode(attempt), 'PXAT', math.max(checked + retention, nextAttempt + interval))
return 1
`;

export type ReferenceMap = Partial<Record<MusicChartKey, MusicChartReference>>;
