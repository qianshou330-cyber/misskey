/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setImmediate } from 'node:timers/promises';
import { render as mount, fireEvent } from '@testing-library/vue';
const flushPromises = () => setImmediate();
import { defineComponent } from 'vue';
import Section from '@/components/MkDeferredSection.vue';

vi.mock('@/components/global/MkError.vue', () => ({ default: { emits: ['retry'], template: '<button @click="$emit(\'retry\')">retry</button>' } }));
const widget = defineComponent({ template: '<p>loaded</p>' });
const global = { stubs: { MkLoading: { template: '<span>loading</span>' } } };
const slots = { default: '<component :is="params.component"/>' };

describe('optional homepage sections', () => {
	beforeEach(() => { vi.useFakeTimers(); });
	afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
	it('allows the primary paint before loading and loads within one second even without frames', async () => {
		vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
		const loader = vi.fn().mockResolvedValue({ default: widget });
		const view = mount(Section, { props: { loader, deferred: true }, global, slots });
		expect(loader).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(999);
		expect(loader).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		await flushPromises();
		expect(view.container.textContent).toBe('loaded');
		expect(loader).toHaveBeenCalledTimes(1);
		view.unmount();
	});
	it('does not load a section after leaving before the scheduled paint', async () => {
		const loader = vi.fn().mockResolvedValue({ default: widget });
		const view = mount(Section, { props: { loader, deferred: true }, global });
		view.unmount();
		await vi.advanceTimersByTimeAsync(2000);
		expect(loader).not.toHaveBeenCalled();
	});
	it('loads non-staged callers immediately and offers local retry without an automatic loop', async () => {
		const loader = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ default: widget });
		const view = mount(Section, { props: { loader }, global, slots });
		await flushPromises();
		expect(view.container.textContent).toBe('retry');
		await vi.advanceTimersByTimeAsync(5000);
		expect(loader).toHaveBeenCalledTimes(1);
		await fireEvent.click(view.getByText('retry'));
		await flushPromises();
		expect(view.container.textContent).toBe('loaded');
		view.unmount();
	});
	it('loads activity only when visible and releases its observer', async () => {
		let callback!: (entries: { isIntersecting: boolean }[]) => void;
		const disconnect = vi.fn();
		vi.stubGlobal('IntersectionObserver', class { constructor(cb: typeof callback) { callback = cb; } observe() {} disconnect = disconnect; });
		const loader = vi.fn().mockResolvedValue({ default: widget });
		const view = mount(Section, { props: { loader, nearViewport: true }, global, slots });
		callback([{ isIntersecting: false }]);
		expect(loader).not.toHaveBeenCalled();
		callback([{ isIntersecting: true }]);
		await flushPromises();
		expect(view.container.textContent).toBe('loaded');
		expect(disconnect).toHaveBeenCalled();
		view.unmount();
	});
});
