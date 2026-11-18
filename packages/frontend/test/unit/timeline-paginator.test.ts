/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Misskey from 'misskey-js';
import { Paginator } from '@/utility/paginator.js';
import { retainTimelineWindow } from '@/utility/timeline-window.js';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: api }));
const note = (id: string): Misskey.entities.Note => ({ id, createdAt: '2026-10-10T00:00:00.000Z' } as Misskey.entities.Note);
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => { resolve = done; });
	return { promise, resolve };
}

beforeEach(() => api.mockReset());

describe('timeline paginator request ownership', () => {
	it('keeps non-realtime polling bounded when the timeline requests a 120 item window', async () => {
		api.mockResolvedValueOnce(Array.from({ length: 120 }, (_, i) => note(String(999 - i))));
		const paginator = new Paginator('notes/global-timeline', {});
		await paginator.init();
		for (let batch = 0; batch < 5; batch++) {
			paginator.canFetchOlder.value = false;
			api.mockResolvedValueOnce(Array.from({ length: 30 }, (_, i) => note(String(1000 + batch * 30 + i))));
			await paginator.fetchNewer({ beforeCommit: items => items.slice(0, 120).map(item => item.id) });
			expect(paginator.items.value).toHaveLength(120);
			expect(paginator.canFetchOlder.value).toBe(true);
		}
	});
	it('deduplicates repeated live and polling arrivals before releasing the queue', async () => {
		api.mockResolvedValueOnce([note('1')]).mockResolvedValueOnce([note('3'), note('2'), note('2')]);
		const paginator = new Paginator('notes/global-timeline', {});
		await paginator.init();
		paginator.enqueue(note('2'));
		paginator.enqueue(note('2'));
		paginator.enqueue(note('1'));
		await paginator.fetchNewer({ toQueue: true });
		expect(paginator.queuedAheadItemsCount.value).toBe(2);
		paginator.releaseQueue();
		expect(paginator.items.value.map(item => item.id)).toEqual(['3', '2', '1']);
		paginator.unshiftItems([note('4'), note('4')]);
		expect(paginator.items.value.filter(item => item.id === '4')).toHaveLength(1);
	});
	it('deduplicates both snapshot and old pages, including duplicates within a response', async () => {
		api.mockResolvedValueOnce([note('3'), note('3'), note('2')]).mockResolvedValueOnce([note('2'), note('1'), note('1')]);
		const paginator = new Paginator('notes/global-timeline', { useShallowRef: true });
		await paginator.init();
		await paginator.fetchOlder();
		expect(paginator.items.value.map(item => item.id)).toEqual(['3', '2', '1']);
	});
	it('does not let an old page reappear after reload or invoke its commit hook', async () => {
		const oldPage = deferred<Misskey.entities.Note[]>();
		api.mockResolvedValueOnce([note('old')]).mockReturnValueOnce(oldPage.promise).mockResolvedValueOnce([note('new')]);
		const paginator = new Paginator('notes/global-timeline', {});
		await paginator.init();
		const beforeCommit = vi.fn(() => undefined);
		const pending = paginator.fetchOlder({ beforeCommit });
		await paginator.reload();
		oldPage.resolve([note('stale')]);
		await pending;
		expect(beforeCommit).not.toHaveBeenCalled();
		expect(paginator.items.value.map(item => item.id)).toEqual(['new']);
	});
	it('ignores pending initial and newer requests after invalidation', async () => {
		const initial = deferred<Misskey.entities.Note[]>();
		api.mockReturnValueOnce(initial.promise);
		const paginator = new Paginator('notes/global-timeline', {});
		const pending = paginator.init();
		paginator.invalidate();
		initial.resolve([note('late')]);
		await pending;
		expect(paginator.items.value).toEqual([]);
		api.mockResolvedValueOnce([note('current')]);
		await paginator.init();
		const newer = deferred<Misskey.entities.Note[]>();
		api.mockReturnValueOnce(newer.promise);
		const fetching = paginator.fetchNewer();
		paginator.invalidate();
		newer.resolve([note('future')]);
		await fetching;
		expect(paginator.items.value.map(item => item.id)).toEqual(['current']);
	});
	it('commits at most 120 and refetches a discarded old tail from the retained cursor', async () => {
		const current = Array.from({ length: 120 }, (_, i) => note(String(999 - i)));
		const older = Array.from({ length: 30 }, (_, i) => note(String(879 - i)));
		api.mockResolvedValueOnce(current).mockResolvedValueOnce(older).mockResolvedValueOnce(older);
		const paginator = new Paginator('notes/global-timeline', {});
		await paginator.init();
		await paginator.fetchOlder({ beforeCommit: items => retainTimelineWindow(items, '999').map(item => item.id) });
		expect(paginator.items.value).toHaveLength(120);
		expect(paginator.items.value[0].id).toBe('999');
		expect(paginator.canFetchOlder.value).toBe(true);
		await paginator.fetchOlder({ beforeCommit: items => retainTimelineWindow(items, '890').map(item => item.id) });
		expect(api.mock.calls[2][1].untilId).toBe('880');
		expect(paginator.items.value.at(-1)?.id).toBe('850');
	});
});
