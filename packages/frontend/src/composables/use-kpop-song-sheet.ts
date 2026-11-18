/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { onActivated, onDeactivated, onMounted, onUnmounted, readonly, ref, shallowReadonly, shallowRef, watch } from 'vue';
import { $i } from '@/i.js';
import { useRouter } from '@/router.js';
import { createKpopSheetHistory } from '@/utility/kpop-sheet-history.js';

type SheetRouter = ReturnType<typeof useRouter>;
type NavigationHook = NonNullable<SheetRouter['navHook']>;
const navigationGuards = new WeakMap<SheetRouter, { hook: NavigationHook; previous: SheetRouter['navHook']; guards: Set<NavigationHook> }>();

function guardNavigation(router: SheetRouter, guard: NavigationHook): () => void {
	let shared = navigationGuards.get(router);
	if (!shared) {
		const previous = router.navHook;
		const guards = new Set<NavigationHook>();
		const hook: NavigationHook = (path, flag) => {
			for (const current of [...guards].reverse()) if (current(path, flag)) return true;
			return previous?.(path, flag) ?? false;
		};
		shared = { previous, guards, hook };
		navigationGuards.set(router, shared);
		router.navHook = hook;
	}
	shared.guards.add(guard);
	return () => {
		shared.guards.delete(guard);
		if (shared.guards.size > 0) return;
		if (router.navHook === shared.hook) router.navHook = shared.previous;
		navigationGuards.delete(router);
	};
}

export function useKpopSongSheet() {
	const router = useRouter();
	const media = window.matchMedia('(max-width: 699px)');
	const isNarrow = ref(media.matches);
	const isOpen = ref(false);
	const returnFocusTo = shallowRef<HTMLElement | null>(null);
	const history = createKpopSheetHistory(window, value => { isOpen.value = value; });
	let active = false;
	let releaseNavigation: (() => void) | null = null;

	const navigationHook: NonNullable<typeof router.navHook> = (path, flag) => {
		if (history.isEngaged()) {
			history.close(() => router.pushByPath(path, flag));
			return true;
		}
		return false;
	};

	function resize(): void {
		const next = media.matches;
		if (next !== isNarrow.value) history.close();
		isNarrow.value = next;
	}

	function routeChanged(ctx: { beforeFullPath: string; fullPath: string }): void {
		if (ctx.fullPath !== ctx.beforeFullPath) history.reset();
	}

	function activate(): void {
		if (active) return;
		active = true;
		isNarrow.value = media.matches;
		media.addEventListener('change', resize);
		router.addListener('change', routeChanged);
		releaseNavigation = guardNavigation(router, navigationHook);
	}

	function deactivate(): void {
		if (!active) return;
		active = false;
		history.reset();
		media.removeEventListener('change', resize);
		router.removeListener('change', routeChanged);
		releaseNavigation?.();
		releaseNavigation = null;
		returnFocusTo.value = null;
	}

	function open(trigger?: HTMLElement | null): void {
		if (!active || !isNarrow.value) return;
		returnFocusTo.value = trigger ?? (window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null);
		history.open();
	}

	function close(): void { history.close(); }

	function reset(): void { history.close(); }

	watch(() => $i?.id, () => history.close());
	onMounted(activate);
	onActivated(activate);
	onDeactivated(deactivate);
	onUnmounted(() => { deactivate(); history.dispose(); });
	return { isNarrow: readonly(isNarrow), isOpen: readonly(isOpen), returnFocusTo: shallowReadonly(returnFocusTo), open, close, reset };
}
