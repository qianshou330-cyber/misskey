/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import { planKpopListMotion } from '@/utility/kpop-list-motion.js';

const first = [{ songId: 'first', rank: 1 }, { songId: 'second', rank: 7 }];

describe('K-pop real rank change planning', () => {
	it('never animates an initial snapshot or an identical cache response', () => {
		expect(planKpopListMotion(null, first).changed).toBe(false);
		expect(planKpopListMotion(first, first.map(row => ({ ...row }))).changed).toBe(false);
	});

	it('preserves song identity when real ranks swap without inventing intermediate numbers', () => {
		const result = planKpopListMotion(first, [{ songId: 'second', rank: 1 }, { songId: 'first', rank: 7 }]);
		expect(result.changed).toBe(true);
		expect([...result.rankChanges]).toEqual([['second', { from: 7, to: 1 }], ['first', { from: 1, to: 7 }]]);
		expect([...result.changedIds]).toEqual(['second', 'first']);
		expect(first).toEqual([{ songId: 'first', rank: 1 }, { songId: 'second', rank: 7 }]);
	});

	it('animates an actual rank change even if display order remains the same', () => {
		const result = planKpopListMotion(first, [{ songId: 'first', rank: 1 }, { songId: 'second', rank: 8 }]);
		expect([...result.rankChanges]).toEqual([['second', { from: 7, to: 8 }]]);
		expect([...result.changedIds]).toEqual(['second']);
	});

	it('supports top-two entry and exit without a fabricated previous rank for a new song', () => {
		const result = planKpopListMotion(first, [{ songId: 'new', rank: 1 }, { songId: 'first', rank: 2 }]);
		expect(result.changed).toBe(true);
		expect([...result.changedIds]).toEqual(['new', 'first']);
		expect(result.rankChanges.has('new')).toBe(false);
		expect(planKpopListMotion(first, first.slice(0, 1)).changed).toBe(true);
	});

	it.each([
		{ next: [{ songId: 'first', rank: 1 }, { songId: 'first', rank: 2 }] },
		{ next: [{ songId: '', rank: 1 }] }, { next: [{ songId: 'first', rank: 0 }] }, { next: [{ songId: 'first', rank: 1.5 }] },
	])('suppresses ambiguous or invalid input rather than displaying invented transitions', ({ next }) => {
		expect(planKpopListMotion(first, next).changed).toBe(false);
		expect(planKpopListMotion(next, first).changed).toBe(false);
	});
});
