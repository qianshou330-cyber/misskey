/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { cleanup, fireEvent, render, waitFor } from '@testing-library/vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, KeepAlive, nextTick, ref } from 'vue';
import type * as Misskey from 'misskey-js';
import { preferState, preferReactive } from '../setup.unit.js';
import XTimeline from '@/pages/welcome.timeline.vue';

const mocks = vi.hoisted(() => ({
	post: vi.fn(), get: vi.fn(), connect: vi.fn(), dispose: vi.fn(),
	policy: { gtlAvailable: true },
	onNote: null as ((note: Misskey.entities.Note) => void) | null,
	onSubscribe: null as (() => void) | null,
}));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: mocks.post, misskeyApiGet: mocks.get }));
vi.mock('@/instance.js', () => ({ instance: { policies: mocks.policy } }));
vi.mock('@/stream.js', () => ({ useStream: () => ({ useChannel: mocks.connect }) }));
vi.mock('@/pages/welcome.timeline.note.vue', async () => {
	const { h } = await import('vue');
	return { default: { props: ['note', 'preview', 'duplicate'], setup(props: { note: { id: string }; preview: boolean; duplicate: boolean }) {
		return () => h('a', { href: `/notes/${props.note.id}`, 'data-note': props.note.id, 'data-preview': props.preview, tabindex: props.duplicate ? -1 : undefined }, props.note.id);
	} } };
});

const note = (id: string, visibility: Misskey.entities.Note['visibility'] = 'public'): Misskey.entities.Note => ({ id, visibility } as Misskey.entities.Note);
const initial = () => Array.from({ length: 20 }, (_, index) => note(`old-${index}`));
const sizes = { list: 2000, viewport: 600 };
let observers: { observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; notify: () => void }[];
let media: MediaQueryList;
let reduce: (value: boolean) => void;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.policy.gtlAvailable = true;
	mocks.post.mockResolvedValue(initial());
	mocks.get.mockResolvedValue([]);
	mocks.onNote = null;
	mocks.onSubscribe = null;
	mocks.connect.mockImplementation(() => ({
		on: (_event: string, callback: typeof mocks.onNote) => { mocks.onNote = callback; mocks.onSubscribe?.(); },
		dispose: mocks.dispose,
	}));
	preferState.animation = true;
	preferReactive.animation = ref(true);
	sizes.list = 2000;
	sizes.viewport = 600;
	observers = [];
	vi.stubGlobal('ResizeObserver', class {
		observe = vi.fn();
		disconnect = vi.fn();
		constructor(callback: () => void) { observers.push({ observe: this.observe, disconnect: this.disconnect, notify: callback }); }
	});
	const events = new EventTarget();
	media = {
		matches: false,
		addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => events.addEventListener(type, listener)),
		removeEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => events.removeEventListener(type, listener)),
	} as unknown as MediaQueryList;
	vi.spyOn(window, 'matchMedia').mockReturnValue(media);
	reduce = value => { Object.defineProperty(media, 'matches', { value, configurable: true }); events.dispatchEvent(new Event('change')); };
	const rect = HTMLElement.prototype.getBoundingClientRect;
	vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
		if (this.dataset.testid === 'welcome-scroll-main') return { ...rect.call(this), height: sizes.list };
		return rect.call(this);
	});
	vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
		return this.dataset.testid === 'welcome-scroll-viewport' ? sizes.viewport : 0;
	});
});

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mount() { return render(XTimeline, { props: { preview: true } }); }

async function loaded(page: ReturnType<typeof mount>): Promise<void> {
	await waitFor(() => expect(page.getByTestId('welcome-scroll').getAttribute('data-loaded')).toBe('true'));
	await nextTick();
}

function ids(page: ReturnType<typeof mount>): string[] {
	return Array.from(page.getByTestId('welcome-scroll-main').querySelectorAll('[data-note]')).map(el => el.getAttribute('data-note')!);
}

describe('welcome timeline loading and streaming', () => {
	it('uses anonymous POST and commits the snapshot before accepting a live note', async () => {
		let resolve!: (notes: Misskey.entities.Note[]) => void;
		mocks.post.mockReturnValue(new Promise<Misskey.entities.Note[]>(done => { resolve = done; }));
		const page = mount();
		expect(mocks.post).toHaveBeenCalledWith('notes/global-timeline', { limit: 20 }, null, expect.any(AbortSignal));
		expect(mocks.connect).not.toHaveBeenCalled();
		mocks.onSubscribe = () => mocks.onNote!(note('live'));
		resolve(initial());
		await loaded(page);
		// During loading there was no animated list, so this synchronous live event appears immediately.
		expect(ids(page)[0]).toBe('live');
		expect(ids(page)).toHaveLength(20);
		expect(page.emitted().ready).toHaveLength(1);
		expect(mocks.connect).toHaveBeenCalledWith('globalTimeline', { withRenotes: true });
		expect(mocks.get).not.toHaveBeenCalled();
	});

	it.each(['blocked', 'empty', 'disabled'])('falls back to public featured after global is %s without opening a channel', async reason => {
		if (reason === 'blocked') mocks.post.mockRejectedValue(new Error('unavailable'));
		if (reason === 'empty') mocks.post.mockResolvedValue([]);
		if (reason === 'disabled') mocks.policy.gtlAvailable = false;
		mocks.get.mockResolvedValue([note('featured')]);
		const page = mount();
		await loaded(page);
		expect(ids(page)).toEqual(['featured']);
		expect(mocks.get).toHaveBeenCalledWith('notes/featured', { limit: 20 });
		expect(mocks.connect).not.toHaveBeenCalled();
		if (reason === 'disabled') expect(mocks.post).not.toHaveBeenCalled();
	});

	it.each(['empty', 'failure'])('emits unavailable once for two %s feeds', async mode => {
		if (mode === 'empty') { mocks.post.mockResolvedValue([]); mocks.get.mockResolvedValue([]); } else { mocks.post.mockRejectedValue(new Error('blocked')); mocks.get.mockRejectedValue(new Error('offline')); }
		const page = mount();
		await waitFor(() => expect(page.emitted().unavailable).toHaveLength(1));
		expect(page.emitted().ready).toBeUndefined();
		expect(mocks.connect).not.toHaveBeenCalled();
	});

	it('deduplicates the snapshot and excludes non-public entries', async () => {
		mocks.post.mockResolvedValue([note('private', 'specified'), note('same'), note('same'), ...initial()]);
		const page = mount();
		await loaded(page);
		expect(ids(page)).toHaveLength(20);
		expect(new Set(ids(page)).size).toBe(20);
		expect(ids(page)).not.toContain('private');
	});

	it('buffers live notes until an animation boundary, shares both copies and retains only 20', async () => {
		const page = mount();
		await loaded(page);
		expect(page.getByTestId('welcome-scroll').dataset.animated).toBe('true');
		mocks.onNote!(note('new-1'));
		mocks.onNote!(note('new-2'));
		mocks.onNote!(note('new-1'));
		mocks.onNote!(note('hidden', 'followers'));
		await nextTick();
		expect(ids(page)).toEqual(initial().map(value => value.id));
		await fireEvent(page.getByTestId('welcome-scroll-track'), new Event('animationiteration'));
		expect(ids(page).slice(0, 2)).toEqual(['new-2', 'new-1']);
		expect(ids(page)).toHaveLength(20);
		expect(ids(page)).not.toContain('hidden');
		expect(page.getByTestId('welcome-scroll-duplicate').querySelectorAll('[data-note]')).toHaveLength(20);
	});

	it('applies pending and subsequent live notes immediately during keyboard reading, with one group', async () => {
		const page = mount();
		await loaded(page);
		mocks.onNote!(note('pending'));
		await fireEvent.keyDown(window, { key: 'Tab' });
		expect(ids(page)[0]).toBe('pending');
		expect(page.queryByTestId('welcome-scroll-duplicate')).toBeNull();
		expect(page.getByTestId('welcome-scroll').dataset.paused).toBe('true');
		mocks.onNote!(note('static-live'));
		await nextTick();
		expect(ids(page)[0]).toBe('static-live');
		expect(page.getByTestId('welcome-scroll').dataset.animated).toBe('false');
	});
});

describe('welcome timeline motion and access', () => {
	it('observes the actual viewport and list and switches modes when images change its height', async () => {
		sizes.list = 300;
		const page = mount();
		await loaded(page);
		expect(observers[0].observe.mock.calls.map(call => call[0].dataset.testid)).toEqual(['welcome-scroll-viewport', 'welcome-scroll-main']);
		expect(page.queryByTestId('welcome-scroll-duplicate')).toBeNull();
		sizes.list = 900;
		page.getByTestId('welcome-scroll-track').style.rowGap = '16px';
		observers[0].notify();
		await nextTick();
		expect(page.getByTestId('welcome-scroll-track').style.getPropertyValue('--welcome-scroll-distance')).toBe('916px');
		expect(page.getByTestId('welcome-scroll-duplicate')).not.toBeNull();
		sizes.viewport = 1000;
		observers[0].notify();
		await nextTick();
		expect(page.queryByTestId('welcome-scroll-duplicate')).toBeNull();
	});

	it('pauses on hover without replacing the moving lists', async () => {
		const page = mount();
		await loaded(page);
		const clone = page.getByTestId('welcome-scroll-duplicate');
		expect(page.queryByTestId('welcome-scroll-toggle')).toBeNull();
		expect(page.container.querySelector('.ti-world')).toBeNull();
		expect(page.getByTestId('welcome-scroll').children).toHaveLength(1);
		await fireEvent.mouseEnter(page.getByTestId('welcome-scroll-viewport'));
		expect(page.getByTestId('welcome-scroll-track').style.animationPlayState).toBe('paused');
		expect(page.getByTestId('welcome-scroll-duplicate')).toBe(clone);
		await fireEvent.mouseLeave(page.getByTestId('welcome-scroll-viewport'));
		expect(page.getByTestId('welcome-scroll-track').style.animationPlayState).toBe('running');
	});

	it('keeps copies out of the accessibility tree and stops on keyboard reading', async () => {
		const page = mount();
		await loaded(page);
		expect(page.getByTestId('welcome-scroll-duplicate').getAttribute('aria-hidden')).toBe('true');
		expect(Array.from(page.getByTestId('welcome-scroll-duplicate').querySelectorAll('a')).every(el => el.tabIndex === -1)).toBe(true);
		await fireEvent.keyDown(window, { key: 'Tab' });
		expect(page.queryByTestId('welcome-scroll-duplicate')).toBeNull();
		expect(page.getByTestId('welcome-scroll-viewport').tabIndex).toBe(0);
		const link = page.getByTestId('welcome-scroll-main').querySelector('a')!;
		const scrollIntoView = vi.spyOn(link, 'scrollIntoView');
		vi.spyOn(link, 'matches').mockImplementation(selector => selector === ':focus-visible');
		await fireEvent.focusIn(link);
		expect(page.queryByTestId('welcome-scroll-duplicate')).toBeNull();
		expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
	});

	it('does not move a card when ordinary pointer focus arrives before click', async () => {
		const page = mount();
		await loaded(page);
		const link = page.getByTestId('welcome-scroll-main').querySelector('a')!;
		vi.spyOn(link, 'matches').mockReturnValue(false);
		await fireEvent.focusIn(link);
		expect(page.getByTestId('welcome-scroll').dataset.animated).toBe('true');
		expect(page.getByTestId('welcome-scroll-duplicate')).not.toBeNull();
	});

	it('honors system reduced motion and changes to the application animation setting', async () => {
		const page = mount();
		await loaded(page);
		reduce(true);
		await nextTick();
		expect(page.queryByTestId('welcome-scroll-duplicate')).toBeNull();
		expect(page.queryByTestId('welcome-scroll-toggle')).toBeNull();
		reduce(false);
		await nextTick();
		expect(page.getByTestId('welcome-scroll-duplicate')).not.toBeNull();
		preferReactive.animation.value = false;
		await nextTick();
		expect(page.queryByTestId('welcome-scroll-duplicate')).toBeNull();
	});

	it('keeps classic cards and their copies in the same rendering mode', async () => {
		const page = render(XTimeline);
		await loaded(page);
		expect(page.queryByTestId('welcome-scroll-toggle')).toBeNull();
		expect(Array.from(page.container.querySelectorAll('[data-preview]')).every(el => el.getAttribute('data-preview') === 'false')).toBe(true);
	});
});

describe('welcome timeline cleanup', () => {
	it('times out stalled feeds instead of leaving the empty desktop column indefinitely', async () => {
		vi.useFakeTimers();
		mocks.post.mockReturnValue(new Promise(() => undefined));
		mocks.get.mockReturnValue(new Promise(() => undefined));
		const page = mount();
		await vi.advanceTimersByTimeAsync(15_000);
		expect(mocks.get).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(15_000);
		expect(page.emitted().unavailable).toHaveLength(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('disposes the channel, observer and listeners on unmount', async () => {
		const remove = vi.spyOn(window, 'removeEventListener');
		const page = mount();
		await loaded(page);
		const signal = mocks.post.mock.calls[0][3] as AbortSignal;
		page.unmount();
		expect(signal.aborted).toBe(true);
		expect(mocks.dispose).toHaveBeenCalledTimes(1);
		expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
		expect(media.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
		expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function));
	});

	it('ignores a late response after unmount and does not start fallback or stream work', async () => {
		let resolve!: (notes: Misskey.entities.Note[]) => void;
		mocks.post.mockReturnValue(new Promise<Misskey.entities.Note[]>(done => { resolve = done; }));
		const page = mount();
		page.unmount();
		resolve(initial());
		await nextTick();
		expect(mocks.connect).not.toHaveBeenCalled();
		expect(mocks.get).not.toHaveBeenCalled();
		expect(page.emitted().ready).toBeUndefined();
	});

	it('cleans up on KeepAlive deactivation and reconnects only once on activation', async () => {
		const shown = ref(true);
		const page = render(defineComponent({ setup: () => () => h(KeepAlive, () => shown.value ? h(XTimeline, { preview: true }) : null) }));
		await loaded(page);
		expect(mocks.post).toHaveBeenCalledTimes(1);
		shown.value = false;
		await nextTick();
		expect(mocks.dispose).toHaveBeenCalledTimes(1);
		expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
		mocks.onNote!(note('inactive'));
		shown.value = true;
		await nextTick();
		await waitFor(() => expect(mocks.connect).toHaveBeenCalledTimes(2));
		expect(mocks.post).toHaveBeenCalledTimes(2);
		expect(ids(page)).not.toContain('inactive');
	});

	it('retains the previous list if reconnecting later cannot load either source', async () => {
		const shown = ref(true);
		const unavailable = vi.fn();
		const page = render(defineComponent({ setup: () => () => h(KeepAlive, () => shown.value ? h(XTimeline, { preview: true, onUnavailable: unavailable }) : null) }));
		await loaded(page);
		shown.value = false;
		await nextTick();
		mocks.post.mockRejectedValue(new Error('offline'));
		mocks.get.mockRejectedValue(new Error('offline'));
		shown.value = true;
		await nextTick();
		await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(1));
		expect(ids(page)).toHaveLength(20);
		expect(unavailable).not.toHaveBeenCalled();
	});
});
