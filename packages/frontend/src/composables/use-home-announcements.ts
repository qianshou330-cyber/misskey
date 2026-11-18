/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { onActivated, onDeactivated, onMounted, onUnmounted, shallowRef, watch } from 'vue';
import type { HomeAnnouncement } from '@/utility/home-announcements.js';
import { $i } from '@/i.js';
import { loadHomeAnnouncements } from '@/utility/home-announcements.js';
import { createMusicChartPoller } from '@/utility/music-chart-poller.js';
import { misskeyApi } from '@/utility/misskey-api.js';

/** This public feed is independent of read receipts and the logged-in user's unread announcements. */
export function useHomeAnnouncements() {
	const announcements = shallowRef<HomeAnnouncement[]>([]);
	let active = false;
	let generation = 0;
	let release: (() => void) | null = null;

	function stop(): void {
		generation++;
		release?.();
		release = null;
	}

	function start(): void {
		if (!active || release) return;
		const current = generation;
		const poller = createMusicChartPoller(
			(signal) => loadHomeAnnouncements((params, pageSignal) => misskeyApi('announcements', params, null, pageSignal), signal),
			(state) => {
				if (current === generation && state.data != null) announcements.value = state.data;
			},
		);
		release = poller.subscribe();
	}

	function activate(): void { active = true; start(); }

	function deactivate(): void { active = false; stop(); }

	// An administrative edit invalidates any older in-flight snapshot as well.
	function refresh(): void { stop(); start(); }

	watch(() => $i?.id ?? null, () => { stop(); announcements.value = []; start(); }, { flush: 'sync' });
	onMounted(activate);
	onActivated(activate);
	onDeactivated(deactivate);
	onUnmounted(deactivate);
	return { announcements, refresh };
}
