/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const ORIGIN = 'https://bolubo.com';
const LIMIT = 50 * 1024 * 1024;
const CHUNK = 65536;

type Bridge = { postMessage: (message: string) => void; onmessage: ((event: { data: string }) => void) | null };
type Reply = { v: number; id: string; type: string; seq?: number; code?: string };
export type NativeDownloadSource = { size: number; type: string; readChunk: (start: number, end: number) => Promise<Uint8Array>; release: () => void };
type ActiveTransfer = { cancel: () => void };
let active: ActiveTransfer | null = null;
const pending = new Set<AbortController>();

export function registerNativeDownloadAbort(controller: AbortController): () => void {
	pending.add(controller);
	const abort = (): void => controller.abort();
	const onStorage = (event: StorageEvent): void => { if (event.key === 'account' || event.key === null) abort(); };
	window.addEventListener('pagehide', abort);
	window.addEventListener('popstate', abort);
	window.addEventListener('storage', onStorage);
	return () => {
		pending.delete(controller);
		window.removeEventListener('pagehide', abort);
		window.removeEventListener('popstate', abort);
		window.removeEventListener('storage', onStorage);
	};
}

export class NativeDownloadError extends Error {
	constructor(public readonly code: 'cancelled' | 'busy' | 'unsupported' | 'timeout' | 'size' | 'failed') {
		super(`NATIVE_DOWNLOAD_${code}`);
	}
}

/** Called before logout/account changes and SPA navigation, before any private state survives them. */
export function cancelNativeDownload(): void {
	for (const controller of pending) controller.abort();
	active?.cancel();
}

function bridgeForPage(): Bridge | null {
	const bridge = (window as Window & { PuboNativeDownload?: Bridge }).PuboNativeDownload;
	if (!bridge || typeof bridge.postMessage !== 'function') {
		if (/\bPUBOAndroid\//.test(navigator.userAgent)) throw new NativeDownloadError('unsupported');
		return null;
	}
	if (window.location.origin !== ORIGIN || window.top !== window.self) throw new NativeDownloadError('unsupported');
	if (typeof window.crypto?.randomUUID !== 'function' || typeof Blob.prototype.arrayBuffer !== 'function') throw new NativeDownloadError('unsupported');
	return bridge;
}

/** Returns false only for normal browsers, whose existing Blob download remains unchanged. */
export async function saveNativeDownload(source: NativeDownloadSource, name: string, signal: AbortSignal, accountCurrent: () => boolean): Promise<boolean> {
	const bridge = bridgeForPage();
	if (!bridge) return false;
	if (active) throw new NativeDownloadError('busy');
	if (!Number.isSafeInteger(source.size) || source.size < 0 || source.size > LIMIT) throw new NativeDownloadError('size');
	if (signal.aborted || !accountCurrent()) { source.release(); throw new NativeDownloadError('cancelled'); }
	const id = crypto.randomUUID();
	let cancelled = false;
	let complete = false;
	let wait: { type: string; seq?: number; resolve: () => void; reject: (error: Error) => void } | null = null;
	let timer: number | undefined;
	const previousListener = bridge.onmessage;

	function post(message: Record<string, unknown>): void { bridge!.postMessage(JSON.stringify({ v: 1, id, ...message })); }

	function stopWait(error?: Error): void {
		if (timer) window.clearTimeout(timer);
		timer = undefined;
		const pending = wait;
		wait = null;
		if (error) pending?.reject(error);
		else pending?.resolve();
	}

	function cancel(): void {
		if (cancelled || complete) return;
		cancelled = true;
		try { post({ type: 'cancel' }); } catch { /* The document may already be gone. */ }
		source.release();
		stopWait(new NativeDownloadError('cancelled'));
	}

	function check(): void {
		if (signal.aborted || !accountCurrent() || window.location.origin !== ORIGIN || window.top !== window.self) cancel();
		if (cancelled) throw new NativeDownloadError('cancelled');
	}

	function request(message: Record<string, unknown>, type: string, timeout: number, seq?: number): Promise<void> {
		check();
		return new Promise((resolve, reject) => {
			wait = { type, seq, resolve, reject };
			timer = window.setTimeout(() => stopWait(new NativeDownloadError('timeout')), timeout);
			try { post(message); } catch { stopWait(new NativeDownloadError('failed')); }
		});
	}

	const transfer = { cancel };
	active = transfer;
	bridge.onmessage = event => {
		let reply: Reply;
		try { reply = JSON.parse(event.data) as Reply; } catch { return; }
		if (!reply || reply.id !== id || reply.v !== 1 || !wait) return;
		if (!accountCurrent()) { cancel(); return; }
		if (reply.type === 'cancelled') { cancel(); return; }
		if (reply.type === 'error') { stopWait(new NativeDownloadError('failed')); return; }
		if (reply.type !== wait.type || (wait.seq !== undefined && reply.seq !== wait.seq)) {
			stopWait(new NativeDownloadError('failed'));
			return;
		}
		stopWait();
	};
	const onStorage = (event: StorageEvent): void => { if (event.key === 'account' || event.key === null) cancel(); };
	signal.addEventListener('abort', cancel, { once: true });
	window.addEventListener('pagehide', cancel);
	window.addEventListener('popstate', cancel);
	window.addEventListener('storage', onStorage);
	try {
		await request({ type: 'begin', name, mime: source.type || 'application/octet-stream', size: source.size }, 'ready', 120_000);
		for (let offset = 0, seq = 0; offset < source.size; offset += CHUNK, seq++) {
			check();
			const end = Math.min(offset + CHUNK, source.size);
			const bytes = await source.readChunk(offset, end);
			try {
				check();
				if (bytes.length !== end - offset) throw new NativeDownloadError('failed');
				let binary = '';
				for (let index = 0; index < bytes.length; index += 4096) binary += String.fromCharCode(...bytes.subarray(index, index + 4096));
				const dataBase64 = btoa(binary);
				binary = '';
				await request({ type: 'chunk', seq, dataBase64 }, 'ack', 30_000, seq);
			} finally { bytes.fill(0); }
		}
		await request({ type: 'finish' }, 'complete', 120_000);
		check();
		complete = true;
		return true;
	} catch (error) {
		if (!cancelled) {
			try { post({ type: 'cancel' }); } catch { /* Best effort after a bridge failure. */ }
		}
		throw error;
	} finally {
		if (timer) window.clearTimeout(timer);
		wait = null;
		source.release();
		signal.removeEventListener('abort', cancel);
		window.removeEventListener('pagehide', cancel);
		window.removeEventListener('popstate', cancel);
		window.removeEventListener('storage', onStorage);
		bridge.onmessage = previousListener;
		if (active === transfer) active = null;
	}
}
