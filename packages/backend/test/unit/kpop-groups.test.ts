/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { KPOP_CHARTS, KPOP_GROUPS, matchKpopGroups } from '@/core/kpop-charts/catalog.js';
import { projectKpopGroups, reclassifiedKpopHash } from '@/core/kpop-charts/groups.js';
import { assertKpopSnapshot, kpopContentHash } from '@/core/kpop-charts/parser.js';
import { initialKpopState, snapshotDecision } from '@/core/kpop-charts/state.js';
import { KPOP_GROUP_IDS, KPOP_SOURCES, type KpopChartKey, type KpopEntry, type KpopSnapshot } from '@/core/kpop-charts/types.js';
import { MiKpopChartState } from '@/models/KpopChartState.js';
import { MiKpopChartSnapshot } from '@/models/KpopChartSnapshot.js';
import { MiKpopChartEntry } from '@/models/KpopChartEntry.js';
import { kpopEntrySchema, kpopSummarySchema } from '@/models/json-schema/kpop-charts.js';
import { paramDef as chartParamDef } from '@/server/api/endpoints/music-charts/kpop-chart.js';
import type { HttpRequestService } from '@/core/HttpRequestService.js';
vi.mock('@/core/HttpRequestService.js', () => ({ HttpRequestService: class {} }));
import { KpopMusicChartService } from '@/core/KpopMusicChartService.js';

const now = Date.parse('2026-10-18T11:05:00.000Z');
const groups = ['babymonster', 'illit', 'meovv', 'triples'] as const;
const addedGroups = ['aespa', 'newjeans', 'le-sserafim', 'ive'] as const;
const originalGroups = ['a2o-lite', 'hearts2hearts', 'kiiikiii', 'baby-dont-cry', 'ifeye', ...groups] as const;

function oldSnapshot(key: KpopChartKey = 'melon-top100', catalogue: 'five' | 'nine' = 'five') {
	const definition = KPOP_CHARTS[key];
	const entries: KpopEntry[] = Array.from({ length: 100 }, (_, index) => ({ songId: String(index + 1), rank: index + 1, title: `Synthetic ${index + 1}`,
		artists: [{ id: index === 0 ? KPOP_GROUPS.find(group => group.id === 'babymonster')!.artistIds[definition.source]?.[0] ?? null : null,
			name: index === 0 ? 'BABYMONSTER' : index === 1 ? 'A2O LITE' : 'Synthetic Artist' }],
		album: null, albumId: null, albumCoverUrl: null, sourceMovement: { type: 'same', amount: 0 }, groupIds: index === 1 ? ['a2o-lite'] : [] }));
	if (catalogue === 'nine') {
		for (const [index, id] of addedGroups.entries()) {
			const group = KPOP_GROUPS.find(row => row.id === id)!;
			entries[index].artists = [{ id: group.artistIds[definition.source]?.[0] ?? null, name: group.name }];
			entries[index].groupIds = [];
		}
		entries[4].artists = [{ id: null, name: 'BABYMONSTER' }]; entries[4].groupIds = ['babymonster'];
		entries[5].artists = [{ id: null, name: 'A2O LITE' }]; entries[5].groupIds = ['a2o-lite'];
	}
	const snapshot: KpopSnapshot = { schemaVersion: 1, chartKey: key, source: definition.source, sourceUrl: definition.url,
		sourcePeriod: key === 'flo' ? null : '2026-10-18T10:00:00.000Z', sourceUpdatedAt: key === 'flo' ? null : '2026-10-18T10:00:00.000Z',
		sourceDate: '2026-10-18', observedAt: '2026-10-18T10:05:00.000Z', coverage: 'complete', sourceTotal: 100, expectedCount: 100,
		rankBasis: 'official_rank', entries, rawHash: 'a'.repeat(64), contentHash: '' };
	snapshot.contentHash = kpopContentHash(snapshot);
	const stored = Object.assign(new MiKpopChartSnapshot(), { ...snapshot, id: 'snapshot', entries: undefined,
		sourceUpdatedAt: snapshot.sourceUpdatedAt ? new Date(snapshot.sourceUpdatedAt) : null, observedAt: new Date(snapshot.observedAt) });
	return { snapshot, stored, entries: entries.map(entry => Object.assign(new MiKpopChartEntry(), entry, { snapshotId: stored.id })) };
}

function currentSnapshot(previous: KpopSnapshot) {
	const snapshot = { ...structuredClone(previous), observedAt: new Date(now).toISOString(), entries: projectKpopGroups(previous.source, previous.entries) };
	snapshot.contentHash = kpopContentHash(snapshot); assertKpopSnapshot(snapshot); return snapshot;
}

function serviceFixture(key: KpopChartKey = 'melon-top100', catalogue: 'five' | 'nine' = 'five') {
	const old = oldSnapshot(key, catalogue);
	const chart = Object.assign(initialKpopState(key, old.snapshot.source, key), { status: 'available', checkedAt: new Date(old.snapshot.observedAt),
		lastSuccessAt: new Date(old.snapshot.observedAt), lastChangedAt: new Date(old.snapshot.observedAt), latestSnapshotId: old.stored.id });
	const gate = Object.assign(initialKpopState(`source:${old.snapshot.source}`, old.snapshot.source, null), { status: 'available', checkedAt: new Date(old.snapshot.observedAt) });
	const rows = new Map<string, MiKpopChartState>([[chart.key, chart], [gate.key, gate]]);
	const snapshotInsert = vi.fn(), entryInsert = vi.fn(), stateSave = vi.fn(async (values: MiKpopChartState[]) => {
		for (const value of values) rows.set(value.key, value);
	});
	const stateRepo = { findBy: async (where: { key: { _value: string[] } }) => where.key._value.map(value => rows.get(value)).filter(Boolean),
		findOneBy: async (where: { key: string }) => rows.get(where.key) ?? null, save: stateSave };
	const snapshotRepo = { findOneBy: async () => old.stored,
		find: async (where: { where: { chartKey: string } }) => where.where.chartKey === key ? [old.stored] : [], insert: snapshotInsert,
		createQueryBuilder: () => ({ delete: () => ({ where: () => ({ execute: async () => {} }) }) }) };
	const entryRepo = { find: async () => old.entries, findBy: async (where: { songId?: string }) => where.songId ? old.entries.filter(entry => entry.songId === where.songId) : old.entries,
		insert: entryInsert, createQueryBuilder: () => ({ select: () => ({ addSelect: () => ({ where: () => ({ groupBy: () => ({ getRawMany: async () => [] }) }) }) }) }) };
	const manager = { query: vi.fn(async () => []), getRepository: (entity: unknown) => entity === MiKpopChartState ? stateRepo : entity === MiKpopChartSnapshot ? snapshotRepo : entryRepo };
	const db = { ...manager, transaction: async (work: (value: typeof manager) => Promise<void>) => work(manager) } as unknown as DataSource;
	const http = { send: vi.fn(() => { throw new Error('No external request permitted'); }) };
	return { ...old, rows, chart, gate, snapshotInsert, entryInsert, stateSave, http, service: new KpopMusicChartService(db, http as unknown as HttpRequestService) };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); vi.stubEnv('PUBO_KPOP_CHARTS_ENABLED', 'true'); vi.stubEnv('PUBO_KPOP_CHARTS_KEYS', Object.keys(KPOP_CHARTS).join(',')); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('registered groups and exact identity', () => {
	it('appends four groups after the original nine in every public enum contract', () => {
		expect(KPOP_GROUP_IDS).toEqual([...originalGroups, ...addedGroups]);
		expect(KPOP_GROUPS.map(group => group.id)).toEqual(KPOP_GROUP_IDS);
		expect(kpopEntrySchema.properties.groupIds.items.enum).toEqual(KPOP_GROUP_IDS);
		expect(kpopSummarySchema.properties.groups.items.properties.id.enum).toEqual(KPOP_GROUP_IDS);
		expect(chartParamDef.properties.groupId.enum).toEqual(KPOP_GROUP_IDS);
	});
	it.each(groups)('%s requires its exact credit and the verified platform ID when supplied', id => {
		const group = KPOP_GROUPS.find(row => row.id === id)!;
		for (const alias of group.aliases) expect(matchKpopGroups('melon', [{ name: alias, id: group.artistIds.melon![0] }])).toEqual([id]);
		expect(() => matchKpopGroups('melon', [{ name: group.name, id: '99999999' }])).toThrowError(expect.objectContaining({ code: 'identity_unverified' }));
		expect(matchKpopGroups('melon', [{ name: `${group.name} tribute`, id: group.artistIds.melon![0] }])).toEqual([]);
	});
	it('does not include tripleS subunits or the unrelated same-name Apple artist', () => {
		for (const name of ['tripleS Acid Angel from Asia', 'tripleS Visionary Vision', 'tripleS +(KR)ystal Eyes']) expect(matchKpopGroups('melon', [{ name, id: '3137294' }])).toEqual([]);
		expect(() => matchKpopGroups('apple', [{ name: 'tripleS', id: '1814127819' }])).toThrowError(expect.objectContaining({ code: 'identity_unverified' }));
		expect(matchKpopGroups('apple', [{ name: 'tripleS', id: '1651595986' }])).toEqual(['triples']);
	});
	it('does not borrow a platform ID and retains exact-name fallback for unlisted services', () => {
		expect(KPOP_GROUPS.find(group => group.id === 'triples')!.artistIds.genie).toBeUndefined();
		expect(matchKpopGroups('genie', [{ name: 'tripleS', id: 'unverified-platform-id' }])).toEqual(['triples']);
		expect(() => matchKpopGroups('melon', [{ name: 'BABYMONSTER', id: '1715981813' }])).toThrow();
	});
	it.each(addedGroups)('%s matches only exact group credits across configured sources', id => {
		const group = KPOP_GROUPS.find(row => row.id === id)!;
		for (const source of KPOP_SOURCES) {
			const artistId = group.artistIds[source]?.[0] ?? 'unlisted-platform-id';
			for (const alias of group.aliases) expect(matchKpopGroups(source, [{ name: alias, id: artistId }])).toEqual([id]);
			expect(matchKpopGroups(source, [{ name: ` ${group.name.toUpperCase().replaceAll(' ', '  ')} `, id: artistId }])).toEqual([id]);
			expect(matchKpopGroups(source, [{ name: `${group.name} tribute`, id: artistId }])).toEqual([]);
			if (group.artistIds[source]?.length) expect(() => matchKpopGroups(source, [{ name: group.name, id: 'wrong-platform-id' }])).toThrowError(expect.objectContaining({ code: 'identity_unverified' }));
		}
	});
	it('excludes solo, subunit, lookalike and combined text credits even when a group ID is supplied', () => {
		for (const name of ['KARINA', '카리나 (KARINA)', 'WINTER (aespa)', 'ae-aespa', 'aespa Unit', 'HANNI (NewJeans)', 'NewJeans Unit', 'New Jeans', 'HUH YUNJIN', '허윤진 (LE SSERAFIM)', 'LE SSERAFIM Unit', '안유진 (IVE)', '장원영 (IVE)', 'IVE Unit', 'IVE & aespa']) {
			for (const id of addedGroups) expect(matchKpopGroups('melon', [{ name, id: KPOP_GROUPS.find(row => row.id === id)!.artistIds.melon![0] }])).toEqual([]);
		}
		expect(matchKpopGroups('melon', [{ name: 'IVE (아이브)', id: '3055146' }, { name: 'aespa', id: '2899555' }])).toEqual(['aespa', 'ive']);
	});
});

describe('stored snapshot classification compatibility', () => {
	it.each(['melon-top100', 'flo'] as const)('treats only reclassification as duplicate for %s without changing stored clocks or hashes', key => {
		const old = oldSnapshot(key), before = JSON.stringify(old), incoming = currentSnapshot(old.snapshot);
		expect(incoming.contentHash).not.toBe(old.stored.contentHash);
		expect(reclassifiedKpopHash(old.stored, old.entries)).toBe(incoming.contentHash);
		expect(snapshotDecision({ ...old.stored, contentHash: reclassifiedKpopHash(old.stored, old.entries) }, incoming)).toBe('duplicate');
		expect(JSON.stringify(old)).toBe(before);
	});
	it('still detects real same-period changes and rejects corrupted stored content', () => {
		const old = oldSnapshot(), incoming = currentSnapshot(old.snapshot);
		incoming.entries[0].title = 'Changed real content'; incoming.contentHash = kpopContentHash(incoming);
		expect(snapshotDecision({ ...old.stored, contentHash: reclassifiedKpopHash(old.stored, old.entries) }, incoming)).toBe('conflict');
		old.entries[0].title = 'Corrupted stored content'; expect(() => reclassifiedKpopHash(old.stored, old.entries)).toThrow();
	});
});

describe('native service read and persistence paths', () => {
	it('shows new groups from old stored rows immediately, combined top two, without writes or requests', async () => {
		const fixture = serviceFixture(), before = JSON.stringify(fixture.entries);
		const summary = await fixture.service.summary();
		expect(summary.groups).toHaveLength(13); expect(summary.entries.map(entry => entry.groupIds)).toEqual([['babymonster'], ['a2o-lite']]);
		const filtered = await fixture.service.chart('melon-top100', 'babymonster');
		expect(filtered.total).toBe(1); expect(filtered.entries[0].rank).toBe(1);
		expect(filtered.chart.sourcePeriod).toBe(fixture.snapshot.sourcePeriod); expect(filtered.chart.observedAt).toBe(fixture.snapshot.observedAt);
		const history = await fixture.service.history('melon-top100', '1');
		expect(history.points[0].sourcePeriod).toBe(fixture.snapshot.sourcePeriod); expect(history.points[0].rank).toBe(1);
		expect(JSON.stringify(fixture.entries)).toBe(before); expect(fixture.stateSave).not.toHaveBeenCalled(); expect(fixture.http.send).not.toHaveBeenCalled();
	});
	it('projects an old identity conflict as an explicit unavailable diagnostic rather than 500 or absent', async () => {
		const fixture = serviceFixture(); fixture.entries[0].artists[0].id = 'wrong-platform-id';
		const detail = await fixture.service.chart('melon-top100', 'babymonster');
		expect(detail.chart.status).toBe('unavailable'); expect(detail.chart.diagnostic?.reason).toBe('identity_unverified'); expect(detail.entries).toEqual([]);
		const summary = await fixture.service.summary(); expect(summary.selected.diagnostic?.reason).toBe('identity_unverified');
		expect(fixture.rows.get('melon-top100')!.status).toBe('available'); expect(fixture.stateSave).not.toHaveBeenCalled(); expect(fixture.http.send).not.toHaveBeenCalled();
	});
	it.each(['melon-top100', 'flo'] as const)('recordOutcome preserves old snapshot for %s classification-only change', async key => {
		const fixture = serviceFixture(key), oldHash = fixture.stored.contentHash, oldObserved = fixture.stored.observedAt.toISOString();
		await fixture.service.recordOutcome(key, { snapshot: currentSnapshot(fixture.snapshot), robots: [] }, new Date(now));
		expect(fixture.snapshotInsert).not.toHaveBeenCalled(); expect(fixture.entryInsert).not.toHaveBeenCalled();
		expect(fixture.stored.contentHash).toBe(oldHash); expect(fixture.stored.observedAt.toISOString()).toBe(oldObserved);
		expect(fixture.rows.get(key)!.lastChangedAt!.toISOString()).toBe(fixture.snapshot.observedAt);
		expect(fixture.rows.get(key)!.lastSuccessAt!.getTime()).toBe(now); expect(fixture.rows.get(key)!.status).toBe('available');
	});
	it('recordOutcome still diagnoses conflicting real content within the same period', async () => {
		const fixture = serviceFixture(), incoming = currentSnapshot(fixture.snapshot);
		incoming.entries[0].title = 'Actually changed title'; incoming.contentHash = kpopContentHash(incoming);
		await fixture.service.recordOutcome('melon-top100', { snapshot: incoming, robots: [] }, new Date(now));
		expect(fixture.snapshotInsert).not.toHaveBeenCalled(); expect(fixture.rows.get('melon-top100')!.status).toBe('unavailable');
		expect(fixture.rows.get('melon-top100')!.diagnostic?.reason).toBe('invalid_payload');
	});
	it('projects all four new groups from a complete nine-group snapshot without source requests or history writes', async () => {
		const fixture = serviceFixture('melon-top100', 'nine'), before = JSON.stringify({ entries: fixture.entries, snapshot: fixture.stored });
		const summary = await fixture.service.summary();
		expect(summary.groups.map(group => group.id)).toEqual(KPOP_GROUP_IDS);
		expect(summary.entries.map(entry => entry.groupIds)).toEqual([['aespa'], ['newjeans']]);
		for (const [index, id] of addedGroups.entries()) {
			const detail = await fixture.service.chart('melon-top100', id);
			expect(detail.total).toBe(1); expect(detail.entries[0].rank).toBe(index + 1);
			expect(detail.chart.observedAt).toBe(fixture.snapshot.observedAt);
			const history = await fixture.service.history('melon-top100', String(index + 1));
			expect(history.points).toHaveLength(1); expect(history.points[0].rank).toBe(index + 1);
			expect(history.points[0].observedAt).toBe(fixture.snapshot.observedAt);
		}
		expect((await fixture.service.chart('melon-top100', 'babymonster')).entries[0].rank).toBe(5);
		expect(JSON.stringify({ entries: fixture.entries, snapshot: fixture.stored })).toBe(before);
		expect(fixture.stateSave).not.toHaveBeenCalled(); expect(fixture.snapshotInsert).not.toHaveBeenCalled(); expect(fixture.entryInsert).not.toHaveBeenCalled();
		expect(fixture.http.send).not.toHaveBeenCalled();
	});
	it.each(['melon-top100', 'flo'] as const)('does not create a new %s history point for a nine-to-thirteen group classification change', async key => {
		const fixture = serviceFixture(key, 'nine'), before = JSON.stringify({ entries: fixture.entries, snapshot: fixture.stored });
		const incoming = currentSnapshot(fixture.snapshot);
		expect(incoming.contentHash).not.toBe(fixture.stored.contentHash);
		expect(reclassifiedKpopHash(fixture.stored, fixture.entries)).toBe(incoming.contentHash);
		await fixture.service.recordOutcome(key, { snapshot: incoming, robots: [] }, new Date(now));
		expect(fixture.snapshotInsert).not.toHaveBeenCalled(); expect(fixture.entryInsert).not.toHaveBeenCalled();
		expect(JSON.stringify({ entries: fixture.entries, snapshot: fixture.stored })).toBe(before);
		expect(fixture.rows.get(key)!.lastChangedAt!.toISOString()).toBe(fixture.snapshot.observedAt);
		expect(fixture.rows.get(key)!.lastSuccessAt!.getTime()).toBe(now);
	});
});
