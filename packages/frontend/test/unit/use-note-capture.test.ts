/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createApp, defineComponent, h } from 'vue';
import { EventEmitter } from 'eventemitter3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { entities } from 'misskey-js';
import { noteEvents, useNoteCapture } from '@/composables/use-note-capture.js';

const mocks = vi.hoisted(() => ({
	api: vi.fn(),
	interval: undefined as (() => void) | undefined,
	account: { id: 'viewer' } as { id: string } | null,
	store: { s: { realtimeMode: true } },
	stream: undefined as (EventEmitter & { send: ReturnType<typeof vi.fn> }) | undefined,
}));

vi.mock('@@/js/interval.js', () => ({
	createVisibilityAwareInterval: (callback: () => void) => {
		mocks.interval = callback;
	},
}));
vi.mock('@/stream.js', () => ({ useStream: () => mocks.stream }));
vi.mock('@/i.js', () => ({ get $i() { return mocks.account; } }));
vi.mock('@/store.js', () => ({ store: mocks.store }));
vi.mock('@/preferences.js', () => ({ prefer: { s: { pollingInterval: 3 } } }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: mocks.api }));
vi.mock('@/events.js', () => ({ globalEvents: { emit: vi.fn() } }));

function makeNote(recent = false): entities.Note {
	return {
		id: 'note-1',
		createdAt: new Date(Date.now() - (recent ? 0 : 60 * 60 * 1000)).toISOString(),
		reactions: {},
		reactionCount: 0,
		reactionEmojis: {},
		myReaction: null,
		poll: null,
	} as entities.Note;
}

const unmounts = new Set<() => void>();

function mountCapture(props: Parameters<typeof useNoteCapture>[0]) {
	let capture!: ReturnType<typeof useNoteCapture>;
	const app = createApp(defineComponent({
		setup() {
			capture = useNoteCapture(props);
			return () => h('div');
		},
	}));
	app.mount(document.createElement('div'));
	const unmount = () => {
		if (!unmounts.delete(unmount)) return;
		app.unmount();
	};
	unmounts.add(unmount);
	return { capture, unmount };
}

describe('useNoteCapture lifecycle', () => {
	beforeEach(() => {
		mocks.account = { id: 'viewer' };
		mocks.store.s.realtimeMode = true;
		mocks.stream = Object.assign(new EventEmitter(), { send: vi.fn() });
		mocks.api.mockReset().mockResolvedValue([]);
	});

	afterEach(() => {
		for (const unmount of unmounts) unmount();
		expect(noteEvents.eventNames()).toEqual([]);
		expect(mocks.stream!.eventNames()).toEqual([]);
		mocks.api.mockClear();
		mocks.interval!();
		expect(mocks.api).not.toHaveBeenCalled();
	});

	it('subscribes an old note only once after an asynchronous action and releases all stream listeners', async () => {
		const { capture, unmount } = mountCapture({ note: makeNote(), parentNote: null });
		expect(mocks.stream!.send).not.toHaveBeenCalled();
		await Promise.resolve();
		capture.subscribe();
		capture.subscribe();
		expect(mocks.stream!.send).toHaveBeenCalledExactlyOnceWith('sr', { id: 'note-1' });
		expect(mocks.stream!.listenerCount('noteUpdated')).toBe(1);
		expect(mocks.stream!.listenerCount('_connected_')).toBe(1);
		mocks.stream!.emit('_connected_');
		expect(mocks.stream!.send).toHaveBeenCalledTimes(2);
		unmount();
		expect(mocks.stream!.send).toHaveBeenLastCalledWith('un', { id: 'note-1' });
		mocks.stream!.emit('_connected_');
		expect(mocks.stream!.send).toHaveBeenCalledTimes(3);
	});

	it('keeps automatic recent-note subscriptions idempotent', () => {
		const { capture } = mountCapture({ note: makeNote(true), parentNote: null });
		capture.subscribe();
		capture.subscribe();
		expect(mocks.stream!.send).toHaveBeenCalledExactlyOnceWith('sr', { id: 'note-1' });
	});

	it('uses a recent parent to automatically subscribe an old renoted note', () => {
		mountCapture({ note: makeNote(), parentNote: makeNote(true) });
		expect(mocks.stream!.send).toHaveBeenCalledExactlyOnceWith('sr', { id: 'note-1' });
	});

	it.each([true, false])('ignores late manual subscriptions after unmount with realtimeMode=%s', async (realtimeMode) => {
		mocks.store.s.realtimeMode = realtimeMode;
		const { capture, unmount } = mountCapture({ note: makeNote(), parentNote: null });
		unmount();
		await Promise.resolve();
		capture.subscribe();
		mocks.interval!();
		expect(mocks.stream!.send).not.toHaveBeenCalled();
		expect(mocks.api).not.toHaveBeenCalled();
	});

	it('balances polling references across duplicate manual calls and multiple views', async () => {
		mocks.store.s.realtimeMode = false;
		const first = mountCapture({ note: makeNote(), parentNote: null });
		const second = mountCapture({ note: makeNote(), parentNote: null });
		await Promise.resolve();
		first.capture.subscribe();
		first.capture.subscribe();
		second.capture.subscribe();
		mocks.api.mockResolvedValue([{ id: 'note-1', reactions: { heart: 2 }, reactionEmojis: {} }]);
		mocks.interval!();
		await Promise.resolve();
		expect(first.capture.$note.reactionCount).toBe(2);
		expect(second.capture.$note.reactionCount).toBe(2);
		first.unmount();
		mocks.api.mockResolvedValue([{ id: 'note-1', reactions: { heart: 3 }, reactionEmojis: {} }]);
		mocks.interval!();
		await Promise.resolve();
		expect(first.capture.$note.reactionCount).toBe(2);
		expect(second.capture.$note.reactionCount).toBe(3);
		expect(mocks.api).toHaveBeenLastCalledWith('notes/show-partial-bulk', { noteIds: ['note-1'] });
		second.unmount();
		mocks.api.mockClear();
		mocks.interval!();
		expect(mocks.api).not.toHaveBeenCalled();
	});

	it('does not update a disposed note when an in-flight polling request resolves', async () => {
		mocks.account = null;
		const { capture, unmount } = mountCapture({ note: makeNote(true), parentNote: null });
		let resolve!: (value: unknown[]) => void;
		mocks.api.mockReturnValue(new Promise<unknown[]>(done => { resolve = done; }));
		mocks.interval!();
		unmount();
		resolve([{ id: 'note-1', reactions: { heart: 9 }, reactionEmojis: {} }]);
		await Promise.resolve();
		expect(capture.$note.reactionCount).toBe(0);
		expect(mocks.stream!.send).not.toHaveBeenCalled();
	});

	it('does not subscribe in mock mode, including manual requests', async () => {
		const { capture } = mountCapture({ note: makeNote(true), parentNote: null, mock: true });
		await Promise.resolve();
		capture.subscribe();
		mocks.interval!();
		expect(mocks.stream!.send).not.toHaveBeenCalled();
		expect(mocks.api).not.toHaveBeenCalled();
	});
});
