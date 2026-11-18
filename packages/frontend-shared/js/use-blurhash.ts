/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { onBeforeUnmount, watch } from 'vue';
import type { Ref } from 'vue';
import { BLURHASH_DISPLAY_EDGE, getBlurhashSize, isValidBlurhash } from './blurhash.js';
import { extractAvgColorFromBlurhash } from './extract-avg-color-from-blurhash.js';
import type { BlurhashWorkerPool } from './blurhash-worker-pool.js';

let scratch: HTMLCanvasElement | undefined;

/** Latest props win; unmount releases both queued work and retained callbacks. */
export function useBlurhash(
	canvas: Readonly<Ref<HTMLCanvasElement | null | undefined>>,
	props: () => { hash: string | null; width: number; height: number; onlyAvgColor: boolean },
	pool: BlurhashWorkerPool,
): void {
	let cancel: (() => void) | undefined;
	let generation = 0;
	let disposed = false;
	watch([canvas, props], ([element, options]) => {
		cancel?.();
		cancel = undefined;
		const current = ++generation;
		if (!element || disposed) return;
		const size = getBlurhashSize(options.width, options.height, BLURHASH_DISPLAY_EDGE);
		element.width = size?.width ?? BLURHASH_DISPLAY_EDGE;
		element.height = size?.height ?? BLURHASH_DISPLAY_EDGE;
		const context = element.getContext('2d');
		if (!context) return;
		const validHash = isValidBlurhash(options.hash);
		const average = validHash ? extractAvgColorFromBlurhash(options.hash!) : undefined;
		context.fillStyle = average && /^#[0-9a-f]{6}$/i.test(average) ? average : '#888';
		context.fillRect(0, 0, element.width, element.height);
		if (!size || !validHash || options.onlyAvgColor) return;

		cancel = pool.request(options.hash!, options.width, options.height, result => {
			if (!result || disposed || generation !== current || canvas.value !== element) return;
			try {
				scratch ??= window.document.createElement('canvas');
				scratch.width = result.width;
				scratch.height = result.height;
				const scratchContext = scratch.getContext('2d');
				if (!scratchContext) return;
				const image = scratchContext.createImageData(result.width, result.height);
				image.data.set(new Uint8ClampedArray(result.pixels));
				scratchContext.putImageData(image, 0, 0);
				context.drawImage(scratch, 0, 0, element.width, element.height);
			} catch {
				// The already painted average color remains usable if 2D drawing fails.
			}
		});
	}, { immediate: true, flush: 'post' });

	onBeforeUnmount(() => {
		disposed = true;
		generation++;
		cancel?.();
	});
}
