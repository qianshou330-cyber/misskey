/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import { parseReferenceDiagnostic, referenceRetryAfter, referenceTransportReason } from '@/core/music-charts/reference-diagnostic.js';
import { packReference } from '@/core/music-charts/reference-state.js';

const now = Date.parse('2026-10-16T16:00:00.000Z');
const diagnostic = { phase: 'page', reason: 'http_429', httpStatus: 429, retryAfterAt: '2026-10-26T16:00:00.000Z', elapsedMs: 52 } as const;
describe('Safe reference diagnostics', () => {
	it('accepts future delta seconds and a canonical HTTP date, including a pause beyond seven days', () => {
		expect(referenceRetryAfter('864000', now)).toBe(diagnostic.retryAfterAt);
		expect(referenceRetryAfter('Mon, 26 Oct 2026 16:00:00 GMT', now)).toBe(diagnostic.retryAfterAt);
		expect(referenceRetryAfter('10000000000', now)).toBe(new Date(now + 10000000000000).toISOString());
	});
	it.each(['', '-1', '0', 'tomorrow', '2026-10-26T16:00:00Z', '900000000000000000000', 'Tue, 31 Feb 2026 16:00:00 GMT', 'Tue, 26 Oct 2026 16:00:00 GMT', 'x'.repeat(101)])('ignores invalid Retry-After %s', value => {
		expect(referenceRetryAfter(value, now)).toBeNull();
	});
	it('copies only allowlisted diagnostic fields', () => {
		expect(parseReferenceDiagnostic({ ...diagnostic, body: 'private remote text', headers: { cookie: 'never' } })).toEqual(diagnostic);
		expect(parseReferenceDiagnostic({ ...diagnostic, reason: 'remote arbitrary reason' })).toBeNull();
		expect(parseReferenceDiagnostic({ ...diagnostic, httpStatus: 999 })).toBeNull();
		expect(parseReferenceDiagnostic({ ...diagnostic, elapsedMs: -1 })).toBeNull();
	});
	it('does not interpret exception messages as trusted reason codes', () => {
		expect(referenceTransportReason({ message: 'http_403 private URL' })).toBe('network_error');
	});
	it('old attempts expose null diagnostics and successful attempts clear diagnostics', () => {
		const attempt = { checkedAt: now, nextAttemptAt: now + 86400000, status: 'restricted', failureCount: 1 };
		expect(packReference('melon-top100', null, JSON.stringify(attempt), new Date(now))).toMatchObject({ diagnostic: null, nextAttemptAt: new Date(attempt.nextAttemptAt).toISOString() });
		const snapshot = { chartKey: 'melon-top100', rank: 1, result: 'ranked', sourceFetchedAt: new Date(now - 1000).toISOString(), sourceTimeLabel: '01:00', lastSuccessAt: new Date(now).toISOString() };
		expect(packReference('melon-top100', JSON.stringify(snapshot), JSON.stringify({ ...attempt, status: 'available', diagnostic }), new Date(now))?.diagnostic).toBeNull();
	});
	it('retains a long failure pause after snapshot expiry without retaining its old contents', () => {
		const attempt = { checkedAt: now, nextAttemptAt: Date.parse(diagnostic.retryAfterAt), status: 'restricted', failureCount: 1, diagnostic };
		expect(packReference('melon-top100', null, JSON.stringify(attempt), new Date(now + 8 * 86400000))).toMatchObject({ diagnostic, rank: null, result: 'unknown', nextAttemptAt: diagnostic.retryAfterAt });
	});
});
