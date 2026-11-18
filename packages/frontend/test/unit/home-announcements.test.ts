/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createApp, defineComponent, h, KeepAlive, nextTick, reactive, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { preferReactive } from '../setup.unit.js';
import type { HomeAnnouncement } from '@/utility/home-announcements.js';
import { loadHomeAnnouncements } from '@/utility/home-announcements.js';
import { useHomeAnnouncements } from '@/composables/use-home-announcements.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { $i } from '@/i.js';
import MkHomeAnnouncements from '@/components/MkHomeAnnouncements.vue';

vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: vi.fn() }));
const account = vi.hoisted(() => ({ current: null as null | { id: string; isAdmin: boolean; isModerator: boolean } }));
vi.mock('@/i.js', async () => {
	const { reactive } = await import('vue');
	account.current = reactive({ id: 'synthetic-user-a', isAdmin: false, isModerator: false });
	return { get $i() { return account.current; } };
});
vi.mock('@/components/MkHomeAnnouncementEditor.vue', async () => {
	const { defineComponent, h } = await import('vue');
	return { __esModule: true, default: defineComponent({
		props: { initialId: { type: String, default: null } }, emits: ['saved', 'closed'],
		setup: (props, { emit }) => () => h('div', { 'data-testid': 'editor-stub', 'data-initial-id': props.initialId }, [
			h('button', { 'data-testid': 'editor-save', onClick: () => emit('saved') }),
			h('button', { 'data-testid': 'editor-close', onClick: () => emit('closed') }),
		]),
	}) };
});

function announcement(id: string, extra: Partial<HomeAnnouncement> = {}): HomeAnnouncement {
	return { id, title: `Announcement ${id}`, text: 'Body', createdAt: '2026-10-23T00:00:00.000Z', updatedAt: null, imageUrl: null, icon: 'info', display: 'marquee', forYou: false, silence: true, needConfirmationToRead: false, ...extra };
}

describe('complete public homepage announcement snapshots', () => {
	it('loads every page before returning, retains read items, deduplicates and orders newest first', async () => {
		const first = Array.from({ length: 100 }, (_, i) => announcement(`first-${i}`, { isRead: true }));
		const older = announcement('older', { createdAt: '2026-10-22T00:00:00.000Z' });
		const load = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce([first[0], older]);
		const signal = new AbortController().signal;
		const result = await loadHomeAnnouncements(load, signal);
		expect(load.mock.calls[0]).toEqual([{ display: 'marquee', isActive: true, limit: 100 }, signal]);
		expect(load.mock.calls[1][0]).toEqual({ display: 'marquee', isActive: true, limit: 100, untilId: 'first-99' });
		expect(result).toHaveLength(101);
		expect(result.at(-1)?.id).toBe('older');
		expect(result.filter(item => item.isRead)).toHaveLength(100);
	});

	it('does not expose targeted or other display types if unexpectedly returned', async () => {
		const load = vi.fn().mockResolvedValue([announcement('valid'), announcement('targeted', { forYou: true }), announcement('banner', { display: 'banner' })]);
		expect((await loadHomeAnnouncements(load, new AbortController().signal)).map(item => item.id)).toEqual(['valid']);
	});

	it('rejects an incomplete snapshot if a later page fails', async () => {
		const load = vi.fn().mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) => announcement(String(i)))).mockRejectedValueOnce(new Error('offline'));
		await expect(loadHomeAnnouncements(load, new AbortController().signal)).rejects.toThrow('offline');
	});

	it('stops a non-advancing pagination response instead of repeatedly requesting it', async () => {
		const load = vi.fn().mockResolvedValue(Array.from({ length: 100 }, (_, i) => announcement(String(i))));
		await expect(loadHomeAnnouncements(load, new AbortController().signal)).rejects.toThrow('did not advance');
		expect(load).toHaveBeenCalledTimes(2);
	});

	it('does not return or continue a page after cancellation', async () => {
		const controller = new AbortController();
		const load = vi.fn().mockImplementation(async () => { controller.abort(); return [announcement('late')]; });
		await expect(loadHomeAnnouncements(load, controller.signal)).rejects.toThrow();
		expect(load).toHaveBeenCalledTimes(1);
	});
});

describe('homepage announcement lifecycle and rendering', () => {
	const api = vi.mocked(misskeyApi);
	const dispose: (() => void)[] = [];
	let reducedMotion: MediaQueryList;

	beforeEach(() => {
		account.current = reactive({ id: 'synthetic-user-a', isAdmin: false, isModerator: false });
		vi.useFakeTimers();
		api.mockReset();
		api.mockResolvedValue([announcement('one', { isRead: true })]);
		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
		preferReactive.animation = ref(true);
		reducedMotion = Object.assign(new EventTarget(), { matches: false, media: '(prefers-reduced-motion: reduce)', onchange: null, addListener: vi.fn(), removeListener: vi.fn() });
		vi.spyOn(window, 'matchMedia').mockReturnValue(reducedMotion);
		vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
	});
	afterEach(() => {
		cleanup();
		for (const release of dispose.splice(0)) release();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	function mountFeed() {
		let result!: ReturnType<typeof useHomeAnnouncements>;
		const shown = ref(true);
		const child = defineComponent({ setup() { result = useHomeAnnouncements(); return () => h('div'); } });
		const host = document.createElement('div');
		const app = createApp({ setup: () => () => h(KeepAlive, null, { default: () => shown.value ? h(child) : null }) });
		app.mount(host);
		dispose.push(() => app.unmount());
		return { get result() { return result; }, shown, app };
	}

	function mountBar() {
		return render(MkHomeAnnouncements, {
			global: { components: { MkA: defineComponent({ props: { to: { type: String, required: true } }, setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }) } },
		});
	}

	it('uses the public API without marking read and keeps previous items on failure, then hides after an empty success', async () => {
		api.mockResolvedValueOnce([announcement('known', { isRead: true })]).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
		const feed = mountFeed();
		await vi.advanceTimersByTimeAsync(0);
		expect(feed.result.announcements.value[0].id).toBe('known');
		expect(api.mock.calls[0][2]).toBeNull();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(feed.result.announcements.value[0].id).toBe('known');
		await vi.advanceTimersByTimeAsync(60_000);
		expect(feed.result.announcements.value).toEqual([]);
		expect(api.mock.calls.every(([endpoint]) => endpoint === 'announcements')).toBe(true);
	});

	it('aborts on cached route deactivation, ignores late results and reloads on re-entry', async () => {
		let resolve!: (value: HomeAnnouncement[]) => void;
		api.mockImplementationOnce(() => new Promise<HomeAnnouncement[]>(done => { resolve = done; }));
		const feed = mountFeed();
		expect(api).toHaveBeenCalledTimes(1);
		feed.shown.value = false;
		await nextTick();
		expect(api.mock.calls[0][3]?.aborted).toBe(true);
		resolve([announcement('late')]);
		await vi.advanceTimersByTimeAsync(120_000);
		expect(feed.result.announcements.value).toEqual([]);
		expect(api).toHaveBeenCalledTimes(1);
		feed.shown.value = true;
		await nextTick();
		await vi.advanceTimersByTimeAsync(0);
		expect(feed.result.announcements.value[0].id).toBe('one');
	});

	it('aborts and clears account-scoped in-flight work when the account changes', async () => {
		api.mockImplementationOnce(() => new Promise(() => {}));
		const feed = mountFeed();
		$i!.id = 'synthetic-user-b';
		expect(api.mock.calls[0][3]?.aborted).toBe(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(api).toHaveBeenCalledTimes(2);
		expect(feed.result.announcements.value[0].id).toBe('one');
	});

	it('renders titles as text, exposes one accessible link per item, and updates without a pause button', async () => {
		api.mockResolvedValueOnce([announcement('safe', { title: '<img src=x onerror=alert(1)>' })]).mockResolvedValue([announcement('edited', { title: 'Edited title' })]);
		const view = mountBar();
		await vi.advanceTimersByTimeAsync(0);
		expect(view.queryByRole('img')).toBeNull();
		expect(view.getAllByRole('link')).toHaveLength(1);
		expect(view.getByRole('link').textContent).toBe('<img src=x onerror=alert(1)>');
		for (const link of view.container.querySelectorAll('[aria-hidden="true"] a')) expect(link.getAttribute('tabindex')).toBe('-1');
		expect(view.queryByTestId('marquee-toggle')).toBeNull();
		expect(view.queryByTestId('marquee-edit')).toBeNull();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(view.getByRole('link').textContent).toBe('Edited title');
		expect(view.queryByTestId('marquee-toggle')).toBeNull();
	});

	it('pauses on hover and focus and uses a static scrollable list for either reduced-motion preference', async () => {
		const view = mountBar();
		await vi.advanceTimersByTimeAsync(0);
		const bar = view.getByTestId('home-announcements');
		await fireEvent.pointerEnter(bar, { pointerType: 'mouse' });
		expect(bar.getAttribute('data-paused')).toBe('true');
		await fireEvent.pointerLeave(bar, { pointerType: 'mouse' });
		expect(bar.getAttribute('data-paused')).toBe('false');
		const link = view.getByRole('link');
		vi.spyOn(link, 'matches').mockReturnValue(true);
		await fireEvent.focusIn(link);
		expect(bar.getAttribute('data-static')).toBe('true');
		await fireEvent.focusOut(link);
		expect(bar.getAttribute('data-static')).toBe('false');
		preferReactive.animation.value = false;
		await nextTick();
		expect(bar.getAttribute('data-static')).toBe('true');
		expect(view.queryByTestId('marquee-toggle')).toBeNull();
		preferReactive.animation.value = true;
		Object.defineProperty(reducedMotion, 'matches', { value: true, configurable: true });
		reducedMotion.dispatchEvent(new Event('change'));
		await nextTick();
		expect(bar.getAttribute('data-static')).toBe('true');
	});

	it.each(['guest', 'user', 'moderator'])('does not expose pause or edit controls for %s', async role => {
		account.current = role === 'guest' ? null : { id: 'ordinary', isAdmin: false, isModerator: role === 'moderator' };
		const view = mountBar();
		await vi.advanceTimersByTimeAsync(0);
		expect(view.queryByRole('button')).toBeNull();
	});

	it('lets an administrator edit one announcement directly even with reduced motion and refreshes after saving', async () => {
		account.current!.isAdmin = true;
		preferReactive.animation.value = false;
		const view = mountBar();
		await vi.advanceTimersByTimeAsync(0);
		await fireEvent.click(view.getByTestId('marquee-edit'));
		await vi.advanceTimersByTimeAsync(0);
		expect(view.getByTestId('editor-stub').getAttribute('data-initial-id')).toBe('one');
		const requests = api.mock.calls.length;
		await fireEvent.click(view.getByTestId('editor-save'));
		await vi.advanceTimersByTimeAsync(0);
		expect(api).toHaveBeenCalledTimes(requests + 1);
		await fireEvent.click(view.getByTestId('editor-close'));
		expect(view.queryByTestId('editor-stub')).toBeNull();
		expect(document.activeElement).toBe(view.getByTestId('marquee-edit'));
	});

	it('opens selection for multiple announcements', async () => {
		account.current!.isAdmin = true;
		api.mockResolvedValue([announcement('one'), announcement('two')]);
		const view = mountBar();
		await vi.advanceTimersByTimeAsync(0);
		await fireEvent.click(view.getByTestId('marquee-edit'));
		await vi.advanceTimersByTimeAsync(0);
		expect(view.getByTestId('editor-stub').getAttribute('data-initial-id')).toBeNull();
	});

	it('invalidates an older in-flight snapshot when the feed is explicitly refreshed', async () => {
		let resolve!: (value: HomeAnnouncement[]) => void;
		api.mockImplementationOnce(() => new Promise<HomeAnnouncement[]>(done => { resolve = done; }));
		const feed = mountFeed();
		feed.result.refresh();
		expect(api.mock.calls[0][3]?.aborted).toBe(true);
		resolve([announcement('stale')]);
		await vi.advanceTimersByTimeAsync(0);
		expect(feed.result.announcements.value[0].id).toBe('one');
	});
});
