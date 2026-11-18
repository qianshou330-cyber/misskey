/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { parseReferencePage, type ReferenceSnapshot } from './reference-parser.js';
import { parseReferenceAttempt, REFERENCE_CHARTS, validateReferenceSnapshot } from './reference-state.js';
import { MUSIC_CHART_INTERVAL_MS } from './schedule.js';

const KEYS = ['melon-daily', 'melon-top100'] as const;
export type MelonRecoverySample = {
	source: 'melon';
	checkedAt: string;
	parserSha256: string;
	charts: { entryCount: 100; snapshot: ReferenceSnapshot }[];
};
export type MelonRecoveryExpected = readonly [attempt: string, daily: string | null, top100: string | null];

/** Called by a trusted, bounded probe while HTML exists only in memory. The parser
 * validates both complete 100-entry charts before a content-free proof is made.
 */
export function validateMelonRecoveryPage(html: string, checkedAt: Date, parserSha256: string): MelonRecoverySample {
	if (!/^[a-f0-9]{64}$/.test(parserSha256)) throw new Error('Invalid reference parser identity');
	const sample: MelonRecoverySample = { source: 'melon', checkedAt: checkedAt.toISOString(), parserSha256, charts: parseReferencePage('melon', html, checkedAt).map(snapshot => ({ entryCount: 100, snapshot })) };
	validateSample(sample, parserSha256, checkedAt.getTime());
	return sample;
}

function validateSample(sample: MelonRecoverySample, parserSha256: string, now: number): Map<string, ReferenceSnapshot> {
	if (!sample || sample.source !== 'melon' || sample.parserSha256 !== parserSha256 || !Array.isArray(sample.charts) || sample.charts.length !== 2) throw new Error('Invalid reference recovery sample');
	const checked = Date.parse(sample.checkedAt);
	if (!Number.isSafeInteger(checked) || checked <= 0 || new Date(checked).toISOString() !== sample.checkedAt || checked > now) throw new Error('Invalid reference recovery time');
	const snapshots = new Map<string, ReferenceSnapshot>();
	for (const chart of sample.charts) {
		if (chart.entryCount !== 100) throw new Error('Incomplete reference recovery sample');
		const key = validateReferenceSnapshot(chart.snapshot, new Date(checked));
		if (!KEYS.some(candidate => candidate === key) || snapshots.has(key)) throw new Error('Invalid reference recovery chart');
		if (chart.snapshot.result !== 'ranked' || chart.snapshot.rank === null) throw new Error('Reference recovery requires both matching works');
		if (checked - Date.parse(chart.snapshot.sourceFetchedAt) > REFERENCE_CHARTS[key].maxAge) throw new Error('Stale reference recovery sample');
		snapshots.set(key, chart.snapshot);
	}
	return snapshots;
}

/** Internal trusted-proof boundary, not an endpoint. The calling operator tool
 * MUST verify restricted proof-file provenance and probe/parser hashes. A caller
 * supplied snapshot/count alone cannot prove that a complete page was parsed.
 */
export function prepareMelonReferenceRecovery(samples: readonly [MelonRecoverySample, MelonRecoverySample], expected: MelonRecoveryExpected, parserSha256: string, now = new Date()) {
	if (!Number.isSafeInteger(now.getTime()) || !/^[a-f0-9]{64}$/.test(parserSha256) || !Array.isArray(samples) || samples.length !== 2 || !Array.isArray(expected) || expected.length !== 3 || expected.some(value => value !== null && (typeof value !== 'string' || value.length > 4096))) throw new Error('Invalid reference recovery input');
	const attempt = parseReferenceAttempt(expected[0]);
	if (!attempt || attempt.status === 'available') throw new Error('Reference recovery requires the expected failed attempt');
	const first = validateSample(samples[0], parserSha256, now.getTime());
	const second = validateSample(samples[1], parserSha256, now.getTime());
	const firstChecked = Date.parse(samples[0].checkedAt);
	const checked = Date.parse(samples[1].checkedAt);
	if (firstChecked <= attempt.checkedAt || checked - firstChecked < MUSIC_CHART_INTERVAL_MS || now.getTime() - checked > 15 * 60000) throw new Error('Reference recovery observation window is invalid');
	if (Date.parse(second.get('melon-top100')!.sourceFetchedAt) <= Date.parse(first.get('melon-top100')!.sourceFetchedAt)) throw new Error('Reference recovery requires a new TOP100 observation');
	const snapshots = KEYS.map((key, index) => {
		const initial = first.get(key)!;
		const snapshot = second.get(key)!;
		if (snapshot.sourceFetchedAt < initial.sourceFetchedAt || now.getTime() - Date.parse(snapshot.sourceFetchedAt) > REFERENCE_CHARTS[key].maxAge) throw new Error('Reference recovery source time regressed or expired');
		if (snapshot.sourceFetchedAt === initial.sourceFetchedAt && (snapshot.rank !== initial.rank || snapshot.result !== initial.result || snapshot.sourceTimeLabel !== initial.sourceTimeLabel)) throw new Error('Reference recovery observations conflict at the same source timestamp');
		const raw = expected[index + 1];
		if (raw !== null) {
			const prior = JSON.parse(raw) as ReferenceSnapshot;
			if (validateReferenceSnapshot(prior, now) !== key || initial.sourceFetchedAt < prior.sourceFetchedAt) throw new Error('Reference recovery cannot overwrite newer cached data');
			if (snapshot.sourceFetchedAt === prior.sourceFetchedAt && (snapshot.rank !== prior.rank || snapshot.result !== prior.result || snapshot.sourceTimeLabel !== prior.sourceTimeLabel)) throw new Error('Reference recovery conflicts with an existing source timestamp');
		}
		return { ...snapshot, sourceFetchedMs: Date.parse(snapshot.sourceFetchedAt), lastSuccessAt: samples[1].checkedAt };
	});
	return { checkedAt: checked, snapshots };
}

/** Compare every module-owned raw value before any write. No scans, deletes,
 * other source keys, official history, or shared queue operations are involved.
 */
export const REFERENCE_RECOVERY_SCRIPT = `
local expected = cjson.decode(ARGV[1])
local checked = tonumber(ARGV[2])
local snapshots = cjson.decode(ARGV[3])
local retention = tonumber(ARGV[4])
local interval = tonumber(ARGV[5])
if #KEYS ~= 3 or #expected ~= 3 or #snapshots ~= 2 then return 0 end
for i = 1, 3 do
  local current = redis.call('GET', KEYS[i])
  if expected[i] == cjson.null then
    if current then return 0 end
  elseif current ~= expected[i] then return 0 end
end
local attempt = cjson.decode(expected[1])
if attempt.checkedAt >= checked or attempt.status == 'available' then return 0 end
for i, incoming in ipairs(snapshots) do
  local raw = redis.call('GET', KEYS[i + 1])
  if raw then
    local prior = cjson.decode(raw)
    if prior.sourceFetchedAt > incoming.sourceFetchedAt then return 0 end
  end
  if incoming.sourceFetchedMs + retention <= checked then return 0 end
end
for i, incoming in ipairs(snapshots) do
  local raw = redis.call('GET', KEYS[i + 1])
  if not raw or cjson.decode(raw).sourceFetchedAt < incoming.sourceFetchedAt then
    local expires = incoming.sourceFetchedMs + retention
    incoming.sourceFetchedMs = nil
    redis.call('SET', KEYS[i + 1], cjson.encode(incoming), 'PXAT', expires)
  end
end
redis.call('SET', KEYS[1], cjson.encode({checkedAt=checked,nextAttemptAt=checked+interval,status='available',failureCount=0,diagnostic=cjson.null}), 'PXAT', checked + retention)
return 1
`;
