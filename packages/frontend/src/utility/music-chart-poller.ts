/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export type MusicChartPollState<T> = { data: T | null; loading: boolean; failed: boolean };

/** One bounded, visible-only request stream shared by all active homepage consumers. */
export function createMusicChartPoller<T>(
	load: (signal: AbortSignal) => Promise<T>,
	onState: (state: MusicChartPollState<T>) => void,
): { subscribe: () => () => void; refresh: () => void } {
	let subscribers = 0;
	let intervalId: number | null = null;
	let timeoutId: number | null = null;
	let request: AbortController | null = null;
	let state: MusicChartPollState<T> = { data: null, loading: false, failed: false };

	function publish(next: Partial<MusicChartPollState<T>>): void {
		state = { ...state, ...next };
		onState(state);
	}

	function abort(): void {
		const previous = request;
		request = null;
		previous?.abort();
		if (timeoutId != null) window.clearTimeout(timeoutId);
		timeoutId = null;
		if (state.loading) publish({ loading: false });
	}

	function refresh(): void {
		if (!subscribers || window.document.visibilityState !== 'visible' || request) return;
		const current = new AbortController();
		request = current;
		publish({ loading: true });
		timeoutId = window.setTimeout(() => {
			if (request !== current) return;
			abort();
			publish({ failed: true });
		}, 15_000);
		void load(current.signal).then(data => {
			if (request === current && !current.signal.aborted) publish({ data, failed: false });
		}).catch(() => {
			if (request === current && !current.signal.aborted) publish({ failed: true });
		}).finally(() => {
			if (request !== current) return;
			request = null;
			if (timeoutId != null) window.clearTimeout(timeoutId);
			timeoutId = null;
			publish({ loading: false });
		});
	}

	function stop(): void {
		if (intervalId != null) window.clearInterval(intervalId);
		intervalId = null;
		abort();
	}

	function visibilityChanged(): void {
		stop();
		if (subscribers && window.document.visibilityState === 'visible') {
			refresh();
			intervalId = window.setInterval(refresh, 60_000);
		}
	}

	function subscribe(): () => void {
		subscribers++;
		if (subscribers === 1) {
			window.document.addEventListener('visibilitychange', visibilityChanged);
			visibilityChanged();
		}
		let released = false;
		return () => {
			if (released) return;
			released = true;
			subscribers--;
			if (!subscribers) {
				window.document.removeEventListener('visibilitychange', visibilityChanged);
				stop();
			}
		};
	}

	return { subscribe, refresh };
}
