/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureTimelineAnchor, isTimelineAtTop, restoreTimelineAnchor, retainTimelineWindow } from '@/utility/timeline-window.js';

const items = Array.from({ length: 150 }, (_, id) => ({ id: String(id) }));
function rectangle(top: number, height = 100): DOMRect { return { top, bottom: top + height, height } as DOMRect; }

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('bounded timeline history', () => {
	it('retains the older end while preserving the visible reading position', () => {
		const retained = retainTimelineWindow(items, '100');
		expect(retained).toHaveLength(120);
		expect(retained[0].id).toBe('30');
		expect(retained.at(-1)?.id).toBe('149');
	});
	it('keeps the newer end when the reader scrolls back before a slow page returns', () => {
		const retained = retainTimelineWindow(items, '12');
		expect(retained).toHaveLength(120);
		expect(retained[0].id).toBe('0');
		expect(retained.at(-1)?.id).toBe('119');
	});
	it('chooses a safe window without an anchor and never truncates a short page', () => {
		expect(retainTimelineWindow(items, null, true)[0].id).toBe('0');
		expect(retainTimelineWindow(items, null, false)[0].id).toBe('30');
		const short = items.slice(0, 15);
		expect(retainTimelineWindow(short)).toBe(short);
	});
});

describe('timeline scroll anchors', () => {
	it('restores a nested reading anchor in the correct direction and tolerates browser anchoring', () => {
		const root = document.createElement('div');
		const container = document.createElement('div');
		container.append(root);
		Object.defineProperty(container, 'clientHeight', { value: 400 });
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(rectangle(80, 400));
		const row = document.createElement('div');
		row.dataset.timelineRow = '';
		row.dataset.scrollAnchor = 'visible';
		root.append(row);
		const rect = vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(rectangle(100));
		const anchor = captureTimelineAnchor(root, container)!;
		expect(anchor).toEqual({ id: 'visible', top: 20 });
		container.scrollTop = 5000;
		rect.mockReturnValue(rectangle(-900));
		restoreTimelineAnchor(root, container, anchor);
		expect(container.scrollTop).toBe(4000);
		rect.mockReturnValue(rectangle(100));
		restoreTimelineAnchor(root, container, anchor);
		expect(container.scrollTop).toBe(4000);
	});
	it('uses real viewport geometry for window scrolling instead of assuming top', () => {
		const root = document.createElement('div');
		const rect = vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(rectangle(-300));
		expect(isTimelineAtTop(root, null)).toBe(false);
		rect.mockReturnValue(rectangle(0));
		expect(isTimelineAtTop(root, null)).toBe(true);
		const row = document.createElement('div');
		row.dataset.timelineRow = '';
		row.dataset.scrollAnchor = 'a';
		root.append(row);
		vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(rectangle(-400));
		const scroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
		restoreTimelineAnchor(root, null, { id: 'a', top: 0 });
		expect(scroll).toHaveBeenCalledWith({ top: -400, behavior: 'instant' });
	});
});
