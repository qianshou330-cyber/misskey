/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const TIMELINE_WINDOW_SIZE = 120;
export type TimelineAnchor = { id: string; top: number };

/** Keep the reader's current row even if they scroll back during a request. */
export function retainTimelineWindow<T extends { id: string }>(items: readonly T[], anchorId?: string | null, atTop = false): readonly T[] {
	if (items.length <= TIMELINE_WINDOW_SIZE) return items;
	const cut = items.length - TIMELINE_WINDOW_SIZE;
	const anchorIndex = anchorId == null ? -1 : items.findIndex(item => item.id === anchorId);
	return (anchorIndex >= 0 && anchorIndex < cut) || (anchorIndex < 0 && atTop)
		? items.slice(0, TIMELINE_WINDOW_SIZE)
		: items.slice(-TIMELINE_WINDOW_SIZE);
}

export function timelineViewportBounds(container: HTMLElement | null): { top: number; bottom: number } {
	if (!container) return { top: 0, bottom: window.innerHeight };
	const rect = container.getBoundingClientRect();
	return { top: rect.top + container.clientTop, bottom: rect.top + container.clientTop + container.clientHeight };
}

export function isTimelineAtTop(root: HTMLElement | null, container: HTMLElement | null): boolean {
	if (!root) return true;
	return root.getBoundingClientRect().top >= timelineViewportBounds(container).top - 1;
}

export function captureTimelineAnchor(root: HTMLElement, container: HTMLElement | null): TimelineAnchor | null {
	const bounds = timelineViewportBounds(container);
	for (const row of root.querySelectorAll<HTMLElement>('[data-timeline-row]')) {
		const rect = row.getBoundingClientRect();
		if (rect.bottom > bounds.top && rect.top < bounds.bottom) {
			return { id: row.dataset.scrollAnchor!, top: rect.top - bounds.top };
		}
	}
	return null;
}

export function restoreTimelineAnchor(root: HTMLElement, container: HTMLElement | null, anchor: TimelineAnchor): void {
	const row = Array.from(root.querySelectorAll<HTMLElement>('[data-timeline-row]')).find(item => item.dataset.scrollAnchor === anchor.id);
	if (!row) return;
	const delta = row.getBoundingClientRect().top - timelineViewportBounds(container).top - anchor.top;
	if (Math.abs(delta) < 0.5) return;
	if (container) container.scrollTop += delta;
	else window.scrollBy({ top: delta, behavior: 'instant' });
}
