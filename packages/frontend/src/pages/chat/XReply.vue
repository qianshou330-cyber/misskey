<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<button type="button" :disabled="!interactive || reply.unavailable" class="_button" :class="$style.root" @click="open">
	<span :class="$style.author"><i class="ti ti-corner-up-left"></i> {{ reply.fromUserId === accountId ? i18n.ts.you : reply.fromUserId ? i18n.ts._chatDaily.otherPerson : i18n.ts._chatDaily.originalMessage }}</span>
	<span :class="$style.text">{{ reply.unavailable ? i18n.ts._chatDaily.replyUnavailable : reply.recalledAt ? i18n.ts._chatDaily.replyRecalled : reply.text }}</span>
	<span v-if="!reply.unavailable && !reply.recalledAt && reply.attachmentTypes.length" :class="$style.types">{{ reply.attachmentTypes.map(type => type === 'voice' ? i18n.ts._chatPro.voice : type === 'image' ? i18n.ts.image : i18n.ts._chatPro.protectedFile).join(' · ') }}</span>
</button>
</template>

<script setup lang="ts">
import type { ChatReply } from '@/types/chat.js';
import { i18n } from '@/i18n.js';

const props = defineProps<{ reply: ChatReply; accountId: string; interactive?: boolean }>();
const emit = defineEmits<{ (event: 'open', id: string): void }>();

function open(): void {
	if (props.interactive && !props.reply.unavailable) emit('open', props.reply.id);
}
</script>

<style module lang="scss">
.root { display: flex; flex-direction: column; gap: 4px; width: 100%; min-width: 0; box-sizing: border-box; text-align: start; padding: 8px 10px; margin-bottom: 6px; border-inline-start: 3px solid currentColor; border-radius: var(--MI-radius); background: color-mix(in srgb, var(--MI_THEME-fg) 8%, transparent); font-size: 85%; }
.root:disabled { opacity: 1; cursor: default; }
.author { font-weight: bold; }
.text { white-space: pre-wrap; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; line-clamp: 3; overflow: hidden; }
.types { opacity: .8; }
</style>
