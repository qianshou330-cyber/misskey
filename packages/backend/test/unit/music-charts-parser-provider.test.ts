/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import { getGenieDailyPeriod, getGenieRealtimePeriod, parseBugsChart, parseGenieDailyChart, parseGenieRealtimeChart, parseMelonChart, parseMelonDailyChart } from '@/core/music-charts/parser.js';
import { allowsGenericChartAccess, fetchMusicChart, isHot100Eligible, MUSIC_CHARTS } from '@/core/music-charts/provider.js';

const NOW = new Date('2026-10-15T06:00:00+09:00');

// Synthetic public-chart structures, not saved sessions or scraped song lists.
function melon(options: { target?: boolean; count?: number; period?: string; hot?: string; artist?: string } = {}): string {
	const rows = Array.from({ length: options.count ?? 100 }, (_, i) => {
		const target = i === 4 && options.target !== false;
		return `<tr data-song-no="${target ? '603382333' : 1000 + i}"><td><span class="rank">${i + 1}</span></td><td><div class="ellipsis rank01"><a>${target ? 'NEON' : 'Other'}</a></div><div class="ellipsis rank02"><a>${target ? options.artist ?? 'A2O' : 'Other'}</a></div></td></tr>`;
	}).join('');
	return `<html><input id="chartType" value="${options.hot ?? 'D100'}"><span class="year">${options.period ?? '2026.10.15'}</span><span class="hour">05:00</span><table><tbody>${rows}</tbody></table></html>`;
}

function melonDaily(options: Parameters<typeof melon>[0] = {}): string {
	return melon(options).replace('<html>', '<html><title>멜론차트&gt;일간&gt;장르종합&gt;멜론</title><h2>일간</h2>').replace('<span class="hour">05:00</span>', '');
}

function bugs(target = true): string {
	const rows = Array.from({ length: 100 }, (_, i) => `<tr trackid="${i === 7 && target ? '6511885' : 2000 + i}"><td class="ranking"><strong>${i + 1}</strong></td><td><p class="title"><a>${i === 7 && target ? 'NEON' : 'Other'}</a></p><p class="artist"><a>A2O</a></p></td></tr>`).join('');
	return `<html><div class="date"><time datetime="2026.10.14 22:00">2026.10.15</time></div><div class="time">01:00</div><table class="list trackList"><tbody>${rows}</tbody></table></html>`;
}

function genie(page: 1 | 2, options: { ymd?: string; target?: boolean; count?: number; rankOffset?: number; artist?: string } = {}): string {
	const ymd = options.ymd ?? '20261013';
	const rows = Array.from({ length: options.count ?? 50 }, (_, i) => {
		const rank = (page - 1) * 50 + i + 1 + (options.rankOffset ?? 0);
		const target = rank === 1 && options.target !== false;
		return `<tr class="list" songId="${target ? '117256249' : 3000 + rank}" mvId="${target ? '264162' : 4000 + rank}"><td class="number">${rank}<span class="rank">new</span></td><td><a class="title ellipsis">${target ? 'NEON' : 'Other'}</a><a class="artist ellipsis">${target ? options.artist ?? 'A2O &amp; A2O LITE' : 'Other'}</a></td></tr>`;
	}).join('');
	return `<html><table class="list-wrap"><tbody>${rows}</tbody></table><a href="/chart/musicVideo?ditc=D&amp;pg=1&amp;ymd=${ymd}">1</a><a href="/chart/musicVideo?ditc=D&amp;pg=2&amp;ymd=${ymd}">2</a><aside class="hot-issue"><tr mvId="264162"><a>NEON</a></tr></aside></html>`;
}

function genieRealtime(page: number, options: { ymd?: string; hour?: string; targetRank?: number | null; count?: number } = {}): string {
	const ymd = options.ymd ?? '20261015';
	const hour = options.hour ?? '05';
	const targetRank = options.targetRank === undefined ? 175 : options.targetRank;
	const rows = Array.from({ length: options.count ?? 50 }, (_, i) => {
		const rank = (page - 1) * 50 + i + 1;
		const target = rank === targetRank;
		return `<tr class="list" songId="${target ? '117256249' : 5000 + rank}"><td class="number">${rank}<span class="rank">1</span></td><td><a class="title ellipsis">${target ? 'NEON' : 'Other'}</a><a class="artist ellipsis">${target ? 'A2O &amp; A2O LITE' : 'Other'}</a></td></tr>`;
	}).join('');
	const links = [1, 2, 3, 4].map(pg => `<a href="?ditc=D&amp;rtm=Y&amp;pg=${pg}&amp;ymd=${ymd}&amp;hh=${hour}">${(pg - 1) * 50 + 1} ~ ${pg * 50}</a>`).join('');
	return `<html><table class="list-wrap"><tbody>${rows}</tbody></table>${links}<aside class="hot-issue"><tr class="list" songId="117256249"><a>NEON</a></tr></aside></html>`;
}

const genieRealtimePages = (options: Parameters<typeof genieRealtime>[1] = {}) => [1, 2, 3, 4].map(page => genieRealtime(page, options));

describe('music chart parsers', () => {
	test('Melon returns the fixed work and converts the official KST hour to UTC', () => {
		expect(parseMelonChart(melon(), false, NOW)).toEqual({ period: '2026-10-14T20:00:00.000Z', rank: 5, eligible: true });
	});
	test('only complete verified absence is unranked', () => {
		expect(parseMelonChart(melon({ target: false }), false, NOW).rank).toBeNull();
		expect(() => parseMelonChart(melon({ target: false, count: 99 }), false, NOW)).toThrow('incomplete');
	});
	test.each(['D30', '', 'TOP100'])('HOT100 rejects the wrong or missing release window %s', scope => {
		expect(() => parseMelonChart(melon({ hot: scope }), true, NOW)).toThrow('D100');
	});
	test('HOT100 verifies D100 separately', () => {
		expect(parseMelonChart(melon(), true, NOW).rank).toBe(5);
	});
	test('Melon daily uses the official KST date independently of an hourly chart', () => {
		const daily = melonDaily({ period: '2026.10.14' });
		expect(parseMelonDailyChart(daily, NOW)).toEqual({ period: '2026-10-13T15:00:00.000Z', rank: 5, eligible: true });
		expect(() => parseMelonChart(daily, false, NOW)).toThrow('period');
		expect(() => parseMelonDailyChart(daily.replace('2026.10.14', ''), NOW)).toThrow('period');
		expect(() => parseMelonDailyChart(melon(), NOW)).toThrow('daily chart');
		expect(() => parseMelonDailyChart(daily.replace('<h2>일간</h2>', ''), NOW)).toThrow('daily chart');
	});
	test('Melon daily rejects incomplete absence, duplicate ranks and future dates', () => {
		expect(parseMelonDailyChart(melonDaily({ target: false }), NOW).rank).toBeNull();
		expect(() => parseMelonDailyChart(melonDaily({ target: false, count: 99 }), NOW)).toThrow('incomplete');
		expect(() => parseMelonDailyChart(melonDaily().replace('class="rank">2<', 'class="rank">1<'), NOW)).toThrow('duplicated');
		expect(() => parseMelonDailyChart(melonDaily({ period: '2026.10.16' }), NOW)).toThrow('future');
	});
	test('target title or artist changes fail instead of silently matching a name', () => {
		expect(() => parseMelonChart(melon().replace('>NEON<', '>Different<'), false, NOW)).toThrow('identity');
		expect(() => parseMelonChart(melon({ artist: 'Other Artist' }), false, NOW)).toThrow('identity');
	});
	test('same title under another work ID is not the monitored work', () => {
		expect(parseMelonChart(melon().replace('603382333', '999999999'), false, NOW).rank).toBeNull();
	});
	test('duplicate work IDs and ranks fail validation', () => {
		expect(() => parseMelonChart(melon().replace('data-song-no="1001"', 'data-song-no="1000"'), false, NOW)).toThrow('duplicated');
		expect(() => parseMelonChart(melon().replace('class="rank">2<', 'class="rank">1<'), false, NOW)).toThrow('duplicated');
	});
	test('future and invalid source dates are rejected', () => {
		expect(() => parseMelonChart(melon({ period: '2026.10.16' }), false, NOW)).toThrow('future');
		expect(() => parseMelonChart(melon({ period: '2026.02.31' }), false, NOW)).toThrow('Invalid');
	});
	test('HTTP 200 block pages and overlarge responses are not interpreted as absent', () => {
		expect(() => parseMelonChart('<html>Security verification required</html>', false, NOW)).toThrow();
		expect(() => parseBugsChart(`<html>${'a'.repeat(1024 * 1024)}</html>`, NOW)).toThrow('large');
	});
	test('Bugs uses visible date and hour, never the stale datetime attribute', () => {
		expect(parseBugsChart(bugs(), NOW)).toEqual({ period: '2026-10-14T16:00:00.000Z', rank: 8, eligible: true });
	});
	test('Bugs validates 100 rows before reporting absence', () => {
		expect(parseBugsChart(bugs(false), NOW).rank).toBeNull();
		expect(() => parseBugsChart(bugs(false).replace('trackid="2000"', 'trackid="2001"'), NOW)).toThrow('duplicated');
	});
	test('Bugs missing visible date does not fall back to datetime', () => {
		expect(() => parseBugsChart(bugs().replace('>2026.10.15<', '><'), NOW)).toThrow('period');
	});
	test('Genie validates two pages and fixed MV identity', () => {
		expect(parseGenieDailyChart(genie(1), genie(2), NOW)).toEqual({ period: '2026-10-12T15:00:00.000Z', rank: 1, eligible: true });
	});
	test('Genie ignores a matching video in HOT Issue outside the chart', () => {
		expect(parseGenieDailyChart(genie(1, { target: false }), genie(2), NOW).rank).toBeNull();
	});
	test('Genie rejects different dates, repeated pages, missing rows and bad song identity', () => {
		expect(() => parseGenieDailyChart(genie(1), genie(2, { ymd: '20261014' }), NOW)).toThrow('different');
		expect(() => parseGenieDailyChart(genie(1), genie(1), NOW)).toThrow('pagination');
		expect(() => parseGenieDailyChart(genie(1), genie(2, { count: 49 }), NOW)).toThrow('incomplete');
		expect(() => parseGenieDailyChart(genie(1).replace('117256249', '999'), genie(2), NOW)).toThrow('identity');
	});
	test('Genie requires daily, same-origin pagination', () => {
		expect(() => getGenieDailyPeriod(genie(1).replaceAll('ditc=D', 'ditc=W'), NOW)).toThrow('pagination');
		expect(() => getGenieDailyPeriod(genie(1).replaceAll('href="/chart', 'href="https://evil.example/chart'), NOW)).toThrow('pagination');
	});
	test('Genie query-only pagination resolves against the actual chart path', () => {
		const page = genie(1).replaceAll('href="/chart/musicVideo?', 'href="?');
		expect(getGenieDailyPeriod(page, NOW)).toEqual({ period: '2026-10-12T15:00:00.000Z', ymd: '20261013' });
	});
	test('Genie realtime validates all 200 songs and finds ranks beyond 100', () => {
		expect(parseGenieRealtimeChart(genieRealtimePages(), NOW)).toEqual({ period: '2026-10-14T20:00:00.000Z', rank: 175, eligible: true });
		expect(parseGenieRealtimeChart(genieRealtimePages({ targetRank: 200 }), NOW).rank).toBe(200);
	});
	test('Genie realtime requires four complete pages before reporting absence', () => {
		expect(parseGenieRealtimeChart(genieRealtimePages({ targetRank: null }), NOW).rank).toBeNull();
		expect(() => parseGenieRealtimeChart(genieRealtimePages().slice(0, 2), NOW)).toThrow('four pages');
		const pages = genieRealtimePages();
		pages[3] = genieRealtime(4, { count: 49 });
		expect(() => parseGenieRealtimeChart(pages, NOW)).toThrow('incomplete');
	});
	test('Genie realtime requires the same date and hour on every page', () => {
		for (const options of [{ ymd: '20261014' }, { hour: '04' }]) {
			const pages = genieRealtimePages();
			pages[2] = genieRealtime(3, options);
			expect(() => parseGenieRealtimeChart(pages, NOW)).toThrow('different');
		}
		expect(() => getGenieRealtimePeriod(genieRealtime(1).replace('hh=05', 'hh=04'), NOW)).toThrow('inconsistent');
	});
	test('Genie realtime rejects repeated pages and duplicate song IDs or ranks', () => {
		const repeated = genieRealtimePages();
		repeated[3] = repeated[2];
		expect(() => parseGenieRealtimeChart(repeated, NOW)).toThrow('pagination');
		const duplicateId = genieRealtimePages();
		duplicateId[3] = duplicateId[3].replace('songId="5151"', 'songId="5001"');
		expect(() => parseGenieRealtimeChart(duplicateId, NOW)).toThrow('duplicated');
		const duplicateRank = genieRealtimePages();
		duplicateRank[3] = duplicateRank[3].replace('class="number">152<', 'class="number">151<');
		expect(() => parseGenieRealtimeChart(duplicateRank, NOW)).toThrow('duplicated');
	});
	test('Genie realtime uses song identity rather than MV ID or matching title', () => {
		const pages = genieRealtimePages();
		pages[3] = pages[3].replace('songId="117256249"', 'songId="264162"');
		expect(parseGenieRealtimeChart(pages, NOW).rank).toBeNull();
		pages[3] = genieRealtime(4).replace('>NEON<', '>Other<');
		expect(() => parseGenieRealtimeChart(pages, NOW)).toThrow('identity');
		pages[3] = genieRealtime(4).replace('A2O &amp; A2O LITE', 'Unrelated');
		expect(() => parseGenieRealtimeChart(pages, NOW)).toThrow('identity');
	});
	test('Genie realtime rejects daily, MV, foreign, incomplete and future pagination', () => {
		expect(() => getGenieRealtimePeriod(genieRealtime(1).replaceAll('rtm=Y', 'rtm=N'), NOW)).toThrow('not realtime');
		expect(() => getGenieRealtimePeriod(genieRealtime(1).replaceAll('ditc=D', 'ditc=W'), NOW)).toThrow('not realtime');
		expect(() => getGenieRealtimePeriod(genie(1), NOW)).toThrow('pagination');
		expect(() => getGenieRealtimePeriod(genieRealtime(1).replaceAll('href="?', 'href="https://evil.example/chart/top200?'), NOW)).toThrow('pagination');
		expect(() => getGenieRealtimePeriod(genieRealtime(1).replace('pg=4', 'pg=3'), NOW)).toThrow('pagination');
		expect(() => getGenieRealtimePeriod(genieRealtime(1, { hour: '07' }), NOW)).toThrow('future');
		expect(() => getGenieRealtimePeriod('<html>Security verification required</html>', NOW)).toThrow('pagination');
	});
});

describe('music chart access policy and acquisition', () => {
	const target = new URL(MUSIC_CHARTS.find(chart => chart.key === 'melon-top100')!.sourceUrl);
	const allow = { status: 200, contentType: 'text/plain', body: 'User-agent: *\nDisallow:' };
	const html = (body: string) => ({ status: 200, contentType: 'text/html; charset=UTF-8', body });

	test('the five independent charts have the required order, cadence and rank limits', () => {
		expect(MUSIC_CHARTS.map(chart => [chart.key, chart.maxRank, chart.periodHours, chart.intervalMs])).toEqual([
			['melon-daily', 100, 24, 60 * 60_000],
			['melon-hot100', 100, 1, 60 * 60_000],
			['melon-top100', 100, 1, 60 * 60_000],
			['genie-realtime', 200, 1, 60 * 60_000],
			['bugs-realtime', 100, 1, 60 * 60_000],
		]);
	});

	test('generic denial is not bypassed by a search-bot exception', () => {
		expect(allowsGenericChartAccess('User-agent: *\nDisallow: /\nUser-agent: Yeti\nAllow: /chart/', target)).toBe(false);
	});
	test('longest matching rule and equal-length allow precedence are respected', () => {
		expect(allowsGenericChartAccess('User-agent: *\nDisallow: /\nAllow: /chart/\nDisallow: /chart/hot100/', target)).toBe(true);
		expect(allowsGenericChartAccess('User-agent: *\nDisallow: /chart/\nAllow: /chart/', target)).toBe(true);
		expect(allowsGenericChartAccess('User-agent: *\nAllow: /chart/\nDisallow: /chart/hot100/', new URL(MUSIC_CHARTS[1].sourceUrl))).toBe(false);
	});
	test('wildcards and end anchors use literal URL punctuation safely', () => {
		expect(allowsGenericChartAccess('User-agent: *\nDisallow: /*.htm$', target)).toBe(false);
		expect(allowsGenericChartAccess('User-agent: *\nDisallow: /chart/index.htm$', new URL(`${target.href}?test=1`))).toBe(true);
		expect(allowsGenericChartAccess('User-agent: *\nDisallow: /chart/**index.htm$', target)).toBe(false);
	});
	test('combined generic groups and comment stripping do not lose denial', () => {
		expect(allowsGenericChartAccess('User-agent: *\nAllow: /other\nUser-agent: *\nDisallow: /chart/ # comment', target)).toBe(false);
	});
	test.each(['', '<html>blocked</html>', 'Service unavailable'])('unknown robots response is fail-closed: %s', body => {
		expect(allowsGenericChartAccess(body, target)).toBe(false);
	});
	test.each(MUSIC_CHARTS)('restricted robots makes zero chart requests: $key', async chart => {
		const request = vi.fn().mockResolvedValue({ ...allow, body: 'User-agent: *\nDisallow: /' });
		await expect(fetchMusicChart(chart.key, request, NOW)).rejects.toMatchObject({ kind: 'restricted' });
		expect(request.mock.calls).toEqual([[new URL('/robots.txt', chart.sourceUrl).href]]);
	});
	test.each([401, 403, 429])('HTTP %i is restricted without repeated requests', async status => {
		const request = vi.fn().mockResolvedValue({ status, contentType: 'text/html', body: '' });
		await expect(fetchMusicChart('bugs-realtime', request, NOW)).rejects.toMatchObject({ kind: 'restricted' });
		expect(request).toHaveBeenCalledTimes(1);
	});
	test('timeout and 503 are unavailable, not unranked', async () => {
		await expect(fetchMusicChart('melon-top100', vi.fn().mockRejectedValue(new Error('timeout')), NOW)).rejects.toMatchObject({ kind: 'unavailable' });
		await expect(fetchMusicChart('melon-top100', vi.fn().mockResolvedValue({ status: 503, contentType: 'text/plain', body: '' }), NOW)).rejects.toMatchObject({ kind: 'unavailable' });
	});
	test('only permitted HTML reaches strict parsing', async () => {
		const request = vi.fn().mockResolvedValueOnce(allow).mockResolvedValueOnce(html(melon()));
		expect((await fetchMusicChart('melon-top100', request, NOW)).rank).toBe(5);
		expect(request.mock.calls[1][0]).toBe(target.href);
	});
	test('Melon daily is requested through its separate official endpoint', async () => {
		const request = vi.fn().mockResolvedValueOnce(allow).mockResolvedValueOnce(html(melonDaily({ period: '2026.10.14' })));
		expect(await fetchMusicChart('melon-daily', request, NOW)).toEqual({ period: '2026-10-13T15:00:00.000Z', rank: 5, eligible: true });
		expect(request.mock.calls[1][0]).toBe('https://www.melon.com/chart/day/index.htm');
	});
	test('recovery rechecks policy and does not retain a failed response as a chart', async () => {
		const request = vi.fn().mockResolvedValueOnce(allow).mockResolvedValueOnce(html('<html>security check</html>'));
		await expect(fetchMusicChart('melon-top100', request, NOW)).rejects.toMatchObject({ kind: 'invalid' });
		request.mockResolvedValueOnce(allow).mockResolvedValueOnce(html(melon()));
		expect((await fetchMusicChart('melon-top100', request, NOW)).rank).toBe(5);
		expect(request.mock.calls.filter(([url]) => url.endsWith('/robots.txt'))).toHaveLength(2);
	});
	test('unexpected content type and 200 security page remain invalid', async () => {
		await expect(fetchMusicChart('bugs-realtime', vi.fn().mockResolvedValueOnce(allow).mockResolvedValueOnce({ status: 200, contentType: 'application/json', body: '{}' }), NOW)).rejects.toMatchObject({ kind: 'invalid' });
		await expect(fetchMusicChart('melon-top100', vi.fn().mockResolvedValueOnce(allow).mockResolvedValueOnce(html('<html>security check</html>')), NOW)).rejects.toMatchObject({ kind: 'invalid' });
	});
	test('Genie all four audio pages are pinned to the first official date and hour', async () => {
		const request = vi.fn().mockResolvedValueOnce(allow);
		genieRealtimePages().forEach(page => request.mockResolvedValueOnce(html(page)));
		expect((await fetchMusicChart('genie-realtime', request, NOW)).rank).toBe(175);
		expect(request.mock.calls.slice(1).map(([url]) => url)).toEqual([
			'https://www.genie.co.kr/chart/top200?ditc=D&rtm=Y',
			'https://www.genie.co.kr/chart/top200?ditc=D&rtm=Y&pg=2&ymd=20261015&hh=05',
			'https://www.genie.co.kr/chart/top200?ditc=D&rtm=Y&pg=3&ymd=20261015&hh=05',
			'https://www.genie.co.kr/chart/top200?ditc=D&rtm=Y&pg=4&ymd=20261015&hh=05',
		]);
	});
	test.each([2, 3, 4])('Genie cannot use an unpermitted page %i', async blockedPage => {
		const request = vi.fn().mockResolvedValueOnce({ ...allow, body: `User-agent: *\nDisallow: /*pg=${blockedPage}*` });
		genieRealtimePages().forEach(page => request.mockResolvedValueOnce(html(page)));
		await expect(fetchMusicChart('genie-realtime', request, NOW)).rejects.toMatchObject({ kind: 'restricted' });
		expect(request).toHaveBeenCalledTimes(blockedPage);
	});
	test('Genie stops on a changed period without accepting a partial snapshot', async () => {
		const request = vi.fn().mockResolvedValueOnce(allow).mockResolvedValueOnce(html(genieRealtime(1))).mockResolvedValueOnce(html(genieRealtime(2, { hour: '04' })));
		await expect(fetchMusicChart('genie-realtime', request, NOW)).rejects.toMatchObject({ kind: 'invalid' });
		expect(request).toHaveBeenCalledTimes(3);
	});
	test('Genie missing and blocked last pages do not become unranked', async () => {
		const request = vi.fn().mockResolvedValueOnce(allow);
		genieRealtimePages({ targetRank: null }).slice(0, 3).forEach(page => request.mockResolvedValueOnce(html(page)));
		request.mockResolvedValueOnce(html('<html>Security verification required</html>'));
		await expect(fetchMusicChart('genie-realtime', request, NOW)).rejects.toMatchObject({ kind: 'invalid' });
	});
	test('HOT100 expiry is evaluated at the KST boundary without fetching', async () => {
		expect(isHot100Eligible(new Date('2027-01-20T23:59:59+09:00'))).toBe(true);
		const request = vi.fn();
		await expect(fetchMusicChart('melon-hot100', request, new Date('2027-01-21T00:00:00+09:00'))).rejects.toMatchObject({ kind: 'out_of_scope' });
		expect(request).not.toHaveBeenCalled();
	});
});
