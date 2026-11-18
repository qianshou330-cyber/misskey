/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKpopSheetHistory } from '@/utility/kpop-sheet-history.js';
import type { KpopSheetHistoryHost } from '@/utility/kpop-sheet-history.js';

function browser() {
	const events = new EventTarget();
	const location = { href: 'https://example.test/music-charts/kpop?chart=melon-hot100' };
	const stack: { state: unknown; url: string }[] = [{ state: { retained: true }, url: location.href }];
	let index = 0;
	const history = {
		get state(): unknown { return stack[index].state; },
		pushState: vi.fn((state: unknown, _title: string, url: string) => { stack.splice(++index); stack.push({ state, url }); location.href = url; }),
		replaceState: vi.fn((state: unknown, _title: string, url: string) => { stack[index] = { state, url }; location.href = url; }),
		back: vi.fn(),
	};
	const host = { location, history, addEventListener: vi.fn(events.addEventListener.bind(events)), removeEventListener: vi.fn(events.removeEventListener.bind(events)) } as unknown as KpopSheetHistoryHost;

	function pop(eraseBeforeHandler = false): void {
		index = Math.max(0, index - 1);
		location.href = stack[index].url;
		const state = history.state;
		if (eraseBeforeHandler) stack[index].state = {};
		events.dispatchEvent(new PopStateEvent('popstate', { state }));
	}

	return { host, history, location, pop, stack };
}

afterEach(() => vi.useRealTimers());

describe('K-pop sheet browser history ownership', () => {
	it('pushes the exact same URL once and preserves unrelated state', () => {
		const b = browser(); const changed = vi.fn(); const sheet = createKpopSheetHistory(b.host, changed);
		sheet.open(); sheet.open();
		expect(b.history.pushState).toHaveBeenCalledTimes(1);
		expect(b.history.state).toMatchObject({ retained: true });
		expect(b.location.href).toBe(b.stack[0].url);
		expect(changed).toHaveBeenLastCalledWith(true);
		sheet.dispose();
	});
	it('browser back closes without another back, even when router clears state', () => {
		const b = browser(); const changed = vi.fn(); const sheet = createKpopSheetHistory(b.host, changed);
		sheet.open(); b.pop(true);
		expect(changed).toHaveBeenLastCalledWith(false);
		expect(b.history.back).not.toHaveBeenCalled();
		expect(sheet.isEngaged()).toBe(false);
		expect(b.host.removeEventListener).toHaveBeenCalled();
	});
	it('close is immediate and repeated close consumes only one entry', () => {
		vi.useFakeTimers();
		const b = browser(); const changed = vi.fn(); const sheet = createKpopSheetHistory(b.host, changed);
		sheet.open(); sheet.close(); sheet.close();
		expect(changed).toHaveBeenLastCalledWith(false);
		expect(b.history.back).toHaveBeenCalledTimes(1);
		b.pop(); expect(vi.getTimerCount()).toBe(0);
	});
	it('rapid reopen waits for the previous close traversal', async () => {
		const b = browser(); const changed = vi.fn(); const sheet = createKpopSheetHistory(b.host, changed);
		sheet.open(); sheet.close(); sheet.open();
		expect(changed).toHaveBeenLastCalledWith(false);
		expect(b.history.pushState).toHaveBeenCalledTimes(1);
		b.pop(); await Promise.resolve();
		expect(changed).toHaveBeenLastCalledWith(true);
		expect(b.history.pushState).toHaveBeenCalledTimes(2);
		sheet.dispose();
	});
	it('finishes a queued navigation after router popstate processing', async () => {
		const b = browser(); const sheet = createKpopSheetHistory(b.host, vi.fn()); const navigate = vi.fn();
		sheet.open(); sheet.close(navigate); expect(navigate).not.toHaveBeenCalled();
		b.pop(); expect(navigate).not.toHaveBeenCalled(); await Promise.resolve();
		expect(navigate).toHaveBeenCalledTimes(1);
	});
	it('never traverses on reset/dispose or after the route has changed', async () => {
		const b = browser(); const sheet = createKpopSheetHistory(b.host, vi.fn());
		sheet.open(); b.history.pushState({}, '', 'https://example.test/other'); sheet.close(); sheet.dispose(); await Promise.resolve();
		expect(b.history.back).not.toHaveBeenCalled(); expect(b.location.href).toBe('https://example.test/other');
	});
	it('route reset cancels a continuation already queued by popstate', async () => {
		const b = browser(); const sheet = createKpopSheetHistory(b.host, vi.fn()); const navigate = vi.fn();
		sheet.open(); sheet.close(navigate); b.pop(); sheet.reset(); await Promise.resolve();
		expect(navigate).not.toHaveBeenCalled();
	});
	it('disposal cancels queued reopening and leaves no timeout or listener', async () => {
		vi.useFakeTimers();
		const b = browser(); const changed = vi.fn(); const sheet = createKpopSheetHistory(b.host, changed);
		sheet.open(); sheet.close(); sheet.open(); sheet.dispose(); b.pop(); await Promise.resolve();
		expect(changed).toHaveBeenLastCalledWith(false);
		expect(b.history.pushState).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
	});
	it('recovers if embedded history ignores back without leaving listeners forever', async () => {
		vi.useFakeTimers(); const b = browser(); const sheet = createKpopSheetHistory(b.host, vi.fn());
		sheet.open(); sheet.close(); await vi.advanceTimersByTimeAsync(1000);
		expect(sheet.isEngaged()).toBe(false); expect(b.history.state).toEqual({ retained: true }); expect(vi.getTimerCount()).toBe(0);
	});
	it('still opens and closes when history storage is restricted', () => {
		const b = browser(); b.history.pushState.mockImplementation(() => { throw new Error('restricted'); });
		const changed = vi.fn(); const sheet = createKpopSheetHistory(b.host, changed);
		sheet.open(); expect(changed).toHaveBeenLastCalledWith(true); sheet.close();
		expect(changed).toHaveBeenLastCalledWith(false); expect(b.history.back).not.toHaveBeenCalled();
	});
});
