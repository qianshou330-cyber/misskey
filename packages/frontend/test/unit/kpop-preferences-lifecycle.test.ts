/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, KeepAlive, nextTick, reactive, ref } from 'vue';
import type { App } from 'vue';
import { useKpopPreferences } from '@/composables/use-kpop-preferences.js';
import { kpopPreferenceStorageKey } from '@/utility/kpop-chart-preferences.js';

const account = vi.hoisted(() => ({ current: null as { id: string } | null }));
vi.mock('@/i.js', () => ({ get $i() { return account.current; } }));

describe('K-pop preference selection lifecycles', () => {
	const apps: App[] = [];

	function mount(initial?: string | (() => string | undefined)) {
		let result!: ReturnType<typeof useKpopPreferences>;
		const app = createApp({ setup() { result = useKpopPreferences(initial); return () => h('div'); } });
		app.mount(document.createElement('div'));
		apps.push(app);
		return result;
	}

	beforeEach(() => { window.localStorage.clear(); account.current = null; });
	afterEach(() => { for (const app of apps.splice(0)) app.unmount(); vi.restoreAllMocks(); });

	it('shares manual platform choices and restores the latest Melon category without saving queries or songs', () => {
		const home = mount();
		const details = mount();
		details.selectChart('melon-hot100-d30');
		expect(home.chartKey.value).toBe('melon-hot100-d30');
		home.selectPlatform('spotify');
		expect(details.chartKey.value).toBe('spotify');
		details.selectGroup('newjeans');
		home.selectPlatform('melon-top100');
		expect(home.chartKey.value).toBe('melon-hot100-d30');
		expect(details.chartKey.value).toBe('melon-hot100-d30');
		expect(mount().groupId.value).toBe('newjeans');
		expect(Object.keys(JSON.parse(window.localStorage.getItem(kpopPreferenceStorageKey(null))!)).sort()).toEqual(['chartKey', 'groupId', 'lastMelonChart', 'version']);
	});

	it('gives valid links priority without changing saved platform or Melon category', () => {
		const home = mount();
		home.selectChart('melon-daily');
		home.selectPlatform('genie-realtime');
		const before = window.localStorage.getItem(kpopPreferenceStorageKey(null));
		const linked = mount('melon-hot100');
		expect(linked.chartKey.value).toBe('melon-hot100');
		expect(window.localStorage.getItem(kpopPreferenceStorageKey(null))).toBe(before);
		home.selectPlatform('apple');
		expect(linked.chartKey.value).toBe('melon-hot100');
		linked.selectGroup('ive');
		expect(JSON.parse(window.localStorage.getItem(kpopPreferenceStorageKey(null))!).chartKey).toBe('apple');
		linked.selectPlatform('melon-top100');
		expect(linked.chartKey.value).toBe('melon-daily');
		expect(home.chartKey.value).toBe('melon-daily');
	});

	it('falls back from invalid URLs and updates when route props change without writing storage', async () => {
		const home = mount();
		home.selectPlatform('spotify');
		const route = ref<string | undefined>('invalid');
		const details = mount(() => route.value);
		expect(details.chartKey.value).toBe('spotify');
		const before = window.localStorage.getItem(kpopPreferenceStorageKey(null));
		route.value = 'bugs-realtime'; await nextTick();
		expect(details.chartKey.value).toBe('bugs-realtime');
		route.value = undefined; await nextTick();
		expect(details.chartKey.value).toBe('spotify');
		expect(window.localStorage.getItem(kpopPreferenceStorageKey(null))).toBe(before);
	});

	it('refreshes shared choices on KeepAlive activation while preserving explicit links', async () => {
		const home = mount();
		const visible = ref(true);
		let saved!: ReturnType<typeof useKpopPreferences>;
		let linked!: ReturnType<typeof useKpopPreferences>;
		const View = defineComponent({ setup() { saved = useKpopPreferences(); linked = useKpopPreferences('flo'); return () => h('div'); } });
		const app = createApp({ render: () => h(KeepAlive, () => visible.value ? h(View) : null) });
		app.mount(document.createElement('div')); apps.push(app);
		visible.value = false; await nextTick();
		home.selectPlatform('apple');
		expect(saved.chartKey.value).toBe('melon-top100');
		visible.value = true; await nextTick();
		expect(saved.chartKey.value).toBe('apple');
		expect(linked.chartKey.value).toBe('flo');
	});

	it('restores an explicit link when returning to a cached route after a manual selection', async () => {
		const home = mount();
		const visible = ref(true);
		let linked!: ReturnType<typeof useKpopPreferences>;
		const View = defineComponent({ setup() { linked = useKpopPreferences('melon-daily'); return () => h('div'); } });
		const app = createApp({ render: () => h(KeepAlive, () => visible.value ? h(View) : null) });
		app.mount(document.createElement('div')); apps.push(app);
		linked.selectPlatform('spotify');
		expect(linked.chartKey.value).toBe('spotify');
		visible.value = false; await nextTick();
		home.selectPlatform('apple');
		const stored = window.localStorage.getItem(kpopPreferenceStorageKey(null));
		visible.value = true; await nextTick();
		expect(linked.chartKey.value).toBe('melon-daily');
		expect(home.chartKey.value).toBe('apple');
		expect(window.localStorage.getItem(kpopPreferenceStorageKey(null))).toBe(stored);
	});

	it('separates guest and account records and resets existing refs on account changes', () => {
		mount().selectPlatform('spotify');
		account.current = reactive({ id: 'account-a' });
		const signedIn = mount();
		expect(signedIn.chartKey.value).toBe('melon-top100');
		signedIn.selectChart('melon-daily');
		signedIn.selectGroup('aespa');
		account.current.id = 'account-b';
		expect(signedIn.chartKey.value).toBe('melon-top100');
		expect(signedIn.groupId.value).toBe('');
		signedIn.selectPlatform('apple');
		account.current.id = 'account-a';
		expect(signedIn.chartKey.value).toBe('melon-daily');
		expect(signedIn.groupId.value).toBe('aespa');
		expect(JSON.parse(window.localStorage.getItem(kpopPreferenceStorageKey(null))!).chartKey).toBe('spotify');
	});
});
