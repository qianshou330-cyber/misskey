/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Endpoints } from 'misskey-js';

export type HomeAnnouncement = Endpoints['announcements']['res'][number];
type LoadPage = (params: Endpoints['announcements']['req'], signal: AbortSignal) => Promise<HomeAnnouncement[]>;

/** Publish a complete snapshot only; a failed later page must not erase earlier announcements. */
export async function loadHomeAnnouncements(loadPage: LoadPage, signal: AbortSignal): Promise<HomeAnnouncement[]> {
	const entries = new Map<string, HomeAnnouncement>();
	const cursors = new Set<string>();
	let untilId: string | undefined;
	while (true) {
		signal.throwIfAborted();
		const page = await loadPage({ display: 'marquee', isActive: true, limit: 100, ...(untilId ? { untilId } : {}) }, signal);
		signal.throwIfAborted();
		for (const entry of page) {
			// Defense in depth: the endpoint owns active/global filtering; never include a targeted item.
			if (entry.display === 'marquee' && !entry.forYou && !entries.has(entry.id)) entries.set(entry.id, entry);
		}
		if (page.length < 100) break;
		untilId = page[page.length - 1].id;
		if (cursors.has(untilId)) throw new Error('Announcement pagination did not advance');
		cursors.add(untilId);
	}
	return [...entries.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}
