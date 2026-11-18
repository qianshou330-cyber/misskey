<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="[privateStyle.root, privateStyle.isMe]" :data-chat-pending="item.snapshot.clientMessageId">
	<MkAvatar :class="[privateStyle.avatar, prefer.s.useStickyIcons && privateStyle.stickyAvatar]" :user="user" :link="false" :preview="false"/>
	<div :class="privateStyle.body">
		<div :class="privateStyle.header"></div>
		<MkFukidashi :class="privateStyle.bubble" tail="right" accented>
			<div v-if="item.snapshot.replyToId"><i class="ti ti-corner-up-left"></i> {{ i18n.ts._chatDaily.replyPending }}</div>
			<Mfm v-if="item.snapshot.text" class="_selectable" :text="item.snapshot.text" :i="user" :nyaize="'respect'"/>
			<div v-if="item.snapshot.attachmentIds?.length"><i class="ti ti-paperclip"></i> {{ item.snapshot.attachmentIds.length }}</div>
		</MkFukidashi>
		<div v-if="status === 'failed' && failureCode" role="alert" :class="$style.failure">
			{{ failureCode === 'CHAT_REPLY_REQUIRED' ? i18n.ts._chatPro.replyRequired : i18n.ts._chatPro.firstMessageTextOnly }}
		</div>
		<div :class="privateStyle.metadata">
			<div :class="privateStyle.details">
				<button v-if="status === 'failed'" class="_textButton" @click="emit('retry', item.snapshot.clientMessageId)">{{ failureCode ? i18n.ts._chatPro.retry : i18n.ts._chatPro.failed }}</button>
				<span v-else-if="status === 'expired'" role="alert">{{ i18n.ts._chatPro.expiredPending }}</span>
				<span v-else role="status">{{ i18n.ts._chatPro.sending }}</span>
				<button v-if="status !== 'sending'" class="_textButton" @click="emit('discard', item.snapshot.clientMessageId)">{{ i18n.ts._chatPro.discardPending }}</button>
			</div>
		</div>
	</div>
</div>
</template>

<script setup lang="ts">
import type * as Misskey from 'misskey-js';
import type { ChatOutboxItem } from '@/types/chat.js';
import MkFukidashi from '@/components/MkFukidashi.vue';
import { i18n } from '@/i18n.js';
import { prefer } from '@/preferences.js';
import privateStyle from './private-message-layout.module.scss';

defineProps<{
	item: ChatOutboxItem;
	// The outbox mutates raw items behind a shallowRef; pass status separately
	// so a failed request updates this child without changing item identity.
	status: ChatOutboxItem['status'];
	failureCode?: ChatOutboxItem['failureCode'];
	user: Misskey.entities.UserLite;
}>();

const emit = defineEmits<{
	(ev: 'retry', clientMessageId: string): void;
	(ev: 'discard', clientMessageId: string): void;
}>();
</script>

<style module lang="scss">
.failure { margin-top: 6px; font-size: 85%; color: var(--MI_THEME-fg); overflow-wrap: anywhere; }
</style>
