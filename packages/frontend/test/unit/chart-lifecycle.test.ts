/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { BasicPlatform, Chart } from 'chart.js';
import gradient from 'chartjs-plugin-gradient';
import { initChart } from '@/utility/init-chart.js';

vi.mock('@/theme.js', () => ({ themeManager: { currentCompiledTheme: { fg: '#ffffff' } } }));
vi.mock('@/store.js', () => ({ store: { s: { darkMode: true } } }));

function createCanvas(): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	const context = new Proxy({ canvas }, {
		get(target, key) {
			if (key === 'canvas') return target.canvas;
			if (key === 'measureText') return () => ({ width: 0 });
			return () => {};
		},
	});
	vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
	return canvas;
}

afterEach(() => {
	for (const chart of Object.values(Chart.instances)) chart.destroy();
	vi.restoreAllMocks();
});

describe('chart lifecycle', () => {
	it('runs the installed gradient plugin cleanup when Chart.js 4 destroys each chart', () => {
		const legacyGradient = gradient as typeof gradient & { destroy: (chart: Chart) => void };
		const cleanup = vi.spyOn(legacyGradient, 'destroy');
		initChart();
		for (let index = 0; index < 8; index++) {
			const chart = new Chart(createCanvas(), {
				type: 'doughnut',
				data: { datasets: [] },
				options: { responsive: false, animation: false },
				platform: BasicPlatform,
			});
			expect(chart.ctx).not.toBeNull();
			expect(cleanup).toHaveBeenCalledTimes(index);
			chart.destroy();
			expect(cleanup).toHaveBeenLastCalledWith(chart);
			expect(cleanup).toHaveBeenCalledTimes(index + 1);
			expect(Chart.instances[chart.id]).toBeUndefined();
		}
	});
});
