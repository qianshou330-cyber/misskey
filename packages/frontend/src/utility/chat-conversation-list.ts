/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

type ConversationRow = { id: string; pinnedAt: string | null; message: { id: string; createdAt: string } };

/** Pins are always fetched independently, including pins older than page one. */
export function mergeChatConversationPages<T extends ConversationRow>(previous: T[], ordinary: T[], pinned: T[], more: boolean): T[] {
	const pinIds = new Set(pinned.map(row => row.id));
	const rows = new Map((more ? previous : []).filter(row => !row.pinnedAt && !pinIds.has(row.id)).map(row => [row.id, row]));
	for (const row of ordinary) if (!pinIds.has(row.id)) rows.set(row.id, row);
	return [
		...new Map(pinned.map(row => [row.id, row])).values(),
		...[...rows.values()].sort((a, b) => b.message.createdAt.localeCompare(a.message.createdAt) || b.message.id.localeCompare(a.message.id)),
	];
}
