/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, KeepAlive, nextTick, ref, shallowRef } from 'vue';
import type { App } from 'vue';
import type { KpopMotionRow } from '@/utility/kpop-list-motion.js';
import { useKpopListMotion } from '@/composables/use-kpop-list-motion.js';
import { prefer } from '@/preferences.js';

vi.mock('@/preferences.js', async () => {
	const { reactive } = await import('vue');
	return { prefer: { s: reactive({ animation: true }) } };
});

const initial = [{ songId: 'first', rank: 1 }, { songId: 'second', rank: 7 }];
const swapped = [{ songId: 'second', rank: 1 }, { songId: 'first', rank: 7 }];

describe('K-pop motion lifecycle, focus and truthful ranks', () => {
	let app: App | null = null;
	let host: HTMLDivElement;
	let media: EventTarget & { matches: boolean };
	let motion: ReturnType<typeof useKpopListMotion>;
	let list: HTMLDivElement;
	let animations: { cancel: ReturnType<typeof vi.fn>; finished: Promise<unknown> }[];
	let originalAnimate: PropertyDescriptor | undefined;
	let offscreen = false;
	const rows = shallowRef<readonly KpopMotionRow[]>(initial);
	const context = ref('melon-top100|all|0');
	const ready = ref(true);
	const shown = ref(true);

	beforeEach(() => {
		vi.useFakeTimers();
		prefer.s.animation = true;
		rows.value = initial; context.value = 'melon-top100|all|0'; ready.value = true; shown.value = true;
		offscreen = false; animations = [];
		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
		media = Object.assign(new EventTarget(), { matches: false });
		vi.spyOn(window, 'matchMedia').mockReturnValue(media as MediaQueryList);
		vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ x: 10, y: offscreen ? -500 : 10, top: offscreen ? -500 : 10, bottom: offscreen ? -400 : 82, left: 10, right: 310, width: 300, height: 72, toJSON: () => ({}) }));
		originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
		Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: vi.fn(() => {
			const animation = { cancel: vi.fn(), finished: new Promise(() => {}) };
			animations.push(animation);
			return animation;
		}) });
		host = document.createElement('div'); document.body.append(host);
	});

	afterEach(() => {
		app?.unmount(); app = null; host.remove();
		if (originalAnimate) Object.defineProperty(Element.prototype, 'animate', originalAnimate);
		else Reflect.deleteProperty(Element.prototype, 'animate');
		vi.restoreAllMocks(); vi.useRealTimers();
	});

	function mount(keepAlive = false): void {
		const View = defineComponent({ setup() {
			const root = shallowRef<HTMLDivElement | null>(null);
			motion = useKpopListMotion({ context: () => context.value, rows: () => rows.value, ready: () => ready.value, root: () => root.value });
			return () => h('div', { ref: root, tabindex: -1, 'data-list': '', 'data-motion': motion.animate.value }, rows.value.map(row => h('button', { key: row.songId, 'data-song': row.songId, type: 'button' }, [h('strong', { 'data-kpop-rank': '' }, h('span', { 'data-kpop-rank-value': '' }, row.rank))])));
		} });
		app = createApp({ render: () => keepAlive ? h(KeepAlive, () => shown.value ? h(View) : null) : h(View) });
		app.mount(host); list = host.querySelector<HTMLDivElement>('[data-list]')!;
	}

	async function settle(): Promise<void> { await nextTick(); await nextTick(); }

	async function swap(): Promise<void> { rows.value = swapped; await settle(); }

	function button(id: string): HTMLButtonElement { return list.querySelector<HTMLButtonElement>(`[data-song="${id}"]`)!; }

	it.each([false, true])('keeps a populated mount baseline, including initial KeepAlive activation (%s)', async keepAlive => {
		mount(keepAlive); await settle();
		expect(motion.animate.value).toBe(false); expect(animations).toHaveLength(0);
		await swap();
		expect(motion.animate.value).toBe(true);
		expect(list.querySelectorAll('[data-kpop-rank-previous]')).toHaveLength(2);
	});

	it('does not animate an asynchronous first result or identical cached data', async () => {
		rows.value = []; ready.value = false; mount(); await settle();
		ready.value = true; rows.value = initial; await settle();
		expect(motion.animate.value).toBe(false);
		rows.value = initial.map(row => ({ ...row })); await settle();
		expect(motion.animate.value).toBe(false); expect(animations).toHaveLength(0);
		await swap(); expect(motion.animate.value).toBe(true);
	});

	it('shows only the old and actual new numbers, hides only the old overlay, and releases all effects', async () => {
		mount(); await swap();
		const row = button('second');
		expect(row.querySelector('[data-kpop-rank-value]')?.textContent).toBe('1');
		expect(row.querySelector('[data-kpop-rank-value]')?.getAttribute('aria-hidden')).toBeNull();
		expect(row.querySelector('[data-kpop-rank-previous]')?.textContent).toBe('7');
		expect(row.querySelector('[data-kpop-rank-previous]')?.getAttribute('aria-hidden')).toBe('true');
		expect([...row.querySelectorAll('[data-kpop-rank] span')].map(span => span.textContent)).toEqual(['1', '7']);
		await vi.advanceTimersByTimeAsync(250);
		expect(list.querySelector('[data-kpop-rank-previous]')).toBeNull();
		await vi.advanceTimersByTimeAsync(400);
		expect(list.querySelector('[data-kpop-hint]')).toBeNull();
		expect(motion.animate.value).toBe(false); expect(motion.changedIds.value.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
	});

	it.each(['genie-realtime|all|0', 'melon-top100|illit|0', 'melon-top100|all|50', 'melon-top100|search|0'])('does not animate a new scope, filter, page or search (%s)', async selection => {
		mount(); context.value = selection; await swap();
		expect(motion.animate.value).toBe(false); expect(animations).toHaveLength(0);
	});

	it('does not animate a failed/stale payload or replay it when reading succeeds again', async () => {
		mount(); ready.value = false; await swap();
		expect(motion.animate.value).toBe(false);
		ready.value = true; await settle(); expect(motion.animate.value).toBe(false);
		rows.value = initial; await settle(); expect(motion.animate.value).toBe(true);
	});

	it('honors a disabled preference and immediately cancels active effects when it changes', async () => {
		prefer.s.animation = false; mount(); await swap();
		expect(motion.animate.value).toBe(false); expect(animations).toHaveLength(0);
		prefer.s.animation = true; rows.value = initial; await settle();
		expect(motion.animate.value).toBe(false);
		await swap(); expect(motion.animate.value).toBe(true);
		prefer.s.animation = false;
		expect(motion.animate.value).toBe(false); expect(list.querySelector('[data-kpop-hint]')).toBeNull();
		expect(list.querySelector('[data-kpop-rank-previous]')).toBeNull(); expect(vi.getTimerCount()).toBe(0);
		expect(animations.every(animation => animation.cancel.mock.calls.length > 0)).toBe(true);
	});

	it('honors and listens to reduced-motion without replaying old changes', async () => {
		media.matches = true; mount(); await swap(); expect(animations).toHaveLength(0);
		media.matches = false; media.dispatchEvent(new Event('change')); rows.value = initial; await settle();
		expect(motion.animate.value).toBe(false);
		await swap(); expect(motion.animate.value).toBe(true);
		media.matches = true; media.dispatchEvent(new Event('change'));
		expect(motion.animate.value).toBe(false); expect(vi.getTimerCount()).toBe(0);
	});

	it('clears hidden effects and makes the first visible response a baseline', async () => {
		mount(); await swap();
		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden'); document.dispatchEvent(new Event('visibilitychange'));
		expect(motion.animate.value).toBe(false); expect(vi.getTimerCount()).toBe(0);
		rows.value = initial; await settle(); expect(motion.animate.value).toBe(false);
		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'); document.dispatchEvent(new Event('visibilitychange'));
		await swap(); expect(motion.animate.value).toBe(false);
		rows.value = initial; await settle(); expect(motion.animate.value).toBe(true);
	});

	it('cleans up on KeepAlive deactivation and unmount without replaying offscreen updates', async () => {
		mount(true); await swap(); shown.value = false; await settle();
		expect(motion.animate.value).toBe(false); expect(vi.getTimerCount()).toBe(0);
		rows.value = initial; await settle(); shown.value = true; await settle();
		await swap(); expect(motion.animate.value).toBe(false);
		rows.value = initial; await settle(); expect(motion.animate.value).toBe(true);
		app!.unmount(); app = null;
		expect(vi.getTimerCount()).toBe(0);
		media.dispatchEvent(new Event('change')); document.dispatchEvent(new Event('visibilitychange'));
		expect(vi.getTimerCount()).toBe(0);
	});

	it('cancels the previous animation before a rapid next rank change', async () => {
		mount(); await swap(); const firstAnimations = animations.slice();
		rows.value = initial; await settle();
		expect(firstAnimations.every(animation => animation.cancel.mock.calls.length > 0)).toBe(true);
		expect(button('second').querySelector('[data-kpop-rank-previous]')?.textContent).toBe('1');
		expect(button('second').querySelector('[data-kpop-rank-value]')?.textContent).toBe('7');
		expect(list.querySelectorAll('[data-kpop-rank-previous]')).toHaveLength(2);
	});

	it('falls back safely when Web Animations are unavailable or rows are outside the viewport', async () => {
		Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: undefined });
		mount(); await swap(); expect(list.querySelector('[data-kpop-rank-previous]')).toBeNull();
		offscreen = true; rows.value = initial; await settle(); expect(motion.animate.value).toBe(false);
	});

	it('retains the same focused song node after reorder, without scrolling or changing selection', async () => {
		mount(); const row = button('first'); row.setAttribute('aria-pressed', 'true'); row.style.background = 'var(--MI_THEME-accentedBg)';
		row.focus(); list.scrollTop = 75; const focus = vi.spyOn(row, 'focus');
		await swap();
		expect(button('first')).toBe(row); expect(document.activeElement).toBe(row);
		expect(focus).toHaveBeenCalledWith({ preventScroll: true }); expect(list.scrollTop).toBe(75);
		expect(row.getAttribute('aria-pressed')).toBe('true'); expect(row.style.background).toBe('var(--MI_THEME-accentedBg)');
	});

	it('does not pull focus from a control outside the refreshed list', async () => {
		mount(); const control = document.createElement('input'); host.append(control); control.focus();
		await swap(); expect(document.activeElement).toBe(control);
	});

	it('makes outgoing rows inert, moves their focus safely, and restores DOM state when cancelled', async () => {
		mount(); await swap(); const row = button('first'); row.style.color = 'red'; row.focus();
		motion.beforeLeave(row);
		expect(row.inert).toBe(true); expect(row.getAttribute('aria-hidden')).toBe('true'); expect(document.activeElement).toBe(list);
		motion.restoreLeaving(row);
		expect(row.inert).not.toBe(true); expect(row.getAttribute('aria-hidden')).toBeNull(); expect(row.style.color).toBe('red'); expect(row.style.top).toBe('');
		motion.restoreLeaving(row);
	});
});
