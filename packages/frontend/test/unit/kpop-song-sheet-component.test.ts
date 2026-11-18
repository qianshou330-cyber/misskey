/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import MkKpopSongSheet from '@/components/MkKpopSongSheet.vue';
import { hotkeyDirective } from '@/directives/hotkey.js';
import { preferState } from '../setup.unit.js';

vi.mock('@/os.js', () => ({ claimZIndex: () => 1000 }));
vi.mock('@/utility/device-kind.js', () => ({ deviceKind: 'smartphone' }));

describe('song sheet focus and modal disposal', () => {
	let app: App | null = null;
	afterEach(() => { app?.unmount(); app = null; document.body.replaceChildren(); delete preferState.animation; vi.restoreAllMocks(); });

	async function mount() {
		const trigger = document.createElement('button'); trigger.textContent = 'Synthetic trigger'; document.body.append(trigger); trigger.focus();
		const host = document.createElement('div'); document.body.append(host);
		const shown = ref(true); const closed = vi.fn();
		app = createApp({ render: () => shown.value ? h(MkKpopSongSheet, { title: 'Synthetic song', returnFocusTo: trigger, onClose: () => { shown.value = false; }, onClosed: closed }, () => h('a', { href: '#source' }, 'Synthetic source')) : null });
		app.directive('hotkey', hotkeyDirective); app.mount(host); await nextTick(); await nextTick();
		return { trigger, shown, closed };
	}

	it('close button restores focus and releases document scroll and inert state', async () => {
		const { trigger, closed } = await mount();
		expect(trigger.inert).toBe(true); expect(document.body.style.overflow).toBe('hidden');
		(document.querySelector('[data-testid="kpop-song-sheet"] button') as HTMLButtonElement).click(); await nextTick();
		expect(document.querySelector('[data-testid="kpop-song-sheet"]')).toBeNull();
		expect(trigger.inert).toBe(false); expect(document.activeElement).toBe(trigger); expect(document.body.style.overflow).toBe(''); expect(closed).toHaveBeenCalledTimes(1);
	});

	it('Escape uses the existing hotkey and direct disposal also releases its trap', async () => {
		const { trigger } = await mount(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await nextTick();
		expect(trigger.inert).toBe(false); expect(document.querySelector('[data-testid="kpop-song-sheet"]')).toBeNull();
	});

	it('navigation removing the component releases the trap without an explicit close', async () => {
		const { trigger } = await mount(); app!.unmount(); app = null;
		expect(trigger.inert).toBe(false); expect(document.body.style.overflow).toBe('');
	});

	it('disables drawer transitions for reduced motion and removes its media listener', async () => {
		preferState.animation = true;
		const media = Object.assign(new EventTarget(), { matches: true });
		const remove = vi.spyOn(media, 'removeEventListener');
		vi.spyOn(window, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList);
		await mount();
		const modal = document.querySelector('[data-testid="kpop-song-sheet"]')!.parentElement!.parentElement!;
		expect(modal.className).not.toContain('enterActive');
		app!.unmount(); app = null;
		expect(remove).toHaveBeenCalledWith('change', expect.any(Function));
	});

	it('keeps the existing drawer animation when motion is enabled', async () => {
		preferState.animation = true;
		const media = Object.assign(new EventTarget(), { matches: false });
		vi.spyOn(window, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList);
		await mount();
		const modal = document.querySelector('[data-testid="kpop-song-sheet"]')!.parentElement!.parentElement!;
		expect(modal.className).toContain('enterActive');
	});

	function visibleRects(): void {
		vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
			const details = this.closest('details');
			return (this.hidden || (details && !details.open && this.tagName !== 'SUMMARY') ? [] : [new DOMRect(0, 0, 20, 20)]) as unknown as DOMRectList;
		});
	}

	function tab(target: HTMLElement, shiftKey = false): KeyboardEvent {
		const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
		target.dispatchEvent(event);
		return event;
	}

	it('cycles Shift+Tab from the first control to the last, and Tab back to first', async () => {
		visibleRects(); await mount();
		const panel = document.querySelector('[data-testid="kpop-song-sheet"]')!;
		const first = panel.querySelector('button')!; const last = panel.querySelector('a')!;
		first.focus(); expect(tab(first, true).defaultPrevented).toBe(true); expect(document.activeElement).toBe(last);
		expect(tab(last).defaultPrevented).toBe(true); expect(document.activeElement).toBe(first);
	});

	it('recomputes dynamic retry, details and links while excluding hidden or disabled controls', async () => {
		visibleRects(); await mount();
		const panel = document.querySelector('[data-testid="kpop-song-sheet"]')!;
		const first = panel.querySelector('button')!;
		const dynamic = document.createElement('div');
		dynamic.innerHTML = '<button>Retry</button><details><summary tabindex="0">History</summary><a href="#record">Record</a></details><a href="#hidden" hidden>Hidden</a><button disabled>Disabled</button>';
		panel.append(dynamic);
		const details = dynamic.querySelector('details')!; const summary = dynamic.querySelector('summary')!; const record = dynamic.querySelector('a')!;
		first.focus(); tab(first, true); expect(document.activeElement).toBe(summary);
		details.open = true; first.focus(); tab(first, true); expect(document.activeElement).toBe(record);
		tab(record); expect(document.activeElement).toBe(first);
		dynamic.remove(); first.focus(); tab(first, true); expect(document.activeElement).toBe(panel.querySelector('a'));
	});

	it('keeps focus on the sheet if every control is temporarily unavailable', async () => {
		visibleRects(); await mount();
		const panel = document.querySelector<HTMLElement>('[data-testid="kpop-song-sheet"]')!;
		panel.querySelectorAll<HTMLElement>('button, a').forEach(el => { el.hidden = true; });
		panel.focus(); expect(tab(panel).defaultPrevented).toBe(true); expect(document.activeElement).toBe(panel);
	});
});
