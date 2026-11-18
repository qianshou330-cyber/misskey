/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import { decodeBlurhash, getBlurhashSize } from '@@/js/blurhash.js';
import type { BlurhashRequest, BlurhashResponse } from '@@/js/blurhash.js';
import { BlurhashWorkerPool } from '@@/js/blurhash-worker-pool.js';
import { useBlurhash } from '@@/js/use-blurhash.js';
import EmImgWithBlurhash from '../../../frontend-embed/src/components/EmImgWithBlurhash.vue';

const HASH = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj';
const OTHER_HASH = 'LKO2?U%2Tw=w]~RBVZRi};RPxuwH';

class FakeWorker extends EventTarget {
	messages: BlurhashRequest[] = [];
	terminate = vi.fn();
	postMessage = vi.fn((request: BlurhashRequest) => this.messages.push(request));
	respond(request = this.messages.at(-1)!, response: BlurhashResponse = decodeBlurhash(request)): void {
		this.dispatchEvent(new MessageEvent('message', { data: response }));
	}
}

const pools: BlurhashWorkerPool[] = [];
const apps: App[] = [];

function createPool(cores = 8) {
	const workers: FakeWorker[] = [];
	const pool = new BlurhashWorkerPool(() => {
		const worker = new FakeWorker();
		workers.push(worker);
		return worker as unknown as Worker;
	}, cores);
	pools.push(pool);
	return { pool, workers };
}

afterEach(() => {
	for (const app of apps.splice(0)) app.unmount();
	for (const pool of pools.splice(0)) pool.dispose();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe('bounded CPU BlurHash', () => {
	test('decodes 1000 times deterministically without any canvas or GPU API', () => {
		const canvas = vi.spyOn(window.document, 'createElement');
		const expected = decodeBlurhash({ id: 0, hash: HASH, width: 32, height: 24 }).result!;
		const expectedPixels = new Uint8Array(expected.pixels);
		let consistent = true;
		for (let id = 1; id <= 1000; id++) {
			const result = decodeBlurhash({ id, hash: HASH, width: 32, height: 24 });
			consistent &&= result.id === id && result.result?.pixels.byteLength === 32 * 24 * 4
				&& new Uint8Array(result.result.pixels).every((value, index) => value === expectedPixels[index]);
		}
		expect(consistent).toBe(true);
		expect(canvas).not.toHaveBeenCalled();
	}, 15000);

	test('rejects invalid hashes and unbounded decode dimensions', () => {
		for (const hash of ['', 'x', '💥'.repeat(20), 'L'.repeat(200), '!!!!!!!!!!!!']) {
			expect(decodeBlurhash({ id: 1, hash, width: 32, height: 32 }).result).toBeNull();
		}
		for (const width of [0, -1, NaN, Infinity, 33, 1.5]) {
			expect(decodeBlurhash({ id: 1, hash: HASH, width, height: 32 }).result).toBeNull();
		}
		expect(getBlurhashSize(1e100, 1, 32)).toEqual({ width: 32, height: 4 });
		expect(getBlurhashSize(1, 1e100, 64)).toEqual({ width: 8, height: 64 });
		expect(getBlurhashSize(Infinity, 10, 32)).toBeNull();
	});

	test('limits workers, outstanding messages and waiting queue, and cancels queued work', () => {
		const { pool, workers } = createPool();
		const callbacks = Array.from({ length: 67 }, () => vi.fn());
		const cancel = callbacks.map(callback => pool.request(HASH, 4000, 3000, callback));
		expect(workers).toHaveLength(2);
		expect(workers.map(worker => worker.messages.length)).toEqual([1, 1]);
		// Two in flight plus 64 waiting: only the oldest waiting task falls back.
		expect(callbacks[2]).toHaveBeenCalledExactlyOnceWith(null);
		cancel[3]();
		workers[0].respond();
		expect(workers[0].messages[1].id).toBe(5);
		expect(callbacks[3]).not.toHaveBeenCalled();
		expect(workers[0].messages[0]).toMatchObject({ width: 32, height: 24 });
	});

	test('uses one worker on low concurrency and drops canceled/out of order results', () => {
		const { pool, workers } = createPool(2);
		const first = vi.fn();
		const second = vi.fn();
		const cancel = pool.request(HASH, 32, 32, first);
		pool.request(OTHER_HASH, 32, 32, second);
		expect(workers).toHaveLength(1);
		const old = workers[0].messages[0];
		cancel();
		workers[0].respond(old);
		expect(first).not.toHaveBeenCalled();
		expect(workers[0].messages).toHaveLength(2);
		workers[0].respond(old);
		expect(second).not.toHaveBeenCalled();
		workers[0].respond();
		expect(second).toHaveBeenCalledOnce();
	});

	test('retires timed-out or failed workers without creating replacements', () => {
		vi.useFakeTimers();
		const { pool, workers } = createPool(1);
		const first = vi.fn();
		const queued = vi.fn();
		pool.request(HASH, 32, 32, first);
		pool.request(HASH, 32, 32, queued);
		vi.advanceTimersByTime(5000);
		expect(workers[0].terminate).toHaveBeenCalledOnce();
		expect(first).toHaveBeenCalledExactlyOnceWith(null);
		expect(queued).toHaveBeenCalledExactlyOnceWith(null);
		const after = vi.fn();
		pool.request(HASH, 32, 32, after);
		expect(after).toHaveBeenCalledExactlyOnceWith(null);
		expect(workers).toHaveLength(1);

		const failed = createPool(1);
		const onFailure = vi.fn();
		failed.pool.request(HASH, 32, 32, onFailure);
		failed.workers[0].dispatchEvent(new Event('error'));
		expect(onFailure).toHaveBeenCalledExactlyOnceWith(null);
		expect(failed.workers[0].terminate).toHaveBeenCalledOnce();
	});

	test('falls back once if workers are unavailable or return malformed pixels', () => {
		const createWorker = vi.fn(() => { throw new Error('blocked'); });
		const pool = new BlurhashWorkerPool(createWorker, 8);
		pools.push(pool);
		const callback = vi.fn();
		for (let index = 0; index < 100; index++) pool.request(HASH, 32, 32, callback);
		expect(createWorker).toHaveBeenCalledOnce();
		expect(callback).toHaveBeenCalledTimes(100);
		const available = createPool(1);
		const invalid = vi.fn();
		available.pool.request(HASH, 32, 32, invalid);
		const request = available.workers[0].messages[0];
		available.workers[0].respond(request, { id: request.id, result: { width: 32, height: 32, pixels: new ArrayBuffer(1) } });
		expect(invalid).toHaveBeenCalledExactlyOnceWith(null);
	});

	test('paints latest-only at bounded size and never paints after component unmount', async () => {
		const contexts: string[] = [];
		const drawImage = vi.fn();
		vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((contextId: string) => {
			contexts.push(contextId);
			return {
				fillStyle: '', fillRect: vi.fn(), drawImage,
				createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
				putImageData: vi.fn(),
			} as unknown as CanvasRenderingContext2D;
		});
		const { pool, workers } = createPool(8);
		const hash = ref(HASH);
		const app = createApp(defineComponent({
			setup() {
				const canvas = ref<HTMLCanvasElement | null>(null);
				useBlurhash(canvas, () => ({ hash: hash.value, width: 100000, height: 1, onlyAvgColor: false }), pool);
				return () => h('canvas', { ref: canvas });
			},
		}));
		apps.push(app);
		const root = window.document.createElement('div');
		app.mount(root);
		await nextTick();
		expect(root.querySelector('canvas')?.width).toBe(64);
		expect(root.querySelector('canvas')?.height).toBe(8);
		hash.value = OTHER_HASH;
		await nextTick();
		workers[1].respond();
		expect(drawImage).toHaveBeenCalledOnce();
		workers[0].respond();
		expect(drawImage).toHaveBeenCalledOnce();
		hash.value = HASH;
		await nextTick();
		app.unmount();
		apps.splice(apps.indexOf(app), 1);
		workers[0].respond();
		expect(drawImage).toHaveBeenCalledOnce();
		expect(new Set(contexts)).toEqual(new Set(['2d']));
	});

	test('keeps the real image aspect ratio independent of bounded placeholder dimensions', async () => {
		vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
		vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
		const app = createApp(EmImgWithBlurhash, { width: 10000, height: 100 });
		apps.push(app);
		const root = window.document.createElement('div');
		app.mount(root);
		await nextTick();
		expect(root.querySelector('img')?.width).toBe(300);
		expect(root.querySelector('img')?.height).toBe(3);
		expect(root.querySelector('canvas')?.width).toBe(64);
		expect(root.querySelector('canvas')?.height).toBe(8);
	});
});
