/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatScrollPosition } from '@/utility/chat-scroll-position.js';

function fixture(scrollTop = -200, newer = false) {
	let resize!: ResizeObserverCallback;
	const disconnect = vi.fn();
	vi.stubGlobal('ResizeObserver', class {
		constructor(callback: ResizeObserverCallback) { resize = callback; }
		observe = vi.fn();
		disconnect = disconnect;
	});
	const frames = new Map<number, FrameRequestCallback>();
	let nextId = 0;
	vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++nextId, callback); return nextId; });
	vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
	const container = document.createElement('div');
	const root = document.createElement('div');
	const footer = document.createElement('footer');
	const row = document.createElement('div');
	row.dataset.timelineRow = '';
	row.dataset.scrollAnchor = 'message-one';
	root.append(row);
	container.append(root);
	document.body.append(container, footer);
	const geometry = { height: 500, width: 393, rootHeight: 1000, displacement: 0 };
	Object.defineProperties(container, { clientHeight: { get: () => geometry.height }, clientWidth: { get: () => geometry.width } });
	Object.defineProperties(root, { offsetHeight: { get: () => geometry.rootHeight }, offsetWidth: { get: () => geometry.width } });
	container.getBoundingClientRect = () => ({ top: 50, left: 0, bottom: geometry.height + 50 } as DOMRect);
	row.getBoundingClientRect = () => {
		const top = 150 + geometry.displacement - (container.scrollTop - scrollTop);
		return { top, bottom: top + 70 } as DOMRect;
	};
	container.scrollTop = scrollTop;
	const scrollTo = vi.fn((options?: ScrollToOptions | number, y?: number) => { container.scrollTop = typeof options === 'number' ? y ?? 0 : options?.top ?? 0; });
	container.scrollTo = scrollTo;
	const position = new ChatScrollPosition(root, container, footer, () => newer);
	return {
		container, root, geometry, scrollTo, disconnect, position, frames,
		resize: () => resize([], {} as ResizeObserver),
		flush: () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0)); },
	};
}

describe('private chat keyboard and composer scroll position', () => {
	afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

	it('holds a located quote through multiple virtual row measurements until the user scrolls', () => {
		const f = fixture(-200, true);
		const target = document.createElement('div');
		target.dataset.timelineRow = ''; target.dataset.scrollAnchor = 'target'; f.root.append(target);
		let displacement = 0;
		target.getBoundingClientRect = () => ({ top: 300 + displacement - (f.container.scrollTop + 200), bottom: 380 + displacement - (f.container.scrollTop + 200) } as DOMRect);
		f.position.focusMessage('target');
		displacement = -180; f.geometry.rootHeight -= 180; f.resize(); f.flush();
		expect(target.getBoundingClientRect().top).toBe(300);
		displacement = -320; f.geometry.rootHeight -= 140; f.resize(); f.flush();
		expect(target.getBoundingClientRect().top).toBe(300);
		f.container.dispatchEvent(new Event('wheel'));
		displacement = -400; f.geometry.rootHeight -= 80; f.resize(); f.flush();
		expect(target.getBoundingClientRect().top).toBe(220);
		f.position.dispose();
	});

	it('retains a historical message through a resized viewport and browser scroll event', () => {
		const f = fixture();
		f.geometry.height -= 220;
		f.geometry.displacement = 90;
		f.container.dispatchEvent(new Event('scroll'));
		f.resize();
		f.flush();
		expect(f.container.scrollTop).toBe(-110);
		expect(f.scrollTo).not.toHaveBeenCalled();
		f.position.dispose();
	});

	it('follows the latest end when a keyboard closes after a send', () => {
		const f = fixture(-20);
		f.geometry.height += 220;
		f.container.scrollTop = -120;
		f.container.dispatchEvent(new Event('scroll'));
		f.resize();
		f.flush();
		expect(f.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' });
		f.position.dispose();
	});

	it('never treats the newest edge of an older paged window as the latest message', () => {
		const f = fixture(0, true);
		f.geometry.height -= 100;
		f.geometry.displacement = -30;
		f.resize();
		f.flush();
		expect(f.scrollTo).not.toHaveBeenCalled();
		expect(f.container.scrollTop).toBe(-30);
		f.position.dispose();
	});

	it('coalesces textarea, panel and viewport changes into one frame', () => {
		const f = fixture();
		f.position.beforeResize();
		f.geometry.rootHeight += 100;
		f.geometry.displacement = 45;
		f.position.afterResize();
		f.resize();
		window.dispatchEvent(new Event('resize'));
		expect(f.frames.size).toBe(1);
		f.flush();
		expect(f.container.scrollTop).toBe(-155);
		f.position.dispose();
	});

	it('respects explicit scrolling during a queued layout correction', () => {
		const f = fixture();
		f.position.afterResize();
		f.container.dispatchEvent(new Event('touchmove'));
		f.container.scrollTop = -260;
		f.container.dispatchEvent(new Event('scroll'));
		f.flush();
		expect(f.container.scrollTop).toBe(-260);
		expect(f.frames.size).toBe(0);
		f.position.dispose();
	});

	it('refreshes its baseline after intentional navigation', () => {
		const f = fixture();
		f.position.afterResize();
		f.container.scrollTop = 0;
		f.position.refresh();
		f.resize();
		f.flush();
		expect(f.scrollTo).toHaveBeenCalledOnce();
		f.position.dispose();
	});

	it('releases observers, listeners and pending frames on leaving the conversation', () => {
		const f = fixture();
		f.resize();
		f.position.dispose();
		f.resize();
		window.dispatchEvent(new Event('resize'));
		f.flush();
		expect(f.frames.size).toBe(0);
		expect(f.disconnect).toHaveBeenCalledOnce();
		expect(f.scrollTo).not.toHaveBeenCalled();
	});
});
