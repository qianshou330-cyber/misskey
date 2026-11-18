/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

type SavedLock = {
	count: number;
	styles: { property: string; value: string; priority: string }[];
	top: number;
	left: number;
};
const locks = new WeakMap<HTMLElement, SavedLock>();
const lockProperties = ['overflow', 'overflow-x', 'overflow-y', 'overscroll-behavior', 'overscroll-behavior-x', 'overscroll-behavior-y'];

/** Lock the actual page scroll containers as well as the document, including Deck. */
export function lockKpopSheetScroll(sheet: HTMLElement): () => void {
	const doc = sheet.ownerDocument;
	const view = doc.defaultView!;
	const modal = sheet.parentElement?.parentElement ?? sheet;
	const candidates = [doc.documentElement, doc.body, ...doc.querySelectorAll<HTMLElement>('*')];
	const elements = [...new Set(candidates)].filter(el => {
		if (modal.contains(el)) return false;
		if (el === doc.body || el === doc.documentElement || locks.has(el)) return true;
		const style = view.getComputedStyle(el);
		return /(auto|scroll)/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`) && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth);
	});
	for (const el of elements) {
		const old = locks.get(el);
		if (old) { old.count++; continue; }
		locks.set(el, {
			count: 1,
			styles: lockProperties.map(property => ({ property, value: el.style.getPropertyValue(property), priority: el.style.getPropertyPriority(property) })),
			top: el.scrollTop, left: el.scrollLeft,
		});
		el.style.setProperty('overflow', 'hidden', 'important');
		el.style.setProperty('overscroll-behavior', 'none', 'important');
	}
	let released = false;
	return () => {
		if (released) return;
		released = true;
		for (const el of elements) {
			const saved = locks.get(el);
			if (!saved || --saved.count > 0) continue;
			locks.delete(el);
			for (const property of lockProperties) el.style.removeProperty(property);
			for (const { property, value, priority } of saved.styles) if (value) el.style.setProperty(property, value, priority);
			el.scrollTop = saved.top;
			el.scrollLeft = saved.left;
		}
	};
}
