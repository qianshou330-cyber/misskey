/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import type { Ref, ShallowRef } from 'vue';
import type { KpopMotionRow, KpopRankChange } from '@/utility/kpop-list-motion.js';
import { prefer } from '@/preferences.js';
import { planKpopListMotion } from '@/utility/kpop-list-motion.js';

type Options = {
	context: () => string;
	rows: () => readonly KpopMotionRow[];
	ready: () => boolean;
	root: () => HTMLElement | null;
};

/** Component-local motion only; this never changes cached data, focus selection or polling. */
export function useKpopListMotion(options: Options): { animate: Ref<boolean>; changedIds: ShallowRef<ReadonlySet<string>>; beforeLeave: (element: Element) => void; restoreLeaving: (element: Element) => void } {
	const animate = ref(false);
	const changedIds = shallowRef<ReadonlySet<string>>(new Set());
	const media = window.matchMedia('(prefers-reduced-motion: reduce)');
	let active = false;
	let baseline: { context: string; rows: KpopMotionRow[] } | null = null;
	let generation = 0;
	let hintTimer: number | null = null;
	const effects = new Set<() => void>();
	const leaving = new Map<HTMLElement, { css: string; hidden: string | null; inert: boolean }>();

	function permitted(): boolean {
		return active && window.document.visibilityState === 'visible' && prefer.s.animation && !media.matches;
	}

	function stopEffects(): void {
		generation++;
		animate.value = false;
		changedIds.value = new Set();
		if (hintTimer !== null) window.clearTimeout(hintTimer);
		hintTimer = null;
		for (const finish of [...effects]) finish();
		// Older browsers can lack Element.getAnimations even when the DOM types include it.
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
		for (const animation of options.root()?.getAnimations?.({ subtree: true }) ?? []) animation.cancel();
	}

	function reset(): void { stopEffects(); baseline = null; }

	function visible(element: HTMLElement): boolean {
		const rect = element.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
	}

	function rankEffect(row: HTMLElement, change: KpopRankChange): void {
		const rank = row.querySelector<HTMLElement>('[data-kpop-rank]');
		const value = rank?.querySelector<HTMLElement>('[data-kpop-rank-value]');
		if (!rank || !value || typeof value.animate !== 'function' || !visible(row)) return;
		const previous = window.document.createElement('span');
		previous.textContent = String(change.from);
		previous.dataset.kpopRankPrevious = '';
		previous.setAttribute('aria-hidden', 'true');
		previous.inert = true;
		Object.assign(previous.style, { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center', pointerEvents: 'none' });
		rank.append(previous);
		const direction = change.to < change.from ? -1 : 1;
		const animations: Animation[] = [];
		let timer: number | null = null;
		const finish = (): void => {
			if (timer !== null) window.clearTimeout(timer);
			timer = null;
			for (const animation of animations) animation.cancel();
			previous.remove();
			effects.delete(finish);
		};
		effects.add(finish);
		try {
			const timing = { duration: 200, easing: 'cubic-bezier(0, .5, .5, 1)' };
			animations.push(value.animate([{ opacity: 0, transform: `translateY(${-direction * 6}px)` }, { opacity: 1, transform: 'translateY(0)' }], timing));
			animations.push(previous.animate([{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: `translateY(${direction * 6}px)` }], timing));
			timer = window.setTimeout(finish, 250);
			void Promise.all(animations.map(animation => animation.finished)).then(finish, finish);
		} catch { finish(); }
	}

	function restoreLeaving(element: Element): void {
		const el = element as HTMLElement;
		const saved = leaving.get(el);
		if (!saved) return;
		el.style.cssText = saved.css;
		el.inert = saved.inert;
		if (saved.hidden === null) el.removeAttribute('aria-hidden');
		else el.setAttribute('aria-hidden', saved.hidden);
		leaving.delete(el);
	}

	function hintEffect(row: HTMLElement): void {
		if (typeof row.animate !== 'function' || !visible(row)) return;
		const hint = window.document.createElement('span');
		hint.dataset.kpopHint = '';
		hint.setAttribute('aria-hidden', 'true');
		hint.inert = true;
		Object.assign(hint.style, { position: 'absolute', inset: '0', pointerEvents: 'none', borderRadius: 'inherit', background: 'var(--MI_THEME-accentedBg)', opacity: '0' });
		row.append(hint);
		let animation: Animation | null = null;
		let timer: number | null = null;
		const finish = (): void => {
			if (timer !== null) window.clearTimeout(timer);
			timer = null;
			animation?.cancel();
			hint.remove();
			effects.delete(finish);
		};
		effects.add(finish);
		try {
			animation = hint.animate([{ opacity: 0 }, { opacity: 0.7, offset: 0.2 }, { opacity: 0 }], { duration: 600, easing: 'ease-out' });
			timer = window.setTimeout(finish, 650);
			void animation.finished.then(finish, finish);
		} catch { finish(); }
	}

	function beforeLeave(element: Element): void {
		const el = element as HTMLElement;
		const root = options.root();
		leaving.set(el, { css: el.style.cssText, hidden: el.getAttribute('aria-hidden'), inert: el.inert });
		if (el.contains(window.document.activeElement)) root?.focus({ preventScroll: true });
		el.inert = true;
		el.setAttribute('aria-hidden', 'true');
		if (!animate.value || !root) return;
		// Removing a row from layout lets retained songs move without growing the compact card.
		const rect = el.getBoundingClientRect();
		const parent = root.getBoundingClientRect();
		Object.assign(el.style, { top: `${rect.top - parent.top + root.scrollTop}px`, left: `${rect.left - parent.left + root.scrollLeft}px`, width: `${rect.width}px`, height: `${rect.height}px` });
	}

	watch(() => [options.context(), options.rows(), options.ready()] as const, ([context, rows, ready]) => {
		const root = options.root();
		const focused = window.document.activeElement instanceof HTMLElement && root?.contains(window.document.activeElement) ? window.document.activeElement : null;
		stopEffects();
		const next = rows.map(row => ({ songId: row.songId, rank: row.rank }));
		const plan = planKpopListMotion(ready && baseline?.context === context && permitted() && root && visible(root) ? baseline.rows : null, next);
		baseline = ready ? { context, rows: next } : null;
		animate.value = plan.changed;
		changedIds.value = plan.changedIds;
		const current = generation;
		void nextTick(() => {
			if (current !== generation || !active) return;
			// A moved focused DOM node can lose focus. Never steal it back from a user's new target.
			if (focused?.isConnected && options.root()?.contains(focused) && !focused.closest('[inert]') && (window.document.activeElement === window.document.body || window.document.activeElement === focused)) focused.focus({ preventScroll: true });
			if (!plan.changed || !permitted()) return;
			for (const row of options.root()?.querySelectorAll<HTMLElement>('[data-song]') ?? []) {
				const songId = row.dataset.song;
				if (!songId) continue;
				const change = plan.rankChanges.get(songId);
				if (change && !row.inert) rankEffect(row, change);
				if (plan.changedIds.has(songId) && !row.inert) hintEffect(row);
			}
			hintTimer = window.setTimeout(() => { animate.value = false; changedIds.value = new Set(); hintTimer = null; }, 650);
		});
	}, { immediate: true, flush: 'pre' });

	watch(() => prefer.s.animation, reset, { flush: 'sync' });
	const visibilityChanged = (): void => { reset(); };
	const preferenceChanged = (): void => { reset(); };
	const activate = (): void => { if (!active) { active = true; reset(); } };
	const deactivate = (): void => { active = false; reset(); };
	onMounted(() => {
		active = true;
		window.document.addEventListener('visibilitychange', visibilityChanged);
		media.addEventListener('change', preferenceChanged);
	});
	onActivated(activate);
	onDeactivated(deactivate);
	onUnmounted(() => {
		deactivate();
		window.document.removeEventListener('visibilitychange', visibilityChanged);
		media.removeEventListener('change', preferenceChanged);
		for (const el of [...leaving.keys()]) restoreLeaving(el);
	});
	return { animate, changedIds, beforeLeave, restoreLeaving };
}
