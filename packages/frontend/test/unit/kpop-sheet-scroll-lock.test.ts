/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, it } from 'vitest';
import { lockKpopSheetScroll } from '@/utility/kpop-sheet-scroll-lock.js';

function fixture() {
	const scroll = document.createElement('div'); scroll.style.setProperty('overflow', 'auto', 'important'); scroll.style.overscrollBehavior = 'contain'; scroll.scrollTop = 246;
	Object.defineProperties(scroll, { scrollHeight: { value: 1000 }, clientHeight: { value: 200 } });
	const modal = document.createElement('div'); const content = document.createElement('div'); const sheet = document.createElement('section');
	content.append(sheet); modal.append(content); document.body.append(scroll, modal);
	return { scroll, sheet };
}

afterEach(() => { document.body.replaceChildren(); document.body.removeAttribute('style'); document.documentElement.removeAttribute('style'); });

describe('K-pop sheet scroll locking', () => {
	it('locks document and real scroll containers, then restores styles and position', () => {
		const { scroll, sheet } = fixture(); const release = lockKpopSheetScroll(sheet);
		expect(scroll.style.overflow).toBe('hidden'); expect(document.body.style.overflow).toBe('hidden'); expect(sheet.style.overflow).toBe('');
		scroll.scrollTop = 0; release(); release();
		expect(scroll.style.overflow).toBe('auto'); expect(scroll.style.getPropertyPriority('overflow')).toBe('important'); expect(scroll.style.overscrollBehavior).toBe('contain'); expect(scroll.scrollTop).toBe(246); expect(document.body.style.overflow).toBe('');
	});
	it('keeps a shared scroll container locked until the final nested owner releases', () => {
		const { scroll, sheet } = fixture(); const first = lockKpopSheetScroll(sheet); const second = lockKpopSheetScroll(sheet);
		first(); expect(scroll.style.overflow).toBe('hidden'); second(); expect(scroll.style.overflow).toBe('auto');
	});
});
