/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allowedKpopUrl, createKpopReader, kpopRetryAfter, KPOP_BODY_LIMIT } from '../../src/core/kpop-charts/transport.js';
import { KPOP_CHARTS } from '../../src/core/kpop-charts/catalog.js';
import type { HttpRequestService } from '../../src/core/HttpRequestService.js';

const now = new Date('2026-10-17T14:30:00.000Z');
const url = KPOP_CHARTS['melon-top100'].url;

function response(body = '<title>Chart</title>', type = 'text/html', status = 200, retry: string | null = null) {
	return { status, headers: { get: (name: string) => name === 'retry-after' ? retry : name === 'content-type' ? type : null }, text: async () => body, body: Readable.from([body]) };
}

function harness(page = response(), robots = 'User-agent: *\nAllow: /') {
	const robotsResponse = response(robots, 'text/plain');
	const send = vi.fn(async (input: string, ..._options: unknown[]) => input.endsWith('/robots.txt') ? robotsResponse : page);
	return { send, page, robotsResponse, session: createKpopReader('melon', { send } as unknown as HttpRequestService) };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('bounded official source transport without sessions or identity changes', () => {
	it('permits only fixed URLs and bounded Genie pagination', async () => {
		const { session, send } = harness();
		for (const input of ['http://www.melon.com/chart/index.htm', `${url}#other`, 'https://attacker.example/', KPOP_CHARTS['melon-top100'].robotsUrl]) {
			await expect(session.read(input)).rejects.toMatchObject({ code: 'url_not_allowed' });
		}
		expect(send).not.toHaveBeenCalled();
		expect(allowedKpopUrl('genie', 'https://genie.co.kr/chart/top200?ditc=D&ymd=20261017&hh=23&rtm=Y&pg=4')).toBe(true);
		expect(allowedKpopUrl('genie', 'https://genie.co.kr/chart/top200?ditc=D&ymd=20261017&hh=23&rtm=Y&pg=5')).toBe(false);
	});
	it('records generic robots denial and preserves the existing HTTP identity', async () => {
		const { session, send, page, robotsResponse } = harness(response(), 'User-agent: *\nDisallow: /');
		await session.read(url);
		expect(session.robotsAudit).toEqual([expect.objectContaining({ source: 'melon', mode: 'record', allowed: false, httpStatus: 200 })]);
		expect(session.robotsAudit[0].robotsHash).toMatch(/^[a-f0-9]{64}$/);
		expect(send).toHaveBeenCalledTimes(2);
		expect(send.mock.calls[1][1]).toEqual({ method: 'GET', timeout: 10000, size: KPOP_BODY_LIMIT, redirect: 'manual', headers: { Accept: 'text/html,application/json' } });
		expect(page.body.destroyed && robotsResponse.body.destroyed).toBe(true);
	});
	it('Billboard reads only the fixed public chart and enforces robots denial before any page request', async () => {
		const chart = KPOP_CHARTS['billboard-korea-global-k-songs'];
		for (const input of ['https://billboard.co.kr/api/charts/', 'https://www.billboard.com/charts/billboard-korea-global-k-songs/', `${chart.url}?week=2026-10-31`, `${chart.url}#other`]) {
			expect(allowedKpopUrl('billboard', input)).toBe(false);
		}
		const send = vi.fn(async () => response('User-agent: *\nDisallow: /charts/', 'text/plain'));
		const session = createKpopReader('billboard', { send } as unknown as HttpRequestService);
		await expect(session.read(chart.url)).rejects.toMatchObject({ code: 'robots_denied', diagnostic: { phase: 'robots', httpStatus: 200 }, robotsAudit: [expect.objectContaining({ source: 'billboard', allowed: false })] });
		expect(send).toHaveBeenCalledTimes(1);
	});
	it('Billboard honors the public path allowlist without probing API endpoints or modifying request identity', async () => {
		const chart = KPOP_CHARTS['billboard-korea-global-k-songs'];
		const robots = 'User-agent: *\nDisallow: /api/\nDisallow: /admin/\n\nUser-agent: GPTBot\nDisallow: /';
		const send = vi.fn(async (input: string, ..._options: unknown[]) => input === chart.robotsUrl ? response(robots, 'text/plain') : response());
		const session = createKpopReader('billboard', { send } as unknown as HttpRequestService);
		await session.read(chart.url);
		expect(send.mock.calls.map(call => call[0])).toEqual([chart.robotsUrl, chart.url]);
		expect(send.mock.calls[1][1]).toEqual({ method: 'GET', timeout: 10000, size: KPOP_BODY_LIMIT, redirect: 'manual', headers: { Accept: 'text/html,application/json' } });
		expect(session.robotsAudit[0].allowed).toBe(true);
	});
	it('a Billboard access failure does not block the independent existing source session', async () => {
		const send = vi.fn(async () => response('User-agent: *\nDisallow: /', 'text/plain'));
		const restricted = createKpopReader('billboard', { send } as unknown as HttpRequestService);
		await expect(restricted.read(KPOP_CHARTS['billboard-korea-global-k-songs'].url)).rejects.toMatchObject({ code: 'robots_denied' });
		const other = harness();
		await expect(other.session.read(url)).resolves.toMatchObject({ body: '<title>Chart</title>' });
		expect(other.send).toHaveBeenCalledTimes(2);
	});
	it.each([[401, 'http_401'], [403, 'http_403'], [429, 'http_429'], [302, 'redirect'], [503, 'http_error']])('stops after HTTP %s without following or retrying', async (status, code) => {
		const { session, send, page } = harness(response('source text never in diagnostic', 'text/html', status as number, '3600'));
		await expect(session.read(url)).rejects.toMatchObject({ code, diagnostic: { phase: 'page', httpStatus: status, retryAfterAt: '2026-10-17T15:30:00.000Z' } });
		expect(send).toHaveBeenCalledTimes(2);
		expect(page.body.destroyed).toBe(true);
	});
	it.each(['Verify you are human', 'Login to continue', '登录'])('retains HTTP 200 and page phase on a challenge: %s', async title => {
		const { session, page } = harness(response(`<title>${title}</title>`));
		await expect(session.read(url)).rejects.toMatchObject({ code: 'access_challenge', diagnostic: { phase: 'page', httpStatus: 200 } });
		expect(page.body.destroyed).toBe(true);
	});
	it('rejects an oversized body and unexpected MIME, releasing responses', async () => {
		for (const [page, code] of [[response('x'.repeat(KPOP_BODY_LIMIT + 1)), 'response_too_large'], [response('{}', 'application/json'), 'content_type']] as const) {
			await expect(harness(page).session.read(url)).rejects.toMatchObject({ code });
			expect(page.body.destroyed).toBe(true);
		}
	});
	it('bounds a stalled response body to ten seconds', async () => {
		const { session, page } = harness();
		page.text = () => new Promise<string>(() => {});
		const result = session.read(url).catch(error => error);
		await vi.advanceTimersByTimeAsync(10000);
		expect(await result).toMatchObject({ code: 'timeout' });
		expect(page.body.destroyed).toBe(true);
	});
	it('releases a late response arriving after timeout', async () => {
		let complete: (value: ReturnType<typeof response>) => void = () => {};
		const late = response('User-agent: *\nAllow: /', 'text/plain');
		const send = vi.fn(() => new Promise<ReturnType<typeof response>>(resolve => { complete = resolve; }));
		const session = createKpopReader('melon', { send } as unknown as HttpRequestService);
		const result = session.read(url).catch(error => error);
		await vi.advanceTimersByTimeAsync(10000);
		expect(await result).toMatchObject({ code: 'timeout' });
		complete(late);
		await vi.advanceTimersByTimeAsync(0);
		expect(late.body.destroyed).toBe(true);
		expect(send).toHaveBeenCalledTimes(1);
	});
	it('uses one robots read and honors crawl delay across chart requests', async () => {
		const { session, send } = harness(response(), 'User-agent: *\nAllow: /\nCrawl-delay: 10');
		const first = session.read(url);
		await vi.advanceTimersByTimeAsync(9999);
		expect(send).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1); await first;
		const second = session.read(KPOP_CHARTS['melon-daily'].url);
		await vi.advanceTimersByTimeAsync(9999);
		expect(send).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(1); await second;
		expect(send).toHaveBeenCalledTimes(3);
	});
	it('does not read pages when robots are invalid or require an excessive delay', async () => {
		for (const [robots, code] of [['<html>challenge</html>', 'robots_invalid'], ['User-agent: *\nCrawl-delay: 61', 'crawl_delay'], ['User-agent: *\nCrawl-delay: nope', 'robots_invalid']]) {
			const { session, send } = harness(response(), robots);
			await expect(session.read(url)).rejects.toMatchObject({ code });
			expect(send).toHaveBeenCalledTimes(1);
		}
	});
	it('accepts only bounded seconds or a valid HTTP date for Retry-After', () => {
		expect(kpopRetryAfter('3600', now.getTime())).toBe('2026-10-17T15:30:00.000Z');
		expect(kpopRetryAfter('Sat, 17 Oct 2026 15:30:00 GMT', now.getTime())).toBe('2026-10-17T15:30:00.000Z');
		for (const value of ['2027-01', 'tomorrow', '2027-01-01T00:00:00Z', 'Sun, 17 Oct 2026 15:30:00 GMT', '1'.repeat(129), '-1', '1.5']) expect(kpopRetryAfter(value, now.getTime())).toBeNull();
	});
});
