/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Buffer } from 'node:buffer';
import { describe, expect, test } from 'vitest';
import { parseReferencePage } from '@/core/music-charts/reference-parser.js';

const NOW = new Date('2026-10-15T17:00:00.000Z');
const FETCHED = '2026-10-15T16:00:12.462Z';

// Synthetic structures only. No copied chart lists, sessions, or credentials.
function chart(displayName: string, count = 100, targetRank: number | null = 7) {
	return {
		displayName,
		countryCode: 'kr',
		fetchedAt: FETCHED,
		chartUpdatedAt: displayName.includes('Daily') ? '2026-10-14' : '01:00',
		chartWeekLabel: null as string | null,
		entries: Array.from({ length: count }, (_, i) => ({
			rank: i + 1,
			title: i + 1 === targetRank ? 'NEON' : `Synthetic song ${i + 1}`,
			artist: i + 1 === targetRank ? 'A2O LITE' : 'Synthetic artist',
			rawArtist: i + 1 === targetRank ? 'A2O, A2O LITE' : 'Synthetic artist',
			imageUrl: 'https://images.example.test/cover.jpg',
			storeItemId: null,
		})),
	};
}

function frame(text: string): string {
	return `<script>self.__next_f.push(${JSON.stringify([1, text])})</script>`;
}

function record(properties: Record<string, unknown>): string {
	return `a:${JSON.stringify(['$', '$L1', null, properties])}\n`;
}

function page(initialData: unknown, initialDaily?: unknown): string {
	return `<html><script>self.__next_f.push([0])</script>${frame('1:I[123,[],"Component"]\n')}${frame(record({ initialData, ...(initialDaily === undefined ? {} : { initialDaily }) }))}</html>`;
}

describe('public reference page parser', () => {
	test('Bugs complete data preserves provider timestamp and hour label without inventing a source period', () => {
		expect(parseReferencePage('bugs', page(chart('Bugs Top 100')), NOW)).toEqual([{
			chartKey: 'bugs-realtime', rank: 7, result: 'ranked', sourceFetchedAt: FETCHED, sourceTimeLabel: '01:00',
		}]);
	});

	test('Melon returns the two separately identified reference charts', () => {
		const daily = chart('Melon Daily Top 100', 100, 12);
		daily.entries[11].artist = 'A2O A2O LITE';
		daily.entries[11].rawArtist = 'A2O\r\nA2O LITE';
		const result = parseReferencePage('melon', page(chart('Melon Top 100'), daily), NOW);
		expect(result.map(item => [item.chartKey, item.rank, item.sourceTimeLabel])).toEqual([
			['melon-top100', 7, '01:00'], ['melon-daily', 12, '2026-10-14'],
		]);
		expect(result.some(item => item.chartKey === 'melon-hot100')).toBe(false);
	});

	test.each([1, 100, 200])('Genie validates all 250 rows then includes reference rank %i', rank => {
		expect(parseReferencePage('genie', page(chart('Genie Top 250', 250, rank)), NOW)[0].rank).toBe(rank);
	});

	test.each([201, 250, null])('Genie rank %s is not found inside the reference first 200', rank => {
		expect(parseReferencePage('genie', page(chart('Genie Top 250', 250, rank)), NOW)[0]).toMatchObject({ rank: null, result: 'not_found' });
	});

	test.each([0, 99, 101])('Bugs refuses incomplete or oversized row count %i', count => {
		expect(() => parseReferencePage('bugs', page(chart('Bugs Top 100', count, null)), NOW)).toThrow('incomplete');
	});

	test.each([100, 200, 249, 251])('Genie cannot silently treat %i rows as a complete 250-entry reference', count => {
		expect(() => parseReferencePage('genie', page(chart('Genie Top 250', count, null)), NOW)).toThrow('incomplete');
	});

	test('malformed daily data prevents a partially successful Melon response', () => {
		expect(() => parseReferencePage('melon', page(chart('Melon Top 100'), chart('Melon Daily Top 100', 99)), NOW)).toThrow('incomplete');
		expect(() => parseReferencePage('melon', page(chart('Melon Top 100')), NOW)).toThrow('missing');
	});

	test.each([0, 7, 8.5, 101, '8', null])('nonconsecutive, duplicate or noninteger rank %s is rejected', rank => {
		const data = chart('Bugs Top 100');
		const entries: Record<string, unknown>[] = data.entries;
		entries[7].rank = rank;
		expect(() => parseReferencePage('bugs', page(data), NOW)).toThrow('ranks');
	});

	test('rank order is validated rather than trusted or repaired', () => {
		const data = chart('Bugs Top 100');
		[data.entries[0], data.entries[1]] = [data.entries[1], data.entries[0]];
		expect(() => parseReferencePage('bugs', page(data), NOW)).toThrow('ranks');
	});

	test.each(['A2O LITE', 'Ａ２Ｏ ＬＩＴＥ', 'A2O, A2O LITE', 'A2O & A2O LITE', ' A2O\nA2O LITE '])('target artist credit %s is accepted exactly after normalization', artist => {
		const data = chart('Bugs Top 100');
		data.entries[6].artist = artist;
		data.entries[6].rawArtist = artist;
		expect(parseReferencePage('bugs', page(data), NOW)[0].rank).toBe(7);
	});

	test.each(['Another artist', 'A2O', 'A2O LITE fan remix', 'NOT A2O LITE', 'A2O LITE & Other'])('same title by %s is not the target', artist => {
		const data = chart('Bugs Top 100');
		data.entries[6].artist = artist;
		data.entries[6].rawArtist = artist;
		expect(parseReferencePage('bugs', page(data), NOW)[0]).toMatchObject({ result: 'not_found', rank: null });
	});

	test('a same-named other artist does not hide the one matching target', () => {
		const data = chart('Bugs Top 100');
		data.entries[0].title = 'NEON';
		expect(parseReferencePage('bugs', page(data), NOW)[0].rank).toBe(7);
	});

	test('a contradictory target raw credit is rejected', () => {
		const data = chart('Bugs Top 100');
		data.entries[6].rawArtist = 'Another artist';
		expect(() => parseReferencePage('bugs', page(data), NOW)).toThrow('conflicting');
	});

	test('multiple matching works are rejected, including Genie targets outside the chosen first 200', () => {
		const data = chart('Genie Top 250', 250);
		data.entries[249] = { ...data.entries[6], rank: 250 };
		expect(() => parseReferencePage('genie', page(data), NOW)).toThrow('multiple');
	});

	test('a remix title never matches merely because it contains NEON', () => {
		const data = chart('Bugs Top 100');
		data.entries[6].title = 'NEON (Remix)';
		expect(parseReferencePage('bugs', page(data), NOW)[0].result).toBe('not_found');
	});

	test.each(['Melon Top 100', 'Bugs Daily Top 100', 'Bugs Top 200'])('Bugs refuses a different chart identity %s', displayName => {
		expect(() => parseReferencePage('bugs', page(chart(displayName)), NOW)).toThrow('identity');
	});

	test('country and weekly labels cannot masquerade as the requested chart', () => {
		const data = chart('Bugs Top 100');
		data.countryCode = 'us';
		expect(() => parseReferencePage('bugs', page(data), NOW)).toThrow('identity');
		data.countryCode = 'kr';
		data.chartWeekLabel = '2026-W42';
		expect(() => parseReferencePage('bugs', page(data), NOW)).toThrow('weekly');
	});

	test.each(['not-a-date', '2026-02-30T01:00:00.000Z', '2026-10-15T17:00:00.001Z', '2026-10-16T01:00:00+09:00', '1970-01-01T00:00:00.000Z'])('invalid or future provider date %s is rejected', fetchedAt => {
		const data = chart('Bugs Top 100');
		data.fetchedAt = fetchedAt;
		expect(() => parseReferencePage('bugs', page(data), NOW)).toThrow('date');
	});

	test('expired observations retain their actual old timestamp for the state layer to mark stale', () => {
		const data = chart('Bugs Top 100');
		data.fetchedAt = '2026-10-10T01:00:00.000Z';
		expect(parseReferencePage('bugs', page(data), NOW)[0].sourceFetchedAt).toBe(data.fetchedAt);
	});

	test.each(['24:00', '01:60', '', '2026-10-15', '1:00'])('invalid hourly label %s is rejected', chartUpdatedAt => {
		const data = chart('Bugs Top 100');
		data.chartUpdatedAt = chartUpdatedAt;
		expect(() => parseReferencePage('bugs', page(data), NOW)).toThrow();
	});

	test.each(['2026-02-30', '2026-10-17', '1970-01-01', '01:00'])('invalid or future daily label %s is rejected', chartUpdatedAt => {
		const daily = chart('Melon Daily Top 100');
		daily.chartUpdatedAt = chartUpdatedAt;
		expect(() => parseReferencePage('melon', page(chart('Melon Top 100'), daily), NOW)).toThrow('daily');
	});

	test('all rows, not just the target, must have bounded typed title and artist fields', () => {
		for (const [key, value] of [['title', 123], ['artist', null], ['rawArtist', []], ['title', 'x'.repeat(513)], ['imageUrl', 'x'.repeat(2049)]] as const) {
			const data = chart('Bugs Top 100');
			const entries: Record<string, unknown>[] = data.entries;
			entries[0][key] = value;
			expect(() => parseReferencePage('bugs', page(data), NOW)).toThrow('text');
		}
	});

	test('text frames are combined before parsing, including a split inside a JSON escape', () => {
		const data = chart('Bugs Top 100');
		data.entries[0].title = 'Synthetic "quoted" title';
		const model = record({ initialData: data });
		const split = model.indexOf('\\"quoted') + 1;
		const html = `<html>${frame(model.slice(0, split))}${frame(model.slice(split, split + 1))}${frame(model.slice(split + 1))}</html>`;
		expect(parseReferencePage('bugs', html, NOW)[0].rank).toBe(7);
	});

	test('initialData-looking text inside JSON strings is ignored', () => {
		const html = `<html>${frame(record({ note: JSON.stringify({ initialData: chart('Bugs Top 100') }) }))}</html>`;
		expect(() => parseReferencePage('bugs', html, NOW)).toThrow('missing');
	});

	test('length-prefixed Flight text is skipped by UTF-8 bytes even when it contains model-looking lines', () => {
		const fake = `한글\n${record({ initialData: chart('Bugs Top 100', 100, 2) })}`;
		const textRecord = `9:T${Buffer.byteLength(fake, 'utf8').toString(16)},${fake}`;
		expect(() => parseReferencePage('bugs', frame(textRecord), NOW)).toThrow('missing');
		expect(parseReferencePage('bugs', frame(textRecord + record({ initialData: chart('Bugs Top 100') })), NOW)[0].rank).toBe(7);
	});

	test.each(['1:Txyz,hello', '1:Tffffff,short'])('malformed or truncated Flight text record is rejected', value => {
		expect(() => parseReferencePage('bugs', frame(value) + page(chart('Bugs Top 100')), NOW)).toThrow('text record');
	});

	test('duplicate chart properties in separate model records are ambiguous', () => {
		const html = `<html>${frame(record({ initialData: chart('Bugs Top 100') }) + record({ initialData: chart('Bugs Top 100') }))}</html>`;
		expect(() => parseReferencePage('bugs', html, NOW)).toThrow('ambiguous');
	});

	test('malicious scripts are never executed and expressions are not accepted as JSON', () => {
		const expression = '<script>self.__next_f.push([1,(()=>{throw new Error("EXECUTED")})()])</script>';
		expect(() => parseReferencePage('bugs', expression, NOW)).toThrow('not JSON');
		const unrelated = '<script>throw new Error("EXECUTED")</script>';
		expect(parseReferencePage('bugs', unrelated + page(chart('Bugs Top 100')), NOW)[0].rank).toBe(7);
	});

	test('external scripts, malformed frames, incomplete records and block pages do not generate absence', () => {
		const external = frame(record({ initialData: chart('Bugs Top 100') })).replace('<script>', '<script src="https://example.test/code.js">');
		for (const html of [external, '<html>Access denied</html>', '<script>self.__next_f.push([1,123])</script>', frame('a:{"initialData":')]) {
			expect(() => parseReferencePage('bugs', html, NOW)).toThrow();
		}
	});

	test('HTML, scripts, records and model nesting have explicit resource limits', () => {
		expect(() => parseReferencePage('bugs', 'x'.repeat(3 * 1024 * 1024 + 1), NOW)).toThrow('size');
		expect(() => parseReferencePage('bugs', '<script></script>'.repeat(513), NOW)).toThrow('scripts');
		expect(() => parseReferencePage('bugs', frame('1:{}\n'.repeat(1025)), NOW)).toThrow('records');
		expect(() => parseReferencePage('bugs', frame(`a:${'['.repeat(66)}0${']'.repeat(66)}\n`), NOW)).toThrow('structure');
	});
});
