/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';
import type { App } from 'vue';
import type { KpopChart, KpopChartView, KpopEntry } from '@/utility/kpop-charts.js';
import MusicCharts from '@/pages/music-charts.vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';

vi.mock('@/i.js', () => ({ $i: { id: 'synthetic-billboard-account' } }));
vi.mock('@/page.js', () => ({ definePage: () => {} }));
vi.mock('@/router.js', async () => {
	const { EventEmitter } = await import('eventemitter3');
	return { useRouter: () => Object.assign(new EventEmitter(), { navHook: null, pushByPath: vi.fn() }) };
});
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: vi.fn() }));
vi.mock('@/composables/use-kpop-list-motion.js', async () => {
	const { ref } = await import('vue');
	return { useKpopListMotion: () => ({ animate: ref(false), changedIds: ref(new Set()), beforeLeave: () => {}, restoreLeaving: () => {} }) };
});
vi.mock('@/components/MkButton.vue', async () => {
	const { defineComponent, h } = await import('vue');
	return { default: defineComponent({ setup(_, { slots }) { return () => h('button', slots.default?.()); } }) };
});
vi.mock('@/components/MkKpopChartTrend.vue', async () => {
	const { defineComponent, h } = await import('vue');
	return { default: defineComponent({ render: () => h('div', { 'data-testid': 'synthetic-trend' }) }) };
});
vi.mock('@/components/MkKpopSongSheet.vue', async () => {
	const { defineComponent, h } = await import('vue');
	return { default: defineComponent({ setup(_, { slots }) { return () => h('div', slots.default?.()); } }) };
});

const key = 'billboard-korea-global-k-songs';
const sourceUrl = 'https://billboard.co.kr/charts/billboard-korea-global-k-songs/';
const chart: KpopChartView = {
	chartKey: key, provider: 'billboard', label: 'Billboard Korea Global K-Songs', sourceUrl,
	maxRank: 100, periodHours: 168, coverage: 'complete', sourceTotal: 100, expectedCount: 100, rankBasis: 'official_rank',
	status: 'available', checkedAt: '2026-10-28T04:00:00.000Z', lastSuccessAt: '2026-10-28T04:00:00.000Z', lastChangedAt: '2026-10-28T04:00:00.000Z',
	nextAttemptAt: null, diagnostic: null, sourcePeriod: null, sourceUpdatedAt: null, sourceDate: '2026-10-31', observedAt: '2026-10-28T04:00:00.000Z',
};
const entries: KpopEntry[] = [7, 19].map((rank, index) => ({
	songId: `synthetic-billboard-${rank}`, rank, title: `Synthetic song ${rank}`, artists: [{ id: null, name: index === 0 ? 'aespa' : 'IVE' }],
	album: null, albumId: null, albumCoverUrl: null, sourceMovement: { type: 'unknown', amount: null }, groupIds: index === 0 ? ['aespa'] : ['ive'], previousRank: null, change: null, bestRank7d: rank,
}));

describe('Billboard in the existing K-pop page', () => {
	let app: App | null = null;
	beforeEach(() => {
		vi.useFakeTimers();
		window.localStorage.clear();
		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
		vi.spyOn(window, 'matchMedia').mockReturnValue(Object.assign(new EventTarget(), { matches: false }) as unknown as MediaQueryList);
		vi.mocked(misskeyApi).mockReset();
		vi.mocked(misskeyApi).mockImplementation(async (endpoint, params) => {
			if (endpoint === 'music-charts/kpop-history') return { chartKey: key, songId: entries[1].songId, basis: 'observation', from: '2026-10-21T04:00:00.000Z', to: chart.observedAt, points: [] } as never;
			const selected = params && 'groupId' in params && params.groupId === 'ive' ? [entries[1]] : entries;
			const result: KpopChart = { chart, entries: selected, total: selected.length, hasMore: false };
			return result as never;
		});
	});
	afterEach(() => {
		app?.unmount(); app = null;
		document.body.replaceChildren();
		vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
	});

	async function settle(): Promise<void> { await nextTick(); await vi.advanceTimersByTimeAsync(0); await nextTick(); }

	it('selects the weekly chart, keeps original ranks through group/search filters, and opens existing song history', async () => {
		app = createApp(MusicCharts, { initialChart: key });
		app.component('PageWithHeader', defineComponent({ setup(_, { slots }) { return () => h('main', slots.default?.()); } }));
		app.component('MkA', defineComponent({ props: ['to'], setup(props, { slots }) { return () => h('a', { href: props.to }, slots.default?.()); } }));
		const host = document.createElement('div'); document.body.append(host); app.mount(host); await settle();

		const platform = host.querySelector<HTMLSelectElement>('[data-testid="kpop-platform"]')!;
		expect(platform.value).toBe(key);
		expect(platform.selectedOptions[0].textContent).toBe('Billboard');
		expect(host.textContent).toContain(i18n.ts._musicCharts.kpopBillboard);
		expect(host.textContent).toContain(i18n.ts._musicCharts.kpopBillboardIssueDate);
		expect(host.textContent).toContain('2026-10-31');
		expect(host.textContent).toContain(i18n.ts._musicCharts.kpopBillboardPeriodHint);
		expect(host.querySelector('time[datetime="2026-10-31"]')).toBeNull();
		expect([...host.querySelectorAll('[data-kpop-rank-value]')].map(node => node.textContent)).toEqual(['7', '19']);
		const source = host.querySelector<HTMLAnchorElement>(`a[href="${sourceUrl}"]`)!;
		expect(source.target).toBe('_blank');
		expect(source.rel).toBe('noopener noreferrer');

		const group = host.querySelector<HTMLSelectElement>('[data-testid="kpop-group"]')!;
		expect(group.options.length).toBe(14);
		group.value = 'ive'; group.dispatchEvent(new Event('change')); await settle();
		expect([...host.querySelectorAll('[data-kpop-rank-value]')].map(node => node.textContent)).toEqual(['19']);
		const search = host.querySelector<HTMLInputElement>('[data-testid="kpop-search"]')!;
		search.value = 'Synthetic'; search.dispatchEvent(new Event('input')); await vi.advanceTimersByTimeAsync(300); await settle();
		expect(vi.mocked(misskeyApi).mock.calls.some(([endpoint, params]) => endpoint === 'music-charts/kpop-chart' && params && 'query' in params && params.query === 'Synthetic' && 'chartKey' in params && params.chartKey === key && 'groupId' in params && params.groupId === 'ive')).toBe(true);

		host.querySelector<HTMLButtonElement>('[data-song="synthetic-billboard-19"]')!.click(); await settle();
		expect(vi.mocked(misskeyApi).mock.calls.some(([endpoint, params]) => endpoint === 'music-charts/kpop-history' && params && 'chartKey' in params && params.chartKey === key && 'songId' in params && params.songId === 'synthetic-billboard-19')).toBe(true);
		expect(host.querySelector('[data-testid="kpop-song-details"]')?.textContent).toContain(i18n.ts._musicCharts.kpopObservedHistory);
	});
});
