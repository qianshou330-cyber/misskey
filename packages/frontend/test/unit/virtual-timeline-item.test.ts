/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { cleanup, render } from '@testing-library/vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { h, nextTick, onMounted, onUnmounted, provide, TransitionGroup } from 'vue';
import MkVirtualTimelineItem from '@/components/MkVirtualTimelineItem.vue';
import { TimelineViewport, timelineViewportKey } from '@/utility/timeline-viewport.js';

async function tick() { await nextTick(); await nextTick(); }

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('virtual timeline row lifecycle', () => {
	it('unmounts the entire row including media/ad content and remounts without list-enter animation', async () => {
		let callback!: IntersectionObserverCallback;
		let resizeCallback!: ResizeObserverCallback;
		vi.stubGlobal('IntersectionObserver', class {
			constructor(cb: IntersectionObserverCallback) { callback = cb; }
			observe() {}
			unobserve() {}
			disconnect() {}
		});
		vi.stubGlobal('ResizeObserver', class {
			constructor(cb: ResizeObserverCallback) { resizeCallback = cb; }
			observe() {}
			unobserve() {}
			disconnect() {}
		});
		const mounted = vi.fn();
		const unmounted = vi.fn();
		const enter = vi.fn();
		const viewport = new TimelineViewport();
		const Child = {
			setup() {
				onMounted(mounted);
				onUnmounted(unmounted);
				return () => h('div', [h('button', 'control'), h('img', { alt: '', src: 'about:blank' }), h('aside', 'ad')]);
			},
		};
		const page = render({
			setup() {
				provide(timelineViewportKey, viewport);
				return () => h(TransitionGroup, { onEnter: enter, css: false }, () => [h(MkVirtualTimelineItem, { key: 'note' }, () => h(Child))]);
			},
		});
		await tick();
		const row = page.container.querySelector<HTMLElement>('[data-virtualized]')!;
		expect(mounted).toHaveBeenCalledOnce();
		expect(row.querySelector('img')).not.toBeNull();
		Object.defineProperty(row.firstElementChild, 'offsetHeight', { value: 320 });
		resizeCallback([{ target: row.firstElementChild, borderBoxSize: [{ blockSize: 320.5 }] } as unknown as ResizeObserverEntry], {} as ResizeObserver);
		callback([{ target: row, isIntersecting: false } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
		await tick();
		expect(unmounted).toHaveBeenCalledOnce();
		expect(row.style.height).toBe('320.5px');
		expect(row.querySelector('img')).toBeNull();
		expect(row.querySelector('aside')).toBeNull();
		callback([{ target: row, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
		await tick();
		expect(mounted).toHaveBeenCalledTimes(2);
		expect(row.style.height).toBe('');
		expect(enter).not.toHaveBeenCalled();
		page.unmount();
		viewport.dispose();
		expect(unmounted).toHaveBeenCalledTimes(2);
	});

	it('retains a focused control until focus leaves the offscreen row', async () => {
		let callback!: IntersectionObserverCallback;
		vi.stubGlobal('IntersectionObserver', class {
			constructor(cb: IntersectionObserverCallback) { callback = cb; }
			observe() {}
			unobserve() {}
			disconnect() {}
		});
		const viewport = new TimelineViewport();
		const page = render({ setup() {
			provide(timelineViewportKey, viewport);
			return () => h(MkVirtualTimelineItem, {}, () => h('button', 'focused'));
		} });
		await tick();
		const row = page.container.querySelector<HTMLElement>('[data-virtualized]')!;
		const button = row.querySelector('button')!;
		button.focus();
		callback([{ target: row, isIntersecting: false } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
		await tick();
		expect(row.dataset.virtualized).toBe('false');
		button.blur();
		await tick();
		expect(row.dataset.virtualized).toBe('true');
		page.unmount();
		viewport.dispose();
	});
});
