/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { setImmediate } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import Activity from '@/components/MkVisitorDashboard.ActiveUsersChart.vue';

const mocks = vi.hoisted(() => ({ request: vi.fn(), chart: vi.fn() }));
vi.mock('chart.js', () => ({ Chart: class { constructor() { mocks.chart(); } destroy() {} } }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: mocks.request }));
vi.mock('@/theme.js', () => ({ themeManager: { currentCompiledTheme: { accent: '#fff' } } }));
vi.mock('@/store.js', () => ({ store: { s: { darkMode: false } } }));
vi.mock('@/composables/use-chart-tooltip.js', () => ({ useChartTooltip: () => ({ handler: vi.fn() }) }));
vi.mock('@/utility/chart-vline.js', () => ({ chartVLine: vi.fn() }));
vi.mock('@/utility/init-chart.js', () => ({ initChart: vi.fn() }));
vi.mock('@/components/global/MkError.vue', () => ({ default: { emits: ['retry'], template: '<button @click="$emit(\'retry\')">retry</button>' } }));
const global = { stubs: { MkLoading: { template: '<span>loading</span>' } } };
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

describe('activity failures stay local', () => {
	it('handles a failed request and supports a local manual retry', async () => {
		mocks.request.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ read: [1] });
		const view = render(Activity, { global });
		await setImmediate();
		await fireEvent.click(view.getByText('retry'));
		await setImmediate();
		expect(mocks.request).toHaveBeenCalledTimes(2);
		expect(mocks.chart).toHaveBeenCalledTimes(1);
	});
	it('aborts a hung request at eight seconds without global rejection', async () => {
		vi.useFakeTimers();
		let signal!: AbortSignal;
		mocks.request.mockImplementation((_e, _p, _t, s: AbortSignal) => new Promise((_resolve, reject) => {
			signal = s; s.addEventListener('abort', () => reject(new Error('timeout')));
		}));
		const view = render(Activity, { global });
		await vi.advanceTimersByTimeAsync(8000);
		expect(signal.aborted).toBe(true);
		expect(view.getByText('retry')).toBeTruthy();
	});
	it('aborts on leaving and ignores a late successful response', async () => {
		let signal!: AbortSignal;
		let resolve!: (raw: { read: number[] }) => void;
		mocks.request.mockImplementation((_e, _p, _t, s: AbortSignal) => new Promise(r => { signal = s; resolve = r; }));
		const view = render(Activity, { global });
		view.unmount();
		expect(signal.aborted).toBe(true);
		resolve({ read: [1] });
		await setImmediate();
		expect(mocks.chart).not.toHaveBeenCalled();
	});
});
