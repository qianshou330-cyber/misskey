/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineAsyncComponent, defineComponent, h, KeepAlive, nextTick, ref, Suspense } from 'vue';
import type { App } from 'vue';
import MusicCharts from '@/pages/music-charts.vue';

vi.mock('@/i.js', () => ({ $i: { id: 'synthetic-cache-account' } }));
vi.mock('@/page.js', () => ({ definePage: () => {} }));
vi.mock('@/router.js', async () => {
	const { EventEmitter } = await import('eventemitter3');
	const router = Object.assign(new EventEmitter(), { navHook: null, pushByPath: vi.fn() });
	return { useRouter: () => router };
});
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: vi.fn() }));
vi.mock('@/composables/use-kpop-list-motion.js', async () => {
	const { ref } = await import('vue');
	return { useKpopListMotion: () => ({ animate: ref(false), changedIds: ref(new Set()), beforeLeave: () => {}, restoreLeaving: () => {} }) };
});
vi.mock('@/composables/use-kpop-charts.js', async () => {
	const { ref } = await import('vue');
	return { useKpopResource: () => ({
		data: ref({ chart: { chartKey: 'melon-top100', provider: 'melon', label: 'Melon', rankBasis: 'official_rank', coverage: 'complete', status: 'available', sourceUrl: 'https://example.invalid/', sourceTotal: 100, expectedCount: 100, maxRank: 100, observedAt: '2026-10-23T04:05:00Z', lastSuccessAt: '2026-10-23T04:05:00Z', sourcePeriod: '2026-10-23T04:00:00Z' }, entries: [0, 1].map(index => ({ songId: `synthetic-${index}`, title: `Synthetic song ${index}`, rank: index + 1, artists: [{ name: 'Synthetic artist' }], groupIds: ['aespa'], sourceMovement: { type: 'same', amount: null }, previousRank: index + 1, change: 0, bestRank7d: 1 })), total: 2, hasMore: false }),
		loading: ref(false), failed: ref(false), refresh: vi.fn(),
	}) };
});
vi.mock('@/components/MkButton.vue', async () => {
	const { defineComponent, h } = await import('vue');
	return { default: defineComponent({ setup(_, { slots }) { return () => h('button', slots.default?.()); } }) };
});
vi.mock('@/components/MkKpopSongSheet.vue', async () => {
	const { defineComponent, h } = await import('vue');
	return { default: defineComponent({ emits: ['close'], setup(_, { emit, slots }) { return () => h('div', { 'data-testid': 'sheet-fixture' }, [h('button', { onClick: () => emit('close') }, 'Close'), slots.default?.()]); } }) };
});
vi.mock('@/components/MkKpopSongDetails.vue', async () => {
	const { defineComponent, h } = await import('vue');
	return { default: defineComponent({ props: ['songId'], setup(props) { return () => h('div', { 'data-selected-song': props.songId }); } }) };
});

describe('cached chart deep links in an async RouterView', () => {
	let app: App | null = null;
	beforeEach(() => {
		vi.useFakeTimers();
		window.localStorage.clear();
		const media = Object.assign(new EventTarget(), { matches: true });
		vi.spyOn(window, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList);
		vi.spyOn(window.history, 'back').mockImplementation(() => {});
	});
	afterEach(() => { app?.unmount(); app = null; window.document.body.replaceChildren(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

	async function settle(): Promise<void> {
		for (let index = 0; index < 8; index++) { await nextTick(); await Promise.resolve(); }
	}

	it('reopens the URL song when returning to the cached deep page after another chart page', async () => {
		const route = ref('home');
		const AsyncChart = defineAsyncComponent(async () => MusicCharts);
		const Home = defineComponent({ render: () => h('div', 'Synthetic homepage') });
		app = createApp({ render: () => h(KeepAlive, { max: 3 }, () => h(Suspense, null, { default: () => route.value === 'home' ? h(Home, { key: 'home' }) : h(AsyncChart, { key: route.value, initialChart: 'melon-top100', initialSong: route.value === 'deep' ? 'synthetic-0' : undefined }) })) });
		app.component('PageWithHeader', defineComponent({ setup(_, { slots }) { return () => h('main', slots.default?.()); } }));
		const host = window.document.createElement('div'); window.document.body.append(host); app.mount(host); await settle();

		async function navigate(name: string): Promise<void> {
			window.history.replaceState({}, '', name === 'home' ? '/' : `/music-charts/kpop?chart=melon-top100${name === 'deep' ? '&song=synthetic-0' : ''}`);
			route.value = name;
			await settle();
		}

		async function close(): Promise<void> {
			(window.document.querySelector('[data-testid="sheet-fixture"] button') as HTMLButtonElement).click(); await settle();
			window.history.replaceState({}, '', window.location.href); window.dispatchEvent(new PopStateEvent('popstate', { state: {} })); await settle();
		}

		await navigate('deep'); expect(window.document.querySelector('[data-testid="sheet-fixture"]')).not.toBeNull(); await close();
		await navigate('home'); await navigate('plain'); await navigate('home'); await navigate('plain'); await navigate('home'); await navigate('deep');
		expect(window.document.querySelector('[data-testid="sheet-fixture"]')).not.toBeNull();
		expect(window.document.querySelector('[data-testid="sheet-fixture"] [data-selected-song]')?.getAttribute('data-selected-song')).toBe('synthetic-0');
		await close();
		(window.document.querySelector('[data-song="synthetic-1"]') as HTMLButtonElement).click(); await settle();
		expect(window.document.querySelector('[data-testid="sheet-fixture"] [data-selected-song]')?.getAttribute('data-selected-song')).toBe('synthetic-1');
		await close(); await navigate('home'); await navigate('deep');
		expect(window.document.querySelector('[data-testid="sheet-fixture"] [data-selected-song]')?.getAttribute('data-selected-song')).toBe('synthetic-0');
	});
});
