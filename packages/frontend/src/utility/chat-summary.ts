/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ref } from 'vue';
import { chatApi } from '@/utility/chat-api.js';
import { updateCurrentAccountPartial } from '@/accounts.js';
import { $i } from '@/i.js';

export const chatUnreadCount = ref<number | null>(null);
// The profile boolean is deliberately a raw unread signal. Never use it for
// the notification badge before this account's mute-aware summary arrives.
export const chatHasNotificationUnread = ref(false);
export const chatSummaryVersion = ref(0);
let fetching = false;
let invalidated = false;

export async function refreshChatSummary(): Promise<void> {
	chatSummaryVersion.value++;
	if (!$i || $i.policies.chatAvailability === 'unavailable' || window.document.hidden) return;
	if (fetching) { invalidated = true; return; }
	fetching = true;
	const accountId = $i.id;
	try {
		const summary = await chatApi('chat/unread-summary', {});
		if ($i?.id !== accountId) return;
		chatUnreadCount.value = summary.notificationUnreadCount;
		chatHasNotificationUnread.value = summary.notificationUnreadCount > 0 || summary.hasNotificationLegacyUnread || summary.hasUnreadRoom;
		updateCurrentAccountPartial({ hasUnreadChatMessages: chatHasNotificationUnread.value });
	} catch { /* Preserve the last authoritative indicator during network failure. */ } finally {
		fetching = false;
		if (invalidated) { invalidated = false; void refreshChatSummary(); }
	}
}
