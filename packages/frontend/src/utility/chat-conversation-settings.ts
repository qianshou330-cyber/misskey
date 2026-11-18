/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { chatApi } from '@/utility/chat-api.js';
import { refreshChatSummary } from '@/utility/chat-summary.js';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';

export type ChatConversationSettings = { pinnedAt: string | null; isMuted: boolean };

/** Fetch at menu-open so toggles use this account's latest server setting. */
export async function showChatConversationMenu(userId: string, anchor?: HTMLElement | EventTarget | null, changed?: (settings: ChatConversationSettings) => void): Promise<void> {
	const accountId = $i?.id;
	if (!accountId) return;
	try {
		const settings = await chatApi('chat/conversation-settings/show', { userId }, AbortSignal.timeout(15_000));
		if ($i?.id !== accountId) return;
		const update = async (patch: { pinned?: boolean; isMuted?: boolean }): Promise<void> => {
			if ($i?.id !== accountId) return;
			try {
				const result = await chatApi('chat/conversation-settings/update', { userId, ...patch }, AbortSignal.timeout(15_000));
				if ($i?.id !== accountId) return;
				changed?.(result);
				void refreshChatSummary();
			} catch (error) {
				if ($i?.id !== accountId) return;
				const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
				void os.alert({ type: 'error', text: code === 'CHAT_PIN_LIMIT' ? i18n.ts._chatDaily.pinLimit : code === 'NO_SUCH_CHAT_CONVERSATION' ? i18n.ts._chatDaily.pinNeedsHistory : i18n.ts._chatDaily.settingsFailed });
			}
		};
		os.popupMenu([
			{ text: settings.pinnedAt ? i18n.ts._chatDaily.unpin : i18n.ts._chatDaily.pin, icon: settings.pinnedAt ? 'ti ti-pinned-off' : 'ti ti-pin', action: () => { void update({ pinned: !settings.pinnedAt }); } },
			{ text: settings.isMuted ? i18n.ts._chatDaily.unmute : i18n.ts._chatDaily.mute, icon: settings.isMuted ? 'ti ti-bell' : 'ti ti-bell-off', action: () => { void update({ isMuted: !settings.isMuted }); } },
		], anchor);
	} catch {
		if ($i?.id === accountId) void os.alert({ type: 'error', text: i18n.ts._chatDaily.settingsFailed });
	}
}
