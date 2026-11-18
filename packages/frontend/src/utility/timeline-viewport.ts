/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { getScrollContainer } from '@@/js/scroll.js';
import type { InjectionKey } from 'vue';
import { timelineViewportBounds } from '@/utility/timeline-window.js';

type ItemCallbacks = {
	visibility: (visible: boolean) => void;
	resize: (height: number) => void;
	isRendered?: () => boolean;
};
type ViewportItem = { callbacks: ItemCallbacks; visible: boolean };

export const timelineViewportKey: InjectionKey<TimelineViewport> = Symbol('timelineViewport');
export const virtualTimelineKey: InjectionKey<boolean> = Symbol('virtualTimeline');

/** One observer pair and bounded animation leases for the whole timeline. */
export class TimelineViewport {
	private items = new Map<HTMLElement, ViewportItem>();
	private contents = new Map<Element, HTMLElement>();
	private pins = new Map<HTMLElement, { token: symbol; timer: number }>();
	private intersectionObserver: IntersectionObserver | null = null;
	private resizeObserver: ResizeObserver | null = null;

	public isNear(element: HTMLElement): boolean {
		const bounds = timelineViewportBounds(getScrollContainer(element));
		const rect = element.getBoundingClientRect();
		return rect.bottom >= bounds.top - 600 && rect.top <= bounds.bottom + 600;
	}

	private notify(element: HTMLElement): void {
		const item = this.items.get(element);
		if (item) item.callbacks.visibility(item.visible || this.pins.has(element));
	}

	public pin(element: HTMLElement): () => void {
		const old = this.pins.get(element);
		if (old) window.clearTimeout(old.timer);
		const token = Symbol();
		const release = (): void => {
			const pin = this.pins.get(element);
			if (pin?.token !== token) return;
			window.clearTimeout(pin.timer);
			this.pins.delete(element);
			this.notify(element);
		};
		this.pins.set(element, { token, timer: window.setTimeout(release, 800) });
		return release;
	}

	public pinRendered(): void {
		for (const [element, item] of this.items) {
			if (item.visible && (item.callbacks.isRendered?.() ?? true)) this.pin(element);
		}
	}

	public observe(element: HTMLElement, callbacks: ItemCallbacks): () => void {
		this.items.set(element, { callbacks, visible: this.isNear(element) });
		if (typeof IntersectionObserver === 'undefined') {
			this.items.get(element)!.visible = true;
		} else {
			this.intersectionObserver ??= new IntersectionObserver(entries => {
				for (const entry of entries) {
					const item = this.items.get(entry.target as HTMLElement);
					if (!item) continue;
					item.visible = entry.isIntersecting;
					this.notify(entry.target as HTMLElement);
				}
			}, { root: getScrollContainer(element), rootMargin: '600px 0px' });
			this.intersectionObserver.observe(element);
		}
		this.notify(element);
		return () => {
			this.items.delete(element);
			this.intersectionObserver?.unobserve(element);
			for (const [content, owner] of this.contents) {
				if (owner === element) {
					this.resizeObserver?.unobserve(content);
					this.contents.delete(content);
				}
			}
			const pin = this.pins.get(element);
			if (pin) window.clearTimeout(pin.timer);
			this.pins.delete(element);
		};
	}

	/** Observe inner content, never the animated/collapsing outer shell. */
	public observeContent(element: HTMLElement, content: HTMLElement): () => void {
		this.contents.set(content, element);
		if (typeof ResizeObserver !== 'undefined') {
			this.resizeObserver ??= new ResizeObserver(entries => {
				for (const entry of entries) {
					const owner = this.contents.get(entry.target);
					if (!owner) continue;
					const box = Array.isArray(entry.borderBoxSize) ? entry.borderBoxSize[0] : entry.borderBoxSize as unknown as ResizeObserverSize;
					const height = box?.blockSize ?? (entry.target as HTMLElement).offsetHeight;
					if (Number.isFinite(height)) this.items.get(owner)?.callbacks.resize(height);
				}
			});
			this.resizeObserver.observe(content);
		}
		return () => {
			this.contents.delete(content);
			this.resizeObserver?.unobserve(content);
		};
	}

	public dispose(): void {
		for (const pin of this.pins.values()) window.clearTimeout(pin.timer);
		this.pins.clear();
		this.items.clear();
		this.contents.clear();
		this.intersectionObserver?.disconnect();
		this.resizeObserver?.disconnect();
		this.intersectionObserver = null;
		this.resizeObserver = null;
	}
}
