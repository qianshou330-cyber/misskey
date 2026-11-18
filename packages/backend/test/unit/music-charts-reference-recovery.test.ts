/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import { prepareMelonReferenceRecovery, validateMelonRecoveryPage, type MelonRecoveryExpected, type MelonRecoverySample } from '@/core/music-charts/reference-recovery.js';

const parserHash = 'a'.repeat(64);
const now = new Date('2026-10-16T18:00:00.000Z');
const firstAt = new Date('2026-10-16T16:59:00.000Z');
const secondAt = new Date('2026-10-16T17:59:00.000Z');
const expected: MelonRecoveryExpected = [JSON.stringify({ status: 'restricted', checkedAt: Date.parse('2026-10-16T15:00:00.000Z'), nextAttemptAt: Date.parse('2026-10-17T15:00:00.000Z'), failureCount: 1 }), null, null];

function html(fetchedAt: string, count = 100) {
	const chart = (daily: boolean) => ({ displayName: daily ? 'Melon Daily Top 100' : 'Melon Top 100', countryCode: 'kr', fetchedAt, chartUpdatedAt: daily ? '2026-10-15' : '02:00', chartWeekLabel: null, entries: Array.from({ length: count }, (_, index) => ({ rank: index + 1, title: index === 3 ? 'NEON' : `Synthetic ${index}`, artist: index === 3 ? 'A2O LITE' : 'Synthetic artist' })) });
	const record = `a:${JSON.stringify(['$', '$L1', null, { initialData: chart(false), initialDaily: chart(true) }])}\n`;
	return `<html><script>self.__next_f.push(${JSON.stringify([1, record])})</script></html>`;
}

function samples(): [MelonRecoverySample, MelonRecoverySample] {
	return [validateMelonRecoveryPage(html('2026-10-16T16:30:00.000Z'), firstAt, parserHash), validateMelonRecoveryPage(html('2026-10-16T17:30:00.000Z'), secondAt, parserHash)];
}

describe('Trusted Melon recovery proof preparation', () => {
	it('uses the real parser for two complete charts and emits no HTML or unrelated entries', () => {
		const [first, second] = samples();
		expect(second.charts.map(chart => [chart.entryCount, chart.snapshot.chartKey, chart.snapshot.rank])).toEqual([[100, 'melon-top100', 4], [100, 'melon-daily', 4]]);
		expect(JSON.stringify(second)).not.toContain('Synthetic');
		const prepared = prepareMelonReferenceRecovery([first, second], expected, parserHash, now);
		expect(prepared.checkedAt).toBe(secondAt.getTime());
		expect(prepared.snapshots.map(snapshot => snapshot.chartKey)).toEqual(['melon-daily', 'melon-top100']);
	});
	it.each([0, 99, 101])('cannot generate a trusted sample from %i rows', count => {
		expect(() => validateMelonRecoveryPage(html('2026-10-16T17:30:00.000Z', count), secondAt, parserHash)).toThrow();
	});
	it('requires the full hour even when both snapshots are otherwise fresh', () => {
		const data = samples();
		data[1].checkedAt = new Date(secondAt.getTime() - 1).toISOString();
		expect(() => prepareMelonReferenceRecovery(data, expected, parserHash, now)).toThrow('window');
	});
	it('requires new TOP100 source time, not merely two HTTP successes', () => {
		const data = samples();
		data[1].charts[0].snapshot.sourceFetchedAt = data[0].charts[0].snapshot.sourceFetchedAt;
		expect(() => prepareMelonReferenceRecovery(data, expected, parserHash, now)).toThrow('new TOP100');
	});
	it.each(['future', 'stale', 'old-proof', 'parser', 'other-source', 'duplicate', 'count'])('rejects invalid observation proof: %s', kind => {
		const data = samples();
		if (kind === 'future') data[1].checkedAt = new Date(now.getTime() + 1).toISOString();
		if (kind === 'stale') data[0].charts[0].snapshot.sourceFetchedAt = '2026-10-16T12:00:00.000Z';
		if (kind === 'parser') data[1].parserSha256 = 'b'.repeat(64);
		if (kind === 'other-source') data[1].source = 'bugs' as 'melon';
		if (kind === 'duplicate') data[1].charts[1] = data[1].charts[0];
		if (kind === 'count') data[1].charts[1].entryCount = 99 as 100;
		expect(() => prepareMelonReferenceRecovery(data, expected, parserHash, kind === 'old-proof' ? new Date(secondAt.getTime() + 900001) : now)).toThrow();
	});
	it('refuses a newer attempt, successful baseline, or newer cached source', () => {
		const data = samples();
		const attempt = JSON.parse(expected[0]);
		expect(() => prepareMelonReferenceRecovery(data, [JSON.stringify({ ...attempt, checkedAt: firstAt.getTime() }), null, null], parserHash, now)).toThrow('window');
		expect(() => prepareMelonReferenceRecovery(data, [JSON.stringify({ ...attempt, status: 'available' }), null, null], parserHash, now)).toThrow('failed attempt');
		const prior = { ...data[1].charts[0].snapshot, sourceFetchedAt: '2026-10-16T17:45:00.000Z' };
		expect(() => prepareMelonReferenceRecovery(data, [expected[0], null, JSON.stringify(prior)], parserHash, now)).toThrow('newer cached');
	});
	it('refuses regressing daily data even if TOP100 advanced', () => {
		const data = samples();
		data[1].charts[1].snapshot.sourceFetchedAt = '2026-10-16T16:00:00.000Z';
		expect(() => prepareMelonReferenceRecovery(data, expected, parserHash, now)).toThrow('regressed');
	});
	it.each([0, 1])('requires a matched NEON in chart %i for controlled recovery', index => {
		const data = samples();
		data[1].charts[index].snapshot.result = 'not_found';
		data[1].charts[index].snapshot.rank = null;
		expect(() => prepareMelonReferenceRecovery(data, expected, parserHash, now)).toThrow('matching works');
	});
	it.each(['rank', 'sourceTimeLabel'])('rejects changed daily %s at an unchanged source timestamp', field => {
		const data = samples();
		data[1].charts[1].snapshot.sourceFetchedAt = data[0].charts[1].snapshot.sourceFetchedAt;
		if (field === 'rank') data[1].charts[1].snapshot.rank = 5;
		else data[1].charts[1].snapshot.sourceTimeLabel = '2026-10-16';
		expect(() => prepareMelonReferenceRecovery(data, expected, parserHash, now)).toThrow('observations conflict');
	});
});
