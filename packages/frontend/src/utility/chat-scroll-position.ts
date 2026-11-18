/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { captureTimelineAnchor, restoreTimelineAnchor, timelineViewportBounds } from '@/utility/timeline-window.js';
import type { TimelineAnchor } from '@/utility/timeline-window.js';

/** Private-chat layout changes must not move the message the reader is viewing. */
export class ChatScrollPosition {
	private anchor: TimelineAnchor | null = null;
	private focusedId: string | null = null;
	private follow = false;
	private dimensions = '';
	private frame: number | undefined;
	private disposed = false;
	private observer: ResizeObserver | undefined;
	private viewport = window.visualViewport;

	constructor(private root: HTMLElement, private container: HTMLElement, footer: HTMLElement, private hasNewer: () => boolean) {
		this.refresh();
		this.container.addEventListener('scroll', this.scrolled, { passive: true });
		this.container.addEventListener('wheel', this.userScroll, { passive: true });
		this.container.addEventListener('touchmove', this.userScroll, { passive: true });
		this.container.addEventListener('pointerdown', this.userScroll, { passive: true });
		this.container.addEventListener('keydown', this.keyScroll);
		window.addEventListener('resize', this.afterResize, { passive: true });
		this.viewport?.addEventListener('resize', this.afterResize, { passive: true });
		this.viewport?.addEventListener('scroll', this.afterResize, { passive: true });
		if (typeof ResizeObserver !== 'undefined') {
			this.observer = new ResizeObserver(this.afterResize);
			for (const element of [root, container, footer]) this.observer.observe(element);
		}
	}

	private measure(): string {
		const bounds = this.container.getBoundingClientRect();
		return [bounds.top, bounds.left, this.container.clientWidth, this.container.clientHeight, this.root.offsetWidth, this.root.offsetHeight].join(':');
	}

	private remember(): void {
		this.dimensions = this.measure();
		const focused = this.focusedId ? Array.from(this.root.querySelectorAll<HTMLElement>('[data-timeline-row]')).find(row => row.dataset.scrollAnchor === this.focusedId) : null;
		if (!focused) this.focusedId = null;
		this.follow = !focused && !this.hasNewer() && Math.abs(this.container.scrollTop) <= 48;
		this.anchor = focused ? { id: this.focusedId!, top: focused.getBoundingClientRect().top - timelineViewportBounds(this.container).top } : captureTimelineAnchor(this.root, this.container);
	}

	private scrolled = (): void => {
		// Browser scroll anchoring/clamping may fire before ResizeObserver. Retain
		// the previous snapshot until the changed geometry has been reconciled.
		if (this.measure() !== this.dimensions) this.afterResize();
		else if (this.frame === undefined) this.remember();
	};

	private userScroll = (): void => {
		// Explicit scrolling takes precedence over a queued keyboard correction.
		this.focusedId = null;
		this.refresh();
	};

	private keyScroll = (event: KeyboardEvent): void => {
		if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) this.userScroll();
	};

	/** Hold the actual quote target while neighboring virtual rows measure. */
	public focusMessage(id: string): void {
		this.focusedId = id;
		this.refresh();
	}

	public beforeResize = (): void => {
		if (this.disposed || this.frame !== undefined) return;
		if (this.measure() === this.dimensions) this.remember();
	};

	public afterResize = (): void => {
		if (this.disposed || this.frame !== undefined) return;
		this.frame = window.requestAnimationFrame(() => {
			this.frame = undefined;
			if (this.disposed || !this.root.isConnected) return;
			if (this.follow && !this.hasNewer()) this.container.scrollTo({ top: 0, behavior: 'instant' });
			else if (this.anchor) restoreTimelineAnchor(this.root, this.container, this.anchor);
			this.remember();
		});
	};

	/** Call after intentional message-window navigation or an explicit restore. */
	public refresh = (): void => {
		if (this.disposed) return;
		if (this.frame !== undefined) window.cancelAnimationFrame(this.frame);
		this.frame = undefined;
		this.remember();
	};

	public dispose(): void {
		this.disposed = true;
		if (this.frame !== undefined) window.cancelAnimationFrame(this.frame);
		this.frame = undefined;
		this.observer?.disconnect();
		this.container.removeEventListener('scroll', this.scrolled);
		this.container.removeEventListener('wheel', this.userScroll);
		this.container.removeEventListener('touchmove', this.userScroll);
		this.container.removeEventListener('pointerdown', this.userScroll);
		this.container.removeEventListener('keydown', this.keyScroll);
		window.removeEventListener('resize', this.afterResize);
		this.viewport?.removeEventListener('resize', this.afterResize);
		this.viewport?.removeEventListener('scroll', this.afterResize);
	}
}
