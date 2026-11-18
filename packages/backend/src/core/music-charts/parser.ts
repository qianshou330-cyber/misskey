/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Buffer } from 'node:buffer';
import { parse } from 'node-html-parser';
import { MusicChartSourceError } from './types.js';
import type { HTMLElement } from 'node-html-parser';
import type { MusicChartSnapshot } from './types.js';

const MAX_HTML_BYTES = 1024 * 1024;
const KST_OFFSET = 9 * 60 * 60_000;
const NEON_TITLE = 'NEON';
const EXPECTED_IDS = { melon: '603382333', bugs: '6511885', genieMv: '264162', genieSong: '117256249' } as const;

function invalid(message: string): never {
	throw new MusicChartSourceError('invalid', message);
}

function document(html: string): HTMLElement {
	if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) invalid('Chart response is too large');
	if (!/<(?:html|table|div)\b/i.test(html)) invalid('Chart response is not HTML');
	return parse(html);
}

function normalized(value: string): string {
	return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function periodFromKst(date: string, hour: string, now: Date): string {
	const parts = /^(\d{4})[.\-/]?(\d{2})[.\-/]?(\d{2})$/.exec(date.replace(/\s+/g, ''));
	if (!parts || !/^\d{1,2}$/.test(hour)) invalid('Missing chart period');
	const [year, month, day, h] = [Number(parts[1]), Number(parts[2]), Number(parts[3]), Number(hour)];
	const local = new Date(Date.UTC(year, month - 1, day, h));
	if (month < 1 || month > 12 || day < 1 || day > 31 || h > 23 || local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day) invalid('Invalid chart period');
	const period = new Date(local.getTime() - KST_OFFSET);
	if (period.getTime() > now.getTime() + 5 * 60_000) invalid('Chart period is in the future');
	return period.toISOString();
}

type ChartRow = { id: string; rank: number; title: string; artist: string };

function readRank(value: string | undefined): number {
	const rank = normalized(value ?? '');
	if (!/^\d{1,3}$/.test(rank)) invalid('Missing chart rank');
	return Number(rank);
}

function validatedRank(rows: ChartRow[], expectedId: string, maxRank = 100): number | null {
	if (rows.length !== maxRank) invalid('Chart is incomplete');
	if (new Set(rows.map(row => row.id)).size !== maxRank || rows.some(row => !/^\d+$/.test(row.id))) invalid('Chart IDs are invalid or duplicated');
	const ranks = new Set(rows.map(row => row.rank));
	if (ranks.size !== maxRank || rows.some(row => row.rank < 1 || row.rank > maxRank)) invalid('Chart ranks are incomplete or duplicated');
	const target = rows.find(row => row.id === expectedId);
	if (!target) return null;
	if (normalized(target.title).toUpperCase() !== NEON_TITLE) invalid('Chart work identity changed');
	// Some official lists collapse the credited artists to A2O alone. The fixed
	// platform work ID remains mandatory; title/artist never select another ID.
	const artists = normalized(target.artist).toUpperCase().replace(/\s+/g, '');
	if (!/^(?:A2O|A2OLITE)(?:(?:&|,|·|\/)(?:A2O|A2OLITE))*$/.test(artists)) invalid('Chart artist identity changed');
	return target.rank;
}

export function parseMelonChart(html: string, hot100 = false, now = new Date()): MusicChartSnapshot {
	const root = document(html);
	if (hot100) {
		const scope = root.querySelector('input#chartType')?.getAttribute('value') ?? root.querySelector('input[name=chartType]')?.getAttribute('value');
		if (scope !== 'D100') invalid('HOT100 release window is not D100');
	}
	const date = root.querySelector('span.year')?.text.trim() ?? '';
	const hour = /^(\d{1,2}):00$/.exec(normalized(root.querySelector('span.hour')?.text ?? ''))?.[1] ?? '';
	const period = periodFromKst(date, hour, now);
	return { period, rank: validatedRank(melonRows(root), EXPECTED_IDS.melon), eligible: true };
}

function melonRows(root: HTMLElement): ChartRow[] {
	return root.querySelectorAll('table tbody tr[data-song-no]').map(row => ({
		id: row.getAttribute('data-song-no') ?? '',
		rank: readRank(row.querySelector('.rank')?.text),
		title: row.querySelector('.rank01 a')?.text ?? '',
		artist: row.querySelector('.rank02')?.querySelector('a')?.text ?? '',
	}));
}

export function parseMelonDailyChart(html: string, now = new Date()): MusicChartSnapshot {
	const root = document(html);
	if (!root.querySelector('title')?.text.includes('일간') || !root.querySelectorAll('h2').some(heading => heading.text.includes('일간'))) invalid('Source is not the Melon daily chart');
	const date = root.querySelector('span.year')?.text.trim() ?? '';
	// A daily chart is identified by its source date, never the collection hour.
	const period = periodFromKst(date, '0', now);
	return { period, rank: validatedRank(melonRows(root), EXPECTED_IDS.melon), eligible: true };
}

function bugsVisiblePeriod(root: HTMLElement, now: Date): string {
	// Bugs has served an obsolete <time datetime> alongside newer visible date
	// controls. Read visible controls only; never use that machine attribute.
	const dateControl = root.querySelector('.date') ?? root.querySelector('.chartDate');
	const date = /\d{4}\.\s*\d{2}\.\s*\d{2}/.exec(normalized(dateControl?.text ?? ''))?.[0] ?? '';
	const hourControl = root.querySelector('.time') ?? root.querySelector('.chartTime');
	const hour = /(?:^|\s)(\d{1,2}):00(?:\s|$)/.exec(normalized(hourControl?.text ?? ''))?.[1] ?? '';
	return periodFromKst(date, hour, now);
}

export function parseBugsChart(html: string, now = new Date()): MusicChartSnapshot {
	const root = document(html);
	const period = bugsVisiblePeriod(root, now);
	const rows = root.querySelectorAll('table.trackList tbody tr[trackid]').map(row => ({
		id: row.getAttribute('trackid') ?? '',
		rank: readRank(row.querySelector('.ranking strong')?.text),
		title: row.querySelector('p.title a')?.text ?? '',
		artist: row.querySelector('p.artist a')?.text ?? '',
	}));
	return { period, rank: validatedRank(rows, EXPECTED_IDS.bugs), eligible: true };
}

export function getGenieDailyPeriod(html: string, now = new Date()): { period: string; ymd: string } {
	const root = document(html);
	const periods = new Set<string>();
	const pages = new Set<string>();
	for (const a of root.querySelectorAll('a[href]')) {
		const url = new URL(a.getAttribute('href') ?? '', 'https://www.genie.co.kr/chart/musicVideo');
		if (url.origin !== 'https://www.genie.co.kr' || url.pathname !== '/chart/musicVideo') continue;
		if (url.searchParams.get('ditc') !== 'D') continue;
		const ymd = url.searchParams.get('ymd');
		const page = url.searchParams.get('pg');
		if (ymd && (page === '1' || page === '2')) {
			periods.add(ymd);
			pages.add(page);
		}
	}
	if (periods.size !== 1 || !pages.has('2')) invalid('Missing or inconsistent MV daily pagination');
	const ymd = [...periods][0];
	return { period: periodFromKst(ymd, '0', now), ymd };
}

export function parseGenieDailyChart(firstPage: string, secondPage: string, now = new Date()): MusicChartSnapshot {
	const first = getGenieDailyPeriod(firstPage, now);
	const second = getGenieDailyPeriod(secondPage, now);
	if (first.period !== second.period) invalid('MV pages belong to different chart periods');
	const rows = [firstPage, secondPage].flatMap((html, page) => {
		const elements = document(html).querySelectorAll('table.list-wrap tbody tr.list[mvId]');
		if (elements.length !== 50) invalid('MV chart page is incomplete');
		return elements.map(row => {
			const number = row.querySelector('td.number')?.clone() as HTMLElement | undefined;
			number?.querySelectorAll('span').forEach(span => span.remove());
			const rank = readRank(number?.text);
			if (rank < page * 50 + 1 || rank > (page + 1) * 50) invalid('MV pagination ranks are inconsistent');
			const id = row.getAttribute('mvId') ?? '';
			if (id === EXPECTED_IDS.genieMv && row.getAttribute('songId') !== EXPECTED_IDS.genieSong) invalid('MV song identity changed');
			return { id, rank, title: row.querySelector('a.title')?.text ?? '', artist: row.querySelector('a.artist')?.text ?? '' };
		});
	});
	return { period: first.period, rank: validatedRank(rows, EXPECTED_IDS.genieMv), eligible: true };
}

export function getGenieRealtimePeriod(html: string, now = new Date()): { period: string; ymd: string; hour: string } {
	const root = document(html);
	const periods = new Map<string, { ymd: string; hour: string }>();
	const pages = new Set<string>();
	for (const a of root.querySelectorAll('a[href]')) {
		const url = new URL(a.getAttribute('href') ?? '', 'https://www.genie.co.kr/chart/top200');
		if (url.origin !== 'https://www.genie.co.kr' || !/^\/chart\/top200\/?$/.test(url.pathname)) continue;
		const page = url.searchParams.get('pg');
		if (!page || !/^[1-4]$/.test(page)) continue;
		if (url.searchParams.get('ditc') !== 'D' || url.searchParams.get('rtm') !== 'Y') invalid('Genie pagination is not realtime');
		const ymd = url.searchParams.get('ymd') ?? '';
		const hour = url.searchParams.get('hh') ?? '';
		if (!/^\d{8}$/.test(ymd) || !/^\d{2}$/.test(hour)) invalid('Missing realtime chart period');
		const period = periodFromKst(ymd, hour, now);
		periods.set(period, { ymd, hour });
		pages.add(page);
	}
	if (periods.size !== 1 || pages.size !== 4) invalid('Missing or inconsistent realtime pagination');
	const [period, { ymd, hour }] = [...periods][0];
	return { period, ymd, hour };
}

export function parseGenieRealtimeChart(pages: string[], now = new Date()): MusicChartSnapshot {
	if (pages.length !== 4) invalid('Realtime chart requires four pages');
	const first = getGenieRealtimePeriod(pages[0], now);
	const rows = pages.flatMap((html, page) => {
		if (getGenieRealtimePeriod(html, now).period !== first.period) invalid('Realtime pages belong to different chart periods');
		const elements = document(html).querySelectorAll('table.list-wrap tbody tr.list[songId]');
		if (elements.length !== 50) invalid('Realtime chart page is incomplete');
		return elements.map(row => {
			const number = row.querySelector('td.number')?.clone() as HTMLElement | undefined;
			number?.querySelectorAll('span').forEach(span => span.remove());
			const rank = readRank(number?.text);
			if (rank < page * 50 + 1 || rank > (page + 1) * 50) invalid('Realtime pagination ranks are inconsistent');
			return { id: row.getAttribute('songId') ?? '', rank, title: row.querySelector('a.title')?.text ?? '', artist: row.querySelector('a.artist')?.text ?? '' };
		});
	});
	return { period: first.period, rank: validatedRank(rows, EXPECTED_IDS.genieSong, 200), eligible: true };
}
