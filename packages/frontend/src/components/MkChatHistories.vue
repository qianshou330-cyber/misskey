<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div v-if="history.length > 0" class="_gaps_s">
	<template
		v-for="item in history"
		:key="item.id"
	>
	<div :class="$style.row" class="_panel">
	<MkA
		:class="[$style.message, { [$style.isRead]: item.unreadCount === 0 && !item.hasLegacyUnread }]"
		:to="item.message.toRoomId ? `/chat/room/${item.message.toRoomId}` : `/chat/user/${item.other!.id}`"
	>
		<MkAvatar v-if="item.message.toRoomId" :class="$style.messageAvatar" :user="item.message.fromUser" indicator :preview="false"/>
		<MkAvatar v-else-if="item.other" :class="$style.messageAvatar" :user="item.other" indicator :preview="false"/>
		<div :class="$style.messageBody">
			<header v-if="item.message.toRoom" :class="$style.messageHeader">
				<span :class="$style.messageHeaderName"><i class="ti ti-users"></i> {{ item.message.toRoom.name }}</span>
				<MkTime :time="item.message.createdAt" :class="$style.messageHeaderTime"/>
			</header>
			<header v-else :class="$style.messageHeader">
				<i v-if="item.pinnedAt" class="ti ti-pin" :class="$style.status" :title="i18n.ts._chatDaily.pinned" :aria-label="i18n.ts._chatDaily.pinned"></i>
				<i v-if="item.isMuted" class="ti ti-bell-off" :class="$style.status" :title="i18n.ts._chatDaily.muted" :aria-label="i18n.ts._chatDaily.muted"></i>
				<MkUserName :class="$style.messageHeaderName" :user="item.other!"/>
				<MkAcct :class="$style.messageHeaderUsername" :user="item.other!"/>
				<MkTime :time="item.message.createdAt" :class="$style.messageHeaderTime"/>
			</header>
			<div :class="$style.messageBodyText"><span v-if="item.isMe" :class="$style.youSaid">{{ i18n.ts.you }}:</span>{{ item.message.recalledAt ? i18n.ts._chatPro.recalled : item.message.text || (item.message.attachments?.length || item.message.file ? i18n.ts._chatPro.protectedFile : '') }}</div>
		</div>
		<span v-if="item.unreadCount > 0" :class="[$style.badge, { [$style.mutedBadge]: item.isMuted }]">{{ item.unreadCount > 99 ? '99+' : item.unreadCount }}</span>
		<span v-else-if="item.hasLegacyUnread" :class="[$style.legacy, { [$style.mutedLegacy]: item.isMuted }]" :title="i18n.ts._chatPro.unknownUnread">●</span>
	</MkA>
	<button v-if="item.other" type="button" class="_button" :class="$style.settings" :aria-label="i18n.ts._chatDaily.settings" :title="i18n.ts._chatDaily.settings" @click="showChatConversationMenu(item.other.id, $event.currentTarget)"><i class="ti ti-dots" aria-hidden="true"></i></button>
	</div>
	</template>
</div>
<MkResult v-if="!initializing && history.length == 0" type="empty" :text="i18n.ts._chat.noHistory"/>
<MkLoading v-if="initializing"/>
<button v-if="failed" type="button" class="_textButton" :disabled="fetching" @click="fetchHistory">{{ i18n.ts._chatPro.loadingFailed }}</button>
<button v-if="hasMore" type="button" class="_textButton" :disabled="fetching" @click="fetchHistory(true)">{{ i18n.ts.loadMore }}</button>
</template>

<script lang="ts" setup>
import { onActivated, onDeactivated, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import * as Misskey from 'misskey-js';
import { useInterval } from '@@/js/use-interval.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import { ensureSignin } from '@/i.js';
import type { ChatMessage } from '@/types/chat.js';
import { chatApi } from '@/utility/chat-api.js';
import { chatSummaryVersion } from '@/utility/chat-summary.js';
import { showChatConversationMenu } from '@/utility/chat-conversation-settings.js';
import { mergeChatConversationPages } from '@/utility/chat-conversation-list.js';

const $i = ensureSignin();

const history = ref<{
	id: string;
	message: ChatMessage & Pick<Misskey.entities.ChatMessage, 'fromUser' | 'toRoom'>;
	other: Misskey.entities.ChatMessage['fromUser'] | Misskey.entities.ChatMessage['toUser'] | null;
	isMe: boolean;
	unreadCount: number;
	hasLegacyUnread: boolean;
	pinnedAt: string | null;
	isMuted: boolean;
}[]>([]);

const initializing = ref(true);
const fetching = ref(false);
const failed = ref(false);
const hasMore = ref(false);
let untilId: string | undefined;
let reloadPending = false;
let disposed = false;
let controller: AbortController | undefined;

async function fetchHistory(more: boolean | unknown = false) {
	if (disposed || !isActivated) return;
	if (fetching.value) { if (more !== true) reloadPending = true; return; }

	fetching.value = true;
	controller = new AbortController();
	const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);

	try {
	const [conversations, pinned, roomMessages] = await Promise.all([
		chatApi('chat/conversations', { pinned: false, limit: 30, ...(more === true ? { untilId } : {}) }, signal),
		chatApi('chat/conversations', { pinned: true, limit: 10 }, signal),
		misskeyApi('chat/history', { room: true }, undefined, signal),
	]);
	if (disposed || signal.aborted) return;
	hasMore.value = conversations.length === 30;
	untilId = conversations.at(-1)?.lastMessage.id;
	const toRow = (conversation: typeof conversations[number]): typeof history.value[number] => ({ id: `user:${conversation.user.id}`, message: { ...conversation.lastMessage, fromUser: conversation.lastMessage.fromUserId === $i.id ? $i : conversation.user }, other: conversation.user, isMe: conversation.lastMessage.fromUserId === $i.id, unreadCount: conversation.unreadCount, hasLegacyUnread: conversation.hasLegacyUnread, pinnedAt: conversation.pinnedAt, isMuted: conversation.isMuted });
	const groupRows = roomMessages.map(m => ({ id: `room:${m.toRoomId}`, message: m, other: null, isMe: m.fromUserId === $i.id, unreadCount: 0, hasLegacyUnread: !m.isRead && m.fromUserId !== $i.id, pinnedAt: null, isMuted: false }));
	history.value = mergeChatConversationPages(history.value, [...conversations.map(toRow), ...groupRows], pinned.map(toRow), more === true);
	failed.value = false;
	} catch { if (!disposed && !controller.signal.aborted) failed.value = true; } finally {
		fetching.value = false;
		initializing.value = false;
		if (reloadPending) { reloadPending = false; void fetchHistory(); }
	}
}

let isActivated = true;

onActivated(() => {
	isActivated = true;
});

onDeactivated(() => {
	isActivated = false;
	controller?.abort();
});
onBeforeUnmount(() => { disposed = true; controller?.abort(); });

useInterval(() => {
	// TODO: DOM的にバックグラウンドになっていないかどうかも考慮する
	if (isActivated && !window.document.hidden) {
		fetchHistory();
	}
}, 1000 * 30, {
	immediate: false,
	afterMounted: true,
});

onActivated(() => {
	fetchHistory();
});

onMounted(() => {
	fetchHistory();
});
watch(chatSummaryVersion, () => { if (isActivated && !window.document.hidden) void fetchHistory(); });
</script>

<style lang="scss" module>
.badge { align-self: center; flex-shrink: 0; margin-left: 8px; padding: 3px 8px; border-radius: 20px; color: var(--MI_THEME-fgOnAccent); background: var(--MI_THEME-accent); font-size: 85%; }
.legacy { align-self: center; margin-left: 8px; color: var(--MI_THEME-accent); }
.row { display: flex; align-items: stretch; }
.status { flex-shrink: 0; margin-right: 4px; color: var(--MI_THEME-fgTransparentWeak); }
.settings { flex-shrink: 0; min-width: 44px; padding: 8px; color: var(--MI_THEME-fg); }
.mutedBadge { color: var(--MI_THEME-fg); background: var(--MI_THEME-buttonBg); }
.mutedLegacy { color: var(--MI_THEME-fgTransparentWeak); }
.message {
	position: relative;
	display: flex;
	flex: 1;
	min-width: 0;
	padding: 16px 24px;

	&.isRead,
	&.isMe {
		opacity: 0.8;
	}

}

@container (max-width: 500px) {
	.message {
		font-size: 90%;
		padding: 14px 20px;
	}
}

@container (max-width: 450px) {
	.message {
		font-size: 80%;
		padding: 12px 16px;
	}
}

.messageAvatar {
	width: 50px;
	height: 50px;
	margin: 0 16px 0 0;
}

@container (max-width: 500px) {
	.messageAvatar {
		width: 45px;
		height: 45px;
	}
}

@container (max-width: 450px) {
	.messageAvatar {
		width: 40px;
		height: 40px;
	}
}

.messageBody {
	flex: 1;
	min-width: 0;
}

.messageHeader {
	display: flex;
	align-items: center;
	margin-bottom: 2px;
	white-space: nowrap;
	overflow: clip;
}

.messageHeaderName {
	margin: 0;
	padding: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	font-size: 1em;
	font-weight: bold;
}

.messageHeaderUsername {
	margin: 0 8px;
}

.messageHeaderTime {
	margin-left: auto;
	padding-left: 6px;
	flex-shrink: 0;
}

.messageBodyText {
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	line-clamp: 2;
	min-width: 0;
	overflow: hidden;
	overflow-wrap: break-word;
	font-size: 1.1em;
}

.youSaid {
	font-weight: bold;
	margin-right: 0.5em;
}
</style>
