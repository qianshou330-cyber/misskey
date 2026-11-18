/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const stateKey = '__puboKpopSongSheet';
let nextOwner = 0;

export type KpopSheetHistoryHost = Pick<Window, 'history' | 'location' | 'addEventListener' | 'removeEventListener'>;

/** A same-URL entry lets the existing Android WebView back action close a sheet. */
export function createKpopSheetHistory(host: KpopSheetHistoryHost, changed: (open: boolean) => void) {
	const owner = `kpop-sheet-${++nextOwner}`;
	let url = '';
	let showing = false;
	let pending = false;
	let disposed = false;
	let listening = false;
	let queued: (() => void) | null = null;
	let baseState: unknown;
	let timeout: number | null = null;
	let generation = 0;

	function owns(state: unknown): boolean {
		return !!state && typeof state === 'object' && (state as Record<string, unknown>)[stateKey] === owner;
	}

	function listen(): void {
		if (listening) return;
		listening = true;
		host.addEventListener('popstate', popstate, true);
	}

	function unlisten(): void {
		if (!listening) return;
		listening = false;
		host.removeEventListener('popstate', popstate, true);
	}

	function finish(): void {
		pending = false;
		if (timeout != null) window.clearTimeout(timeout);
		timeout = null;
		unlisten();
		const next = queued;
		const current = generation;
		queued = null;
		// The router also handles popstate and replaces history.state. Resume after it.
		queueMicrotask(() => { if (!disposed && current === generation) next?.(); });
	}

	function popstate(event: PopStateEvent): void {
		// Read the event payload: the existing router replaces history.state itself.
		if (host.location.href === url && owns(event.state)) return;
		showing = false;
		changed(false);
		if (host.location.href !== url) queued = null;
		finish();
	}

	function open(): void {
		if (disposed || showing) return;
		if (pending) { queued = open; return; }
		url = host.location.href;
		baseState = host.history.state;
		const state = baseState != null && typeof baseState === 'object' ? baseState : {};
		try {
			host.history.pushState({ ...state, [stateKey]: owner }, '', url);
			listen();
		} catch {
			// Restricted history still permits a usable close button and Escape.
		}
		showing = true;
		changed(true);
	}

	function close(after?: () => void): void {
		if (disposed) return;
		generation++;
		queued = after ?? null;
		if (pending) return;
		showing = false;
		changed(false);
		if (host.location.href === url && owns(host.history.state)) {
			pending = true;
			listen();
			// Some embedded browsers can reject/throttle traversals. Never leave a
			// listener or delayed navigation alive indefinitely in that case.
			timeout = window.setTimeout(() => {
				if (host.location.href === url && owns(host.history.state)) host.history.replaceState(baseState, '', url);
				else queued = null;
				finish();
			}, 1000);
			try { host.history.back(); } catch { finish(); }
		} else {
			finish();
		}
	}

	/** Route replacement/disposal must never issue a delayed back on another page. */
	function reset(): void {
		generation++;
		queued = null;
		showing = false;
		changed(false);
		if (host.location.href === url && owns(host.history.state)) {
			try { host.history.replaceState(baseState, '', url); } catch { /* Restricted history. */ }
		}
		finish();
	}

	function dispose(): void { reset(); disposed = true; }

	return { open, close, reset, dispose, isEngaged: () => showing || pending };
}
