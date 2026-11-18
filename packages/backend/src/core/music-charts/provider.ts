/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Buffer } from 'node:buffer';
import { getGenieRealtimePeriod, parseBugsChart, parseGenieRealtimeChart, parseMelonChart, parseMelonDailyChart } from './parser.js';
import { MUSIC_CHARTS, MusicChartSourceError } from './types.js';
import type { MusicChartKey, MusicChartSnapshot } from './types.js';

export { MUSIC_CHARTS, MusicChartSourceError } from './types.js';
export type { MusicChartKey, MusicChartSnapshot } from './types.js';

export type MusicChartRequest = (url: string) => Promise<{ status: number; contentType: string | null; body: string }>;

function matchesRobotsPath(pattern: string, path: string): boolean {
	const anchored = pattern.endsWith('$');
	const parts = (anchored ? pattern.slice(0, -1) : pattern).split('*');
	if (!path.startsWith(parts[0])) return false;
	let cursor = parts[0].length;
	for (let i = 1; i < parts.length; i++) {
		const part = parts[i];
		if (anchored && i === parts.length - 1) return path.endsWith(part) && path.length - part.length >= cursor;
		const index = path.indexOf(part, cursor);
		if (index === -1) return false;
		cursor = index + part.length;
	}
	return !anchored || cursor === path.length;
}

/** An intentionally conservative generic-agent policy: no search-bot identity. */
export function genericChartAccess(robots: string, target: URL): 'allowed' | 'denied' | 'invalid' {
	if (Buffer.byteLength(robots, 'utf8') > 64 * 1024 || /<\/?(?:html|body|script)\b/i.test(robots)) return 'invalid';
	const groups: { agents: string[]; rules: { allow: boolean; pattern: string }[] }[] = [];
	let group: typeof groups[number] | undefined;
	let sawRules = false;
	let sawAgent = false;
	for (const rawLine of robots.split(/\r?\n/)) {
		const line = rawLine.replace(/#.*$/, '').trim();
		const match = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
		if (!match) continue;
		const [, directive, rawValue] = match;
		const value = rawValue.trim();
		if (directive.toLowerCase() === 'user-agent') {
			if (!value) continue;
			sawAgent = true;
			if (!group || sawRules) {
				group = { agents: [], rules: [] };
				groups.push(group);
			}
			group.agents.push(value.toLowerCase());
			sawRules = false;
		} else if (group && ['allow', 'disallow'].includes(directive.toLowerCase())) {
			sawRules = true;
			if (value.startsWith('/')) group.rules.push({ allow: directive.toLowerCase() === 'allow', pattern: value });
		}
	}
	// An unknown/error response must not silently grant access.
	if (!sawAgent) return 'invalid';
	const path = target.pathname + target.search;
	// Literal segments avoid executing source-controlled regular expressions or
	// allowing repeated wildcard patterns to cause regex backtracking.
	const matches = groups.filter(candidate => candidate.agents.includes('*')).flatMap(candidate => candidate.rules).filter(rule => matchesRobotsPath(rule.pattern, path));
	if (matches.length === 0) return 'allowed';
	const longest = Math.max(...matches.map(rule => rule.pattern.replace(/\*/g, '').length));
	return matches.some(rule => rule.allow && rule.pattern.replace(/\*/g, '').length === longest) ? 'allowed' : 'denied';
}

export function allowsGenericChartAccess(robots: string, target: URL): boolean {
	return genericChartAccess(robots, target) === 'allowed';
}

export function isHot100Eligible(now = new Date()): boolean {
	// October 13 is release day 1. D100 ends after January 20 in Korea.
	return now.getTime() < Date.parse('2027-01-21T00:00:00+09:00');
}

async function read(request: MusicChartRequest, url: string, robots = false): Promise<string> {
	let response: Awaited<ReturnType<MusicChartRequest>>;
	try {
		response = await request(url);
	} catch {
		throw new MusicChartSourceError('unavailable', 'Source request failed');
	}
	if ([401, 403, 429].includes(response.status)) throw new MusicChartSourceError('restricted', 'Source access is restricted');
	if (response.status !== 200) throw new MusicChartSourceError('unavailable', 'Source response is unavailable');
	if (Buffer.byteLength(response.body, 'utf8') > (robots ? 64 * 1024 : 1024 * 1024)) throw new MusicChartSourceError('invalid', 'Source response is too large');
	const contentType = response.contentType?.split(';')[0].trim().toLowerCase();
	if (robots ? contentType !== 'text/plain' : !['text/html', 'application/xhtml+xml'].includes(contentType ?? '')) {
		throw new MusicChartSourceError('invalid', 'Unexpected source response type');
	}
	return response.body;
}

export async function fetchMusicChart(key: MusicChartKey, request: MusicChartRequest, now = new Date()): Promise<MusicChartSnapshot> {
	const chart = MUSIC_CHARTS.find(candidate => candidate.key === key);
	if (!chart) throw new MusicChartSourceError('invalid', 'Unknown chart');
	if (key === 'melon-hot100' && !isHot100Eligible(now)) {
		// Eligibility is a local rule, not an observed official chart period.
		// The caller may update eligibility, but must not create a chart sample.
		throw new MusicChartSourceError('out_of_scope', 'Work is outside the HOT100 release window');
	}
	const url = new URL(chart.sourceUrl);
	const robots = await read(request, new URL('/robots.txt', url.origin).href, true);
	if (!allowsGenericChartAccess(robots, url)) throw new MusicChartSourceError('restricted', 'Source robots policy restricts chart collection');
	const first = await read(request, url.href);
	try {
		if (key === 'melon-daily') return parseMelonDailyChart(first, now);
		if (key === 'melon-top100' || key === 'melon-hot100') return parseMelonChart(first, key === 'melon-hot100', now);
		if (key === 'bugs-realtime') return parseBugsChart(first, now);
		const { ymd, hour, period } = getGenieRealtimePeriod(first, now);
		const pages = [first];
		// Build fixed-origin pages pinned to the first official date and hour.
		// Every page requires its own policy check; no MV or search fallback.
		for (let page = 2; page <= 4; page++) {
			const pageUrl = new URL(chart.sourceUrl);
			pageUrl.searchParams.set('pg', String(page));
			pageUrl.searchParams.set('ymd', ymd);
			pageUrl.searchParams.set('hh', hour);
			if (!allowsGenericChartAccess(robots, pageUrl)) throw new MusicChartSourceError('restricted', 'Source robots policy restricts chart pagination');
			const html = await read(request, pageUrl.href);
			if (getGenieRealtimePeriod(html, now).period !== period) throw new MusicChartSourceError('invalid', 'Realtime pages belong to different chart periods');
			pages.push(html);
		}
		return parseGenieRealtimeChart(pages, now);
	} catch (error) {
		if (error instanceof MusicChartSourceError) throw error;
		throw new MusicChartSourceError('invalid', 'Source chart could not be validated');
	}
}
