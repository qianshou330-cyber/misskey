/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { BLURHASH_DECODE_EDGE, getBlurhashSize, isValidBlurhash } from './blurhash.js';
import type { BlurhashPixels, BlurhashRequest, BlurhashResponse } from './blurhash.js';

const MAX_QUEUE = 64;
const JOB_TIMEOUT = 5000;
type Task = { request: BlurhashRequest; callback: ((result: BlurhashPixels | null) => void) | null };
type Slot = {
	worker: Worker;
	task: Task | null;
	timeout: ReturnType<(typeof globalThis)['setTimeout']> | null;
	onMessage: (event: MessageEvent<BlurhashResponse>) => void;
	onError: () => void;
};

/** A shared bounded pool, with exactly one outstanding message per worker. */
export class BlurhashWorkerPool {
	private slots: Slot[] = [];
	private queue: Task[] = [];
	private initialized = false;
	private nextId = 0;
	private readonly concurrency: number;

	constructor(private readonly createWorker: () => Worker, hardwareConcurrency = globalThis.navigator?.hardwareConcurrency) {
		this.concurrency = Number.isFinite(hardwareConcurrency) && hardwareConcurrency > 2 ? 2 : 1;
	}

	public request(hash: string, width: number, height: number, callback: (result: BlurhashPixels | null) => void): () => void {
		const size = getBlurhashSize(width, height, BLURHASH_DECODE_EDGE);
		if (!size || !isValidBlurhash(hash)) {
			callback(null);
			return () => {};
		}
		this.initialize();
		if (this.slots.length === 0) {
			callback(null);
			return () => {};
		}
		const task: Task = { request: { id: ++this.nextId, hash, ...size }, callback };
		if (this.queue.length >= MAX_QUEUE) this.complete(this.queue.shift()!, null);
		this.queue.push(task);
		this.pump();
		return () => {
			// An active decode is tiny and cannot be interrupted. Drop its closure
			// immediately and discard its eventual result; queued work is removed.
			task.callback = null;
			const index = this.queue.indexOf(task);
			if (index >= 0) this.queue.splice(index, 1);
		};
	}

	public dispose(): void {
		this.initialized = true;
		for (const task of this.queue.splice(0)) task.callback = null;
		for (const slot of [...this.slots]) {
			if (slot.task) slot.task.callback = null;
			this.retire(slot);
		}
	}

	private initialize(): void {
		if (this.initialized) return;
		this.initialized = true;
		for (let index = 0; index < this.concurrency; index++) {
			try {
				const worker = this.createWorker();
				const slot: Slot = {
					worker,
					task: null,
					timeout: null,
					onMessage: event => this.receive(slot, event.data),
					onError: () => this.retire(slot),
				};
				worker.addEventListener('message', slot.onMessage);
				worker.addEventListener('error', slot.onError);
				worker.addEventListener('messageerror', slot.onError);
				this.slots.push(slot);
			} catch {
				// Worker creation may be blocked or unavailable. Keep the average
				// color and never retry creation for every newly mounted image.
				break;
			}
		}
	}

	private complete(task: Task, result: BlurhashPixels | null): void {
		const callback = task.callback;
		task.callback = null;
		callback?.(result);
	}

	private receive(slot: Slot, response: BlurhashResponse): void {
		const task = slot.task;
		if (!task || response?.id !== task.request.id) return;
		if (slot.timeout !== null) globalThis.clearTimeout(slot.timeout);
		slot.timeout = null;
		slot.task = null;
		const result = response.result;
		const valid = result && result.width === task.request.width && result.height === task.request.height
			&& result.pixels instanceof ArrayBuffer && result.pixels.byteLength === result.width * result.height * 4;
		try {
			this.complete(task, valid ? result : null);
		} finally {
			this.pump();
		}
	}

	private pump(): void {
		for (const slot of [...this.slots]) {
			if (slot.task || this.queue.length === 0) continue;
			const task = this.queue.shift()!;
			slot.task = task;
			slot.timeout = globalThis.setTimeout(() => this.retire(slot), JOB_TIMEOUT);
			try {
				slot.worker.postMessage(task.request);
			} catch {
				this.retire(slot);
			}
		}
	}

	private retire(slot: Slot): void {
		const index = this.slots.indexOf(slot);
		if (index < 0) return;
		this.slots.splice(index, 1);
		if (slot.timeout !== null) globalThis.clearTimeout(slot.timeout);
		slot.worker.removeEventListener('message', slot.onMessage);
		slot.worker.removeEventListener('error', slot.onError);
		slot.worker.removeEventListener('messageerror', slot.onError);
		slot.worker.terminate();
		const task = slot.task;
		slot.task = null;
		if (task) this.complete(task, null);
		if (this.slots.length === 0) {
			for (const pending of this.queue.splice(0)) this.complete(pending, null);
		} else {
			this.pump();
		}
	}
}
