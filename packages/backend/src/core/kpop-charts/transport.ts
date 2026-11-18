/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { genericChartAccess } from '../music-charts/provider.js';
import { KPOP_CHARTS } from './catalog.js';
import { KpopSourceError } from './types.js';
import { assertKpopBody, collectKpopChart } from './parser.js';
import { FLO_CHART_API_URL } from './parser-flo.js';
import type { HttpRequestService } from '../HttpRequestService.js';
import type { KpopChartKey, KpopSource, KpopReader, KpopDiagnostic, KpopRobotsAudit } from './types.js';

export const KPOP_TIMEOUT_MS = 10000;
export const KPOP_BODY_LIMIT = 3 * 1024 * 1024;
type HttpClient = Pick<HttpRequestService, 'send'>;
export function allowedKpopUrl(source: KpopSource, input: string): boolean {
	const definitions = Object.values(KPOP_CHARTS).filter(definition => definition.source === source);
	if (!definitions.length) return false;
	if (definitions.some(definition => input === definition.url || input === definition.robotsUrl)) return true;
	if (source === 'flo' && input === FLO_CHART_API_URL) return true;
	if (source !== 'genie') return false;
	try {
		const url = new URL(input);
		return url.origin === 'https://genie.co.kr' && url.pathname === '/chart/top200' && !url.hash && !url.username && !url.password && !url.port
			&& [...url.searchParams.keys()].length === 5 && ['ditc', 'ymd', 'hh', 'rtm', 'pg'].every(key => url.searchParams.getAll(key).length === 1)
			&& url.searchParams.get('ditc') === 'D' && url.searchParams.get('rtm') === 'Y' && /^\d{8}$/.test(url.searchParams.get('ymd') ?? '')
			&& /^(?:[01]\d|2[0-3])$/.test(url.searchParams.get('hh') ?? '') && /^[1-4]$/.test(url.searchParams.get('pg') ?? '');
	} catch { return false; }
}
export function kpopRetryAfter(value: string | null, now: number): string | null {
	if (!value || value.length > 128) return null;
	const trimmed = value.trim();
	const seconds = /^\d{1,10}$/.test(trimmed);
	if (!seconds && !/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(trimmed)) return null;
	const until = seconds ? now + Number(trimmed) * 1000 : Date.parse(trimmed);
	if (!seconds && Number.isFinite(until) && new Date(until).toUTCString() !== trimmed) return null;
	return Number.isFinite(until) && until > now && until <= 8.64e15 ? new Date(until).toISOString() : null;
}

function failure(reason: KpopDiagnostic['reason'], phase: KpopDiagnostic['phase'], started: number, status: number | null = null, retry: string | null = null): KpopSourceError {
	return new KpopSourceError({ phase, reason, httpStatus: status, retryAfterAt: retry, elapsedMs: Math.min(600000, Math.max(0, Date.now() - started)) });
}

function crawlDelay(body: string): number {
	let agents: string[] = []; let hasDirective = false; let delay = 0;
	for (const line of body.split(/\r?\n/)) {
		const match = /^([a-z-]+)\s*:\s*(.*?)\s*$/i.exec(line.replace(/#.*/, '').trim());
		if (!match) continue;
		if (match[1].toLowerCase() === 'user-agent') {
			if (hasDirective) agents = [];
			agents.push(match[2].toLowerCase()); hasDirective = false;
		} else {
			hasDirective = true;
			if (match[1].toLowerCase() === 'crawl-delay' && agents.includes('*')) {
				if (!/^\d+(?:\.\d+)?$/.test(match[2])) throw failure('robots_invalid', 'robots', Date.now());
				delay = Math.max(delay, Number(match[2]));
			}
		}
	}
	return delay;
}

/** One source session under the caller's source lock. Reuse for four Melon
 * charts; no cookies, credentials, user-agent override, retries, DB or Redis. */
export function createKpopReader(source: KpopSource, http: HttpClient) {
	const definition = Object.values(KPOP_CHARTS).find(item => item.source === source);
	if (!definition) throw failure('url_not_allowed', 'page', Date.now());
	const audit: KpopRobotsAudit[] = [];
	let requests = 0; let policy: { body: string; hash: string; checkedAt: string; delay: number } | null = null;
	let lastFinished = 0;
	const readResponse = async (url: string, phase: 'robots' | 'page') => {
		const started = Date.now();
		if (!allowedKpopUrl(source, url) || requests >= 8) throw failure('url_not_allowed', phase, started);
		requests++;
		const limit = phase === 'robots' ? 64 * 1024 : KPOP_BODY_LIMIT;
		let response: Awaited<ReturnType<HttpClient['send']>> | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let expired = false;
		const task = (async () => {
			response = await http.send(url, { method: 'GET', timeout: KPOP_TIMEOUT_MS, size: limit, redirect: 'manual', headers: { Accept: phase === 'robots' ? 'text/plain' : 'text/html,application/json' } }, { throwErrorWhenResponseNotOk: false });
			if (expired) { if (response.body instanceof Readable) response.body.destroy(); throw failure('timeout', phase, started); }
			const status = response.status;
			const retry = kpopRetryAfter(response.headers.get('retry-after'), Date.now());
			if (status !== 200) throw failure(status === 401 ? 'http_401' : status === 403 ? 'http_403' : status === 429 ? 'http_429' : status >= 300 && status < 400 ? 'redirect' : 'http_error', phase, started, status, retry);
			const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
			if (!(phase === 'robots' ? ['text/plain'] : url === FLO_CHART_API_URL ? ['application/json'] : ['text/html', 'application/xhtml+xml']).includes(type ?? '')) throw failure('content_type', phase, started, status, retry);
			const body = await response.text();
			if (Buffer.byteLength(body, 'utf8') > limit) throw failure('response_too_large', phase, started, status);
			if (phase === 'page') {
				try { assertKpopBody(body); } catch (error) { throw failure(error instanceof KpopSourceError ? error.code : 'invalid_payload', phase, started, status, retry); }
			}
			return { body, observedAt: new Date().toISOString() };
		})();
		try {
			return await Promise.race([task, new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => { expired = true; if (response?.body instanceof Readable) response.body.destroy(); reject(failure('timeout', phase, started)); }, KPOP_TIMEOUT_MS);
			})]);
		} catch (error) {
			if (error instanceof KpopSourceError) { error.robotsAudit = [...audit]; throw error; }
			const type = (error as { type?: string; name?: string })?.type;
			const reason = type === 'max-size' ? 'response_too_large' : expired || (error as Error)?.name === 'AbortError' ? 'timeout' : 'network_error';
			const result = failure(reason, phase, started, response?.status ?? null);
			result.robotsAudit = [...audit]; throw result;
		} finally {
			if (timer) clearTimeout(timer);
			if (response?.body instanceof Readable) response.body.destroy();
			lastFinished = Date.now();
		}
	};
	const read: KpopReader = async url => {
		if (!allowedKpopUrl(source, url) || url === definition.robotsUrl) throw failure('url_not_allowed', 'page', Date.now());
		try {
			if (!policy) {
				const result = await readResponse(definition.robotsUrl, 'robots');
				if (genericChartAccess(result.body, new URL(url)) === 'invalid') throw failure('robots_invalid', 'robots', Date.now(), 200);
				policy = { body: result.body, hash: createHash('sha256').update(result.body).digest('hex'), checkedAt: result.observedAt, delay: crawlDelay(result.body) };
			}
			const allowed = genericChartAccess(policy.body, new URL(url));
			audit.push({ source, url, checkedAt: policy.checkedAt, robotsHash: policy.hash, mode: 'record', allowed: allowed === 'invalid' ? null : allowed === 'allowed', crawlDelaySeconds: policy.delay, httpStatus: 200 });
			if (allowed === 'invalid') throw failure('robots_invalid', 'robots', Date.now(), 200);
			if (source === 'billboard' && allowed !== 'allowed') throw failure('robots_denied', 'robots', Date.now(), 200);
			if (!Number.isFinite(policy.delay) || policy.delay > 60) throw failure('crawl_delay', 'robots', Date.now(), 200);
			const wait = policy.delay * 1000 - (Date.now() - lastFinished);
			if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
			return await readResponse(url, 'page');
		} catch (error) {
			if (error instanceof KpopSourceError) error.robotsAudit = [...audit];
			throw error;
		}
	};
	return { read, robotsAudit: audit, get requestCount() { return requests; } };
}
export async function fetchKpopChart(key: KpopChartKey, http: HttpClient) {
	const session = createKpopReader(KPOP_CHARTS[key].source, http);
	try {
		const snapshot = await collectKpopChart(key, session.read);
		return { snapshot, robotsAudit: session.robotsAudit, requestCount: session.requestCount };
	} catch (error) {
		if (error instanceof KpopSourceError) error.robotsAudit = [...session.robotsAudit];
		throw error;
	}
}
