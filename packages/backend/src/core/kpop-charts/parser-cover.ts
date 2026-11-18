/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** Retain the source image URL without inventing paths or changing its size. */
export function normalizeAlbumCoverUrl(value: unknown): string | null {
	if (typeof value !== 'string' || !value || /[\u0000-\u0020\u007f\\]/u.test(value)) return null;
	try {
		const sourceUrl = value.startsWith('//') ? `https:${value}` : value;
		const url = new URL(sourceUrl);
		if (url.protocol !== 'https:' || url.hostname !== 'cdnimg.melon.co.kr' || url.username || url.password || url.port) return null;
		return sourceUrl;
	} catch {
		return null;
	}
}
