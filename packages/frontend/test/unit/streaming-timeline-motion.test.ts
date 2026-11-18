/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { cleanup, render, waitFor } from '@testing-library/vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import type * as Misskey from 'misskey-js';
import { preferState, preferReactive } from '../setup.unit.js';
import MkStreamingNotesTimeline from '@/components/MkStreamingNotesTimeline.vue';
import { globalEvents } from '@/events.js';

const mocks = vi.hoisted(() => ({ api: vi.fn(), onNote: null as ((note: Misskey.entities.Note) => void) | null, dispose: vi.fn(), unmounted: vi.fn() }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: mocks.api }));
vi.mock('@/store.js', () => ({ store: { s: { realtimeMode: true } } }));
vi.mock('@/instance.js', () => ({ instance: { notesPerOneAd: 0 } }));
vi.mock('@/i.js', () => ({ $i: null }));
vi.mock('@/utility/sound.js', () => ({}));
vi.mock('@/stream.js', () => ({ useStream: () => ({
	on: vi.fn(), off: vi.fn(),
	useChannel: () => ({ on: (_event: string, callback: typeof mocks.onNote) => { mocks.onNote = callback; }, dispose: mocks.dispose }),
}) }));
vi.mock('@/components/MkPullToRefresh.vue', () => ({ default: { template: '<div><slot /></div>' } }));
vi.mock('@/components/MkNote.vue', async () => {
	const { h, onUnmounted } = await import('vue');
	return { default: { props: ['note'], setup(props: { note: { id: string } }) {
		onUnmounted(() => mocks.unmounted(props.note.id));
		return () => h('article', { 'data-note': props.note.id }, props.note.id);
	} } };
});

const note = (id: string): Misskey.entities.Note => ({ id, createdAt: '2026-10-10T00:00:00.000Z', userId: 'remote' } as Misskey.entities.Note);
const originalAnimate = Element.prototype.animate;
afterEach(() => {
	cleanup();
	Element.prototype.animate = originalAnimate;
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('streaming timeline motion lifecycle', () => {
	it('keeps 700ms live enter and 200ms true delete while disposing the note before leave finishes', async () => {
		preferState.animation = true;
		preferReactive.animation = ref(true);
		preferState.enableInfiniteScroll = false;
		mocks.api.mockResolvedValue([note('1')]);
		mocks.unmounted.mockClear();
		const animations: { duration: number; finish: () => void; cancel: ReturnType<typeof vi.fn> }[] = [];
		const animate = vi.fn((_frames: Keyframe[], options: KeyframeAnimationOptions) => {
			let finish!: () => void;
			const finished = new Promise<void>(resolve => { finish = resolve; });
			const cancel = vi.fn();
			animations.push({ duration: Number(options.duration), finish, cancel });
			return { finished, cancel } as unknown as Animation;
		});
		Element.prototype.animate = animate as typeof Element.prototype.animate;
		const page = render(MkStreamingNotesTimeline, {
			props: { src: 'global' },
			global: { stubs: { TransitionGroup: false, MkAd: true, MkLoading: true, MkError: true, MkResult: true }, directives: { appear: () => undefined } },
		});
		await waitFor(() => expect(page.container.querySelector('[data-note="1"]')).not.toBeNull());
		mocks.onNote!(note('2'));
		await waitFor(() => expect(animations).toHaveLength(1));
		expect(animations[0].duration).toBe(700);
		expect(animate.mock.calls[0][0][0]).toMatchObject({ opacity: 0, translate: '0 -64px' });
		animations[0].finish();
		await nextTick();
		globalEvents.emit('noteDeleted', '2');
		await waitFor(() => expect(animations).toHaveLength(2));
		expect(animations[1].duration).toBe(200);
		expect(mocks.unmounted).toHaveBeenCalledWith('2');
		expect(page.container.querySelector('[data-scroll-anchor="2"]')).not.toBeNull();
		animations[1].finish();
		await waitFor(() => expect(page.container.querySelector('[data-scroll-anchor="2"]')).toBeNull());

		// Preferences are persisted in s, but only r notifies computed effects.
		// Toggle on the existing timeline, without remounting its retained row.
		const retainedRow = page.container.querySelector('[data-scroll-anchor="1"]');
		preferState.animation = false;
		preferReactive.animation.value = false;
		await nextTick();
		mocks.onNote!(note('3'));
		await waitFor(() => expect(page.container.querySelector('[data-note="3"]')).not.toBeNull());
		expect(animations).toHaveLength(2);
		expect(page.container.querySelector('[data-scroll-anchor="1"]')).toBe(retainedRow);
		globalEvents.emit('noteDeleted', '3');
		await waitFor(() => expect(page.container.querySelector('[data-scroll-anchor="3"]')).toBeNull());
		expect(animations).toHaveLength(2);
		preferState.animation = true;
		preferReactive.animation.value = true;
		await nextTick();
		mocks.onNote!(note('4'));
		await waitFor(() => expect(animations).toHaveLength(3));
		expect(animations[2].duration).toBe(700);
		expect(page.container.querySelector('[data-scroll-anchor="1"]')).toBe(retainedRow);
		animations[2].finish();
		await nextTick();
		page.unmount();
		expect(mocks.dispose).toHaveBeenCalled();
		expect(animations.every(animation => animation.cancel.mock.calls.length === 1)).toBe(true);
	});
});
