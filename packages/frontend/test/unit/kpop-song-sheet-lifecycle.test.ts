/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, KeepAlive, nextTick, ref } from 'vue';
import type { App } from 'vue';
import { useKpopSongSheet } from '@/composables/use-kpop-song-sheet.js';
import { $i } from '@/i.js';
import { useRouter } from '@/router.js';

vi.mock('@/i.js', async () => ({ $i: (await import('vue')).reactive({ id: 'synthetic-account-a' }) }));
vi.mock('@/router.js', async () => {
	const { EventEmitter } = await import('eventemitter3');
	const router = Object.assign(new EventEmitter(), {
		navHook: null as ((path: string) => boolean) | null,
		pushByPath: vi.fn((path: string) => {
			if (router.navHook?.(path)) return;
			const beforeFullPath = window.location.pathname;
			router.emit('change', { beforeFullPath, fullPath: path });
			window.history.pushState({}, '', path);
		}),
	});
	return { useRouter: () => router };
});

describe('mobile song sheet lifecycle', () => {
	let app: App | null = null;
	let narrow = true;
	let media: MediaQueryList;
	let result: ReturnType<typeof useKpopSongSheet>;
	const router = useRouter();

	beforeEach(() => {
		vi.useFakeTimers(); narrow = true;
		const target = new EventTarget();
		media = Object.assign(target, { get matches() { return narrow; } }) as MediaQueryList;
		Object.defineProperty(media, 'matches', { get: () => narrow });
		vi.spyOn(window, 'matchMedia').mockReturnValue(media);
		vi.spyOn(window.history, 'back').mockImplementation(() => {});
		window.history.replaceState({}, '', '/music-charts/kpop');
	});
	afterEach(() => { app?.unmount(); app = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

	function mount(): void {
		app = createApp({ setup() { result = useKpopSongSheet(); return () => h('div'); } });
		app.mount(document.createElement('div'));
	}

	function completeBack(): void {
		window.history.replaceState({}, '', '/music-charts/kpop');
		window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
	}

	it('opens only at narrow width and closes on crossing 699/700', () => {
		mount(); result.open(); expect(result.isOpen.value).toBe(true);
		narrow = false; media.dispatchEvent(new Event('change'));
		expect(result.isNarrow.value).toBe(false); expect(result.isOpen.value).toBe(false);
		completeBack(); result.open(); expect(result.isOpen.value).toBe(false);
	});

	it('defers a route push until the sheet back traversal finishes', async () => {
		mount(); result.open(); router.pushByPath('/about');
		expect(result.isOpen.value).toBe(false); expect(window.location.pathname).toBe('/music-charts/kpop');
		completeBack(); await Promise.resolve(); expect(window.location.pathname).toBe('/about');
	});

	it('closes on account change and cancels queued reopen on route reset', async () => {
		mount(); result.open(); $i!.id = 'synthetic-account-b'; await nextTick();
		expect(result.isOpen.value).toBe(false);
		result.open(); router.emit('change', { beforeFullPath: '/music-charts/kpop', fullPath: '/about' } as never);
		completeBack(); await Promise.resolve(); expect(result.isOpen.value).toBe(false);
	});

	it('removes listeners and restores a pre-existing router hook on deactivation', async () => {
		const originalHook = vi.fn(() => false); router.navHook = originalHook;
		const visible = ref(true);
		const View = defineComponent({ setup() { result = useKpopSongSheet(); return () => h('div'); } });
		app = createApp({ render: () => h(KeepAlive, () => visible.value ? h(View) : null) });
		app.mount(document.createElement('div')); result.open();
		visible.value = false; await nextTick(); expect(result.isOpen.value).toBe(false); expect(router.navHook).toBe(originalHook);
		narrow = false; media.dispatchEvent(new Event('change')); expect(result.isNarrow.value).toBe(true);
		visible.value = true; await nextTick(); expect(result.isNarrow.value).toBe(false);
		app.unmount(); app = null; expect(router.navHook).toBe(originalHook); router.navHook = null;
	});
});
