/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineComponent, h, KeepAlive, nextTick, reactive, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import Welcome from '@/pages/welcome.entrance.simple.vue';
import { instance } from '@/instance.js';

const counts = vi.hoisted(() => ({ original: 0, right: 0, disposed: 0 }));
vi.mock('@/i.js', () => ({ $i: null }));
vi.mock('@/instance.js', async () => {
	const { reactive } = await import('vue');
	return { instance: reactive({ policies: { gtlAvailable: true, ltlAvailable: true }, clientOptions: { showTimelineForVisitor: true } }) };
});
vi.mock('@/components/MkFeaturedPhotos.vue', () => ({ default: { template: '<div/>' } }));
vi.mock('@/components/global/MkError.vue', () => ({ default: { template: '<div/>' } }));
vi.mock('@/components/MkVisitorDashboard.vue', async () => {
	const { defineComponent, h, watch } = await import('vue');
	return { default: defineComponent({
		props: { showTimeline: { type: Boolean, default: true }, showMusicCharts: Boolean },
		setup(props) {
			watch(() => props.showTimeline, shown => { if (shown) counts.original++; }, { immediate: true });
			return () => h('div', { 'data-testid': 'dashboard', 'data-charts': props.showMusicCharts }, props.showTimeline ? [h('div', { 'data-testid': 'original-timeline' })] : []);
		},
	}) };
});
vi.mock('@/pages/welcome.timeline.vue', async () => {
	const { defineComponent, h, onUnmounted } = await import('vue');
	return { default: defineComponent({
		emits: ['unavailable'],
		setup(_props, { emit }) {
			counts.right++;
			onUnmounted(() => counts.disposed++);
			return () => h('button', { 'data-testid': 'stream', onClick: () => emit('unavailable') });
		},
	}) };
});

describe('simple welcome has one responsive visitor timeline', () => {
	let media: MediaQueryList;
	beforeEach(() => {
		counts.original = counts.right = counts.disposed = 0;
		Object.assign(instance, reactive({ policies: { gtlAvailable: true, ltlAvailable: true }, clientOptions: { showTimelineForVisitor: true } }));
		media = Object.assign(new EventTarget(), { matches: false, media: '(min-width: 1201px)', onchange: null, addListener: vi.fn(), removeListener: vi.fn() });
		vi.spyOn(window, 'matchMedia').mockReturnValue(media);
	});

	function resize(desktop: boolean) {
		Object.defineProperty(media, 'matches', { value: desktop, configurable: true });
		media.dispatchEvent(new Event('change'));
	}

	function countTimelines(view: ReturnType<typeof render>) {
		return view.queryAllByTestId('original-timeline').length + view.queryAllByTestId('stream').length;
	}

	afterEach(() => { cleanup(); vi.restoreAllMocks(); });

	it('does not briefly mount or request the original timeline on desktop', async () => {
		resize(true);
		const view = render(Welcome);
		expect(counts.original).toBe(0);
		await view.findByTestId('stream');
		expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 1201px)');
		expect(counts).toEqual({ original: 0, right: 1, disposed: 0 });
		expect(countTimelines(view)).toBe(1);
		expect(view.getByTestId('dashboard').getAttribute('data-charts')).toBe('true');
	});

	it('keeps narrow screens on the original timeline and disposes right stream at the breakpoint', async () => {
		const view = render(Welcome);
		expect(counts.right).toBe(0);
		expect(countTimelines(view)).toBe(1);
		resize(true);
		await view.findByTestId('stream');
		expect(countTimelines(view)).toBe(1);
		resize(false);
		await view.findByTestId('original-timeline');
		expect(counts.disposed).toBe(1);
		expect(countTimelines(view)).toBe(1);
	});

	it('latches an unavailable initial stream to the original single column for the visit', async () => {
		resize(true);
		const view = render(Welcome);
		await fireEvent.click(await view.findByTestId('stream'));
		expect(view.getByTestId('welcome-layout').getAttribute('data-columns')).toBe('false');
		expect(countTimelines(view)).toBe(1);
		resize(false);
		resize(true);
		await view.findByTestId('original-timeline');
		expect(counts.right).toBe(1);
	});

	it('honors the visitor switch and unavailable policies without mounting right stream', () => {
		resize(true);
		instance.clientOptions.showTimelineForVisitor = false;
		const view = render(Welcome);
		expect(view.queryByTestId('stream')).toBeNull();
		expect(counts.right).toBe(0);
		view.unmount();
		instance.clientOptions.showTimelineForVisitor = true;
		instance.policies.gtlAvailable = instance.policies.ltlAvailable = false;
		expect(render(Welcome).queryByTestId('stream')).toBeNull();
	});

	it('releases the media query listener on unmount', () => {
		const remove = vi.spyOn(media, 'removeEventListener');
		render(Welcome).unmount();
		expect(remove).toHaveBeenCalledWith('change', expect.any(Function));
	});

	it('does not mount a timeline when an inactive cached welcome page crosses the breakpoint', async () => {
		const shown = ref(true);
		const view = render(defineComponent({ setup: () => () => h(KeepAlive, null, { default: () => shown.value ? h(Welcome) : null }) }));
		shown.value = false;
		await nextTick();
		resize(true);
		await nextTick();
		expect(counts.right).toBe(0);
		expect(counts.original).toBe(1);
		shown.value = true;
		await view.findByTestId('stream');
		expect(counts.right).toBe(1);
		expect(countTimelines(view)).toBe(1);
	});
});
