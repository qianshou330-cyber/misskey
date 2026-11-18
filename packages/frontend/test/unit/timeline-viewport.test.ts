/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimelineViewport } from '@/utility/timeline-viewport.js';

function observers() {
	let intersectionCallback!: IntersectionObserverCallback;
	let resizeCallback!: ResizeObserverCallback;
	const intersectionObserve = vi.fn();
	const intersectionUnobserve = vi.fn();
	const intersectionDisconnect = vi.fn();
	const resizeObserve = vi.fn();
	const resizeUnobserve = vi.fn();
	const resizeDisconnect = vi.fn();
	vi.stubGlobal('IntersectionObserver', class {
		constructor(callback: IntersectionObserverCallback) { intersectionCallback = callback; }
		observe = intersectionObserve;
		unobserve = intersectionUnobserve;
		disconnect = intersectionDisconnect;
	});
	vi.stubGlobal('ResizeObserver', class {
		constructor(callback: ResizeObserverCallback) { resizeCallback = callback; }
		observe = resizeObserve;
		unobserve = resizeUnobserve;
		disconnect = resizeDisconnect;
	});
	return {
		intersectionObserve, intersectionUnobserve, intersectionDisconnect, resizeObserve, resizeUnobserve, resizeDisconnect,
		visibility: (target: Element, isIntersecting: boolean) => intersectionCallback([{ target, isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver),
		resize: (target: Element, blockSize: number) => resizeCallback([{ target, borderBoxSize: [{ blockSize }] } as unknown as ResizeObserverEntry], {} as ResizeObserver),
	};
}

describe('TimelineViewport', () => {
	afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

	it('observes the inner layout height and releases both observations on removal', () => {
		const observer = observers();
		const element = document.createElement('div');
		const content = document.createElement('div');
		const visibility = vi.fn();
		const resize = vi.fn();
		const viewport = new TimelineViewport();
		const stop = viewport.observe(element, { visibility, resize });
		viewport.observeContent(element, content);
		observer.visibility(element, false);
		observer.resize(content, 240);
		expect(observer.intersectionObserve).toHaveBeenCalledWith(element);
		expect(observer.resizeObserve).toHaveBeenCalledWith(content);
		expect(observer.resizeObserve.mock.calls[0][0]).not.toBe(element);
		expect(visibility).toHaveBeenLastCalledWith(false);
		expect(resize).toHaveBeenLastCalledWith(240);
		stop();
		expect(observer.intersectionUnobserve).toHaveBeenCalledWith(element);
		expect(observer.resizeUnobserve).toHaveBeenCalledWith(content);
		observer.resize(content, 1);
		expect(resize).toHaveBeenCalledOnce();
		viewport.dispose();
		expect(observer.intersectionDisconnect).toHaveBeenCalledOnce();
		expect(observer.resizeDisconnect).toHaveBeenCalledOnce();
	});

	it('retains animated content through IO exit and ignores an obsolete release', () => {
		vi.useFakeTimers();
		const observer = observers();
		const element = document.createElement('div');
		const visibility = vi.fn();
		const viewport = new TimelineViewport();
		viewport.observe(element, { visibility, resize: vi.fn() });
		const firstRelease = viewport.pin(element);
		const latestRelease = viewport.pin(element);
		observer.visibility(element, false);
		expect(visibility).toHaveBeenLastCalledWith(true);
		firstRelease();
		expect(visibility).toHaveBeenLastCalledWith(true);
		latestRelease();
		expect(visibility).toHaveBeenLastCalledWith(false);
		expect(vi.getTimerCount()).toBe(0);
		viewport.dispose();
	});

	it('bounds interrupted motion to 800ms and cancels leases on disposal', () => {
		vi.useFakeTimers();
		const observer = observers();
		const element = document.createElement('div');
		const visibility = vi.fn();
		const viewport = new TimelineViewport();
		viewport.observe(element, { visibility, resize: vi.fn(), isRendered: () => true });
		viewport.pinRendered();
		observer.visibility(element, false);
		vi.advanceTimersByTime(799);
		expect(visibility).toHaveBeenLastCalledWith(true);
		// Another live update must not renew an already offscreen row's lease.
		viewport.pinRendered();
		vi.advanceTimersByTime(1);
		expect(visibility).toHaveBeenLastCalledWith(false);
		viewport.pin(element);
		viewport.dispose();
		expect(vi.getTimerCount()).toBe(0);
	});
});
