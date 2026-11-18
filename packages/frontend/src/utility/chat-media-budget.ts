/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

type Reservation = { complete: (actualBytes: number) => void; release: () => void };
type Waiting = { bytes: number; signal?: AbortSignal; abort: () => void; resolve: (reservation: Reservation) => void; reject: (error: unknown) => void };

/** Counts reserved payload bytes until the consumer releases its Blob lease. */
export class ChatMediaBudget {
	public activeRequests = 0;
	public retainedBytes = 0;
	private waiting: Waiting[] = [];
	public constructor(public readonly maxRequests: number, public readonly maxBytes: number, public readonly maxWaiting = 32) {}
	public get pendingRequests(): number { return this.waiting.length; }
	public acquire(bytes: number, signal?: AbortSignal): Promise<Reservation> {
		if (signal?.aborted) return Promise.reject(signal.reason);
		if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.maxBytes) return Promise.reject(new Error('CHAT_MEDIA_BUDGET'));
		if (this.activeRequests < this.maxRequests) {
			try { return Promise.resolve(this.reserve(bytes)); } catch (error) { return Promise.reject(error); }
		}
		if (this.waiting.length >= this.maxWaiting) return Promise.reject(new Error('CHAT_MEDIA_BUDGET'));
		return new Promise((resolve, reject) => {
			const pending: Waiting = { bytes, signal, resolve, reject, abort: () => {
				const index = this.waiting.indexOf(pending);
				if (index >= 0) this.waiting.splice(index, 1);
				reject(signal?.reason);
			} };
			signal?.addEventListener('abort', pending.abort, { once: true });
			this.waiting.push(pending);
		});
	}
	private drain(): void {
		while (this.waiting.length && this.activeRequests < this.maxRequests) {
			const pending = this.waiting.shift()!;
			pending.signal?.removeEventListener('abort', pending.abort);
			if (pending.signal?.aborted) { pending.reject(pending.signal.reason); continue; }
			try { pending.resolve(this.reserve(pending.bytes)); } catch (error) { pending.reject(error); }
		}
	}
	public reserve(bytes: number): Reservation {
		if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.maxBytes) throw new Error('CHAT_MEDIA_BUDGET');
		if (this.activeRequests >= this.maxRequests || this.retainedBytes + bytes > this.maxBytes) throw new Error('CHAT_MEDIA_BUDGET');
		this.activeRequests++;
		this.retainedBytes += bytes;
		let retained = bytes;
		let fetching = true;
		let released = false;
		return {
			complete: actualBytes => {
				if (released || !fetching) return;
				if (!Number.isSafeInteger(actualBytes) || actualBytes < 0 || actualBytes > retained) throw new Error('CHAT_MEDIA_BUDGET');
				this.retainedBytes -= retained - actualBytes;
				retained = actualBytes;
				fetching = false;
				this.activeRequests--;
				this.drain();
			},
			release: () => {
				if (released) return;
				released = true;
				this.retainedBytes -= retained;
				if (fetching) this.activeRequests--;
				this.drain();
			},
		};
	}
}
