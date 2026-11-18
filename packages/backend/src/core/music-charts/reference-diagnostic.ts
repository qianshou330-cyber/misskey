/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const REFERENCE_FAILURE_REASONS = ['robots_denied', 'robots_invalid', 'http_401', 'http_403', 'http_429', 'timeout', 'redirect', 'content_type', 'invalid_payload', 'http_error', 'network_error', 'response_too_large'] as const;
export type ReferenceDiagnostic = {
	phase: 'robots' | 'page' | 'parse';
	reason: typeof REFERENCE_FAILURE_REASONS[number];
	httpStatus: number | null;
	retryAfterAt: string | null;
	elapsedMs: number | null;
};

/** Only standard delta-seconds or IMF-fixdate, never an arbitrary response string. */
export function referenceRetryAfter(value: string | null, now: number): string | null {
	if (!value || value.length > 100) return null;
	const trimmed = value.trim();
	const timestamp = /^\d+$/.test(trimmed) ? now + Number(trimmed) * 1000
		: /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(trimmed) ? Date.parse(trimmed) : NaN;
	if (!Number.isSafeInteger(now) || !Number.isSafeInteger(timestamp) || timestamp <= now || timestamp > 8640000000000000 - 3600000) return null;
	if (!/^\d+$/.test(trimmed) && new Date(timestamp).toUTCString() !== trimmed) return null;
	return new Date(timestamp).toISOString();
}

export function parseReferenceDiagnostic(value: unknown): ReferenceDiagnostic | null {
	if (!value || typeof value !== 'object') return null;
	const record = value as Partial<ReferenceDiagnostic>;
	if (!['robots', 'page', 'parse'].includes(record.phase ?? '') || !REFERENCE_FAILURE_REASONS.includes(record.reason!)) return null;
	if (record.httpStatus !== null && (!Number.isInteger(record.httpStatus) || record.httpStatus! < 100 || record.httpStatus! > 599)) return null;
	if (record.elapsedMs !== null && (!Number.isSafeInteger(record.elapsedMs) || record.elapsedMs! < 0 || record.elapsedMs! > 600000)) return null;
	if (record.retryAfterAt !== null && (typeof record.retryAfterAt !== 'string' || !Number.isFinite(Date.parse(record.retryAfterAt)) || new Date(record.retryAfterAt).toISOString() !== record.retryAfterAt)) return null;
	return { phase: record.phase!, reason: record.reason!, httpStatus: record.httpStatus!, retryAfterAt: record.retryAfterAt!, elapsedMs: record.elapsedMs! };
}

export class ReferenceReadError extends Error {
	constructor(public readonly diagnostic: ReferenceDiagnostic) { super('Reference acquisition failed'); }
}

export function referenceTransportReason(error: unknown): ReferenceDiagnostic['reason'] {
	// Read fixed node-fetch classifications only, never message text from a remote source.
	const record = error as { name?: string; type?: string; code?: string } | null;
	if (record?.name === 'AbortError' || record?.type === 'request-timeout' || ['ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(record?.code ?? '')) return 'timeout';
	if (['no-redirect', 'max-redirect'].includes(record?.type ?? '')) return 'redirect';
	if (record?.type === 'max-size') return 'response_too_large';
	return 'network_error';
}
