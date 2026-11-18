<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="[$style.root, { [$style.isMe]: isMe }, privateLayout && [privateStyle.root, { [privateStyle.isMe]: isMe }]]" :data-chat-readable="message.id">
	<MkAvatar :class="[$style.avatar, prefer.s.useStickyIcons ? $style.useSticky : null, privateLayout && privateStyle.avatar]" :user="message.fromUser!" :link="!isMe" :preview="false"/>
	<div :class="[$style.body, message.file != null ? $style.fullWidth : null, privateLayout && privateStyle.body]" @contextmenu.stop="onContextmenu">
		<div :class="[$style.header, privateLayout && privateStyle.header]"><MkUserName v-if="!isMe && prefer.s['chat.showSenderName'] && message.fromUser != null" :user="message.fromUser"/></div>
		<MkFukidashi :class="[$style.fukidashi, privateLayout && privateStyle.bubble]" :tail="isMe ? 'right' : 'left'" :fullWidth="message.file != null" :accented="isMe">
			<XReply v-if="message.replyTo && !message.recalledAt" :reply="message.replyTo" :accountId="$i.id" :interactive="privateLayout" @open="emit('openReply', $event)"/>
			<div v-if="message.recalledAt" role="status">{{ i18n.ts._chatPro.recalled }}</div>
			<div v-else-if="editing" class="_gaps_s">
				<textarea v-model="editText" :class="$style.editInput" :aria-label="i18n.ts._chatPro.editMessage" :disabled="saving"></textarea>
				<div class="_buttons"><button class="_textButton" :disabled="saving || !editText.trim()" @click="saveEdit">{{ i18n.ts.save }}</button><button class="_textButton" :disabled="saving" @click="editing = false">{{ i18n.ts.cancel }}</button></div>
				<div v-if="editError" role="alert">{{ editError }}</div>
			</div>
			<Mfm
				v-else-if="message.text && !message.privateAttachmentFallback"
				ref="text"
				class="_selectable"
				:text="message.text"
				:i="$i"
				:nyaize="'respect'"
				:enableEmojiMenu="true"
				:enableEmojiMenuReaction="true"
			/>
			<MkMediaList v-if="message.file && !message.recalledAt" :mediaList="[message.file]" :user="message.fromUser"/>
			<div v-if="message.attachments?.length && !message.recalledAt" class="_gaps_s"><XAttachment v-for="attachment in message.attachments" :key="attachment.id" :attachment="attachment"/></div>
		</MkFukidashi>
		<MkUrlPreview v-for="url in urls" :key="url" :url="url" style="margin: 8px 0;"/>
		<div v-if="privateLayout" :class="privateStyle.metadata">
			<button class="_textButton" :class="privateStyle.menu" :aria-label="i18n.ts.more" @click="showMenu"><i class="ti ti-dots-circle-horizontal"></i></button>
			<div :class="privateStyle.details">
				<MkTime :class="$style.time" :time="message.createdAt"/>
				<span v-if="message.editedAt && !message.recalledAt">{{ i18n.ts._chatPro.edited }}</span>
				<span v-if="isMe && message.toUserId && !message.recalledAt" :title="message.readState === 'unknown' ? i18n.ts._chatPro.unknownRead : undefined">{{ message.readAt ? i18n.ts._chatPro.read : i18n.ts._chatPro.sent }}</span>
			</div>
		</div>
		<div v-else :class="$style.footer">
			<button class="_textButton" style="color: currentColor;" :aria-label="i18n.ts.more" @click="showMenu"><i class="ti ti-dots-circle-horizontal"></i></button>
			<MkTime :class="$style.time" :time="message.createdAt"/>
			<span v-if="message.editedAt && !message.recalledAt">{{ i18n.ts._chatPro.edited }}</span>
			<span v-if="isMe && message.toUserId && !message.recalledAt" :title="message.readState === 'unknown' ? i18n.ts._chatPro.unknownRead : undefined">{{ message.readAt ? i18n.ts._chatPro.read : i18n.ts._chatPro.sent }}</span>
			<MkA v-if="isSearchResult && 'toRoom' in message && message.toRoom != null" :to="`/chat/room/${message.toRoomId}`">{{ message.toRoom.name }}</MkA>
			<MkA v-if="isSearchResult && 'toUser' in message && message.toUser != null && isMe" :to="`/chat/user/${message.toUserId}`">@{{ message.toUser.username }}</MkA>
		</div>
		<TransitionGroup
			v-if="!message.recalledAt"
			:enterActiveClass="prefer.s.animation ? $style.transition_reaction_enterActive : ''"
			:leaveActiveClass="prefer.s.animation ? $style.transition_reaction_leaveActive : ''"
			:enterFromClass="prefer.s.animation ? $style.transition_reaction_enterFrom : ''"
			:leaveToClass="prefer.s.animation ? $style.transition_reaction_leaveTo : ''"
			:moveClass="prefer.s.animation ? $style.transition_reaction_move : ''"
			tag="div" :class="$style.reactions"
		>
			<button v-for="record in message.reactions" :key="record.reaction + record.user.id" class="_button" :aria-label="record.reaction" :aria-pressed="record.user.id === $i.id" :class="[$style.reaction, record.user.id === $i.id ? $style.reactionMy : null]" @click="onReactionClick(record)">
				<MkAvatar :user="record.user" :link="false" :class="$style.reactionAvatar"/>
				<MkReactionIcon
					:withTooltip="true"
					:reaction="record.reaction.replace(/^:(\w+):$/, ':$1@.:')"
					:noStyle="true"
					:class="$style.reactionIcon"
				/>
			</button>
		</TransitionGroup>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, provide, ref } from 'vue';
import * as mfm from 'mfm-js';
import * as Misskey from 'misskey-js';
import { url } from '@@/js/config.js';
import { isLink } from '@@/js/is-link.js';
import type { MenuItem } from '@/types/menu.js';
import type { NormalizedChatMessage } from './room.vue';
import { extractUrlFromMfm } from '@/utility/extract-url-from-mfm.js';
import MkUrlPreview from '@/components/MkUrlPreview.vue';
import { ensureSignin } from '@/i.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import MkFukidashi from '@/components/MkFukidashi.vue';
import * as os from '@/os.js';
import { copyToClipboard } from '@/utility/copy-to-clipboard.js';
import MkMediaList from '@/components/MkMediaList.vue';
import { reactionPicker } from '@/utility/reaction-picker.js';
import * as sound from '@/utility/sound.js';
import MkReactionIcon from '@/components/MkReactionIcon.vue';
import { prefer } from '@/preferences.js';
import { DI } from '@/di.js';
import { getHTMLElementOrNull } from '@/utility/get-dom-node-or-null.js';
import type { ChatMessage } from '@/types/chat.js';
import { chatApi } from '@/utility/chat-api.js';
import { mergeChatMessage } from '@/utility/chat-state.js';
import XAttachment from './XAttachment.vue';
import XReply from './XReply.vue';
import privateStyle from './private-message-layout.module.scss';

const $i = ensureSignin();

const props = withDefaults(defineProps<{
	message: NormalizedChatMessage | Misskey.entities.ChatMessage;
	isSearchResult?: boolean;
	privateLayout?: boolean;
}>(), { privateLayout: false });

const emit = defineEmits<{
	(event: 'updated', message: ChatMessage): void;
	(event: 'reply', message: ChatMessage): void;
	(event: 'openReply', id: string): void;
}>();
const localMessage = ref<ChatMessage>();
const message = computed(() => {
	const state = mergeChatMessage(localMessage.value, props.message);
	return { ...props.message, ...state, fromUser: state.fromUser ?? props.message.fromUser, reactions: state.reactions.flatMap(record => {
		const user = record.user ?? props.message.reactions.find(previous => previous.reaction === record.reaction)?.user;
		return user ? [{ ...record, user }] : [];
	}) };
});
const isMe = computed(() => message.value.fromUserId === $i.id);
const urls = computed(() => !message.value.recalledAt && message.value.text ? extractUrlFromMfm(mfm.parse(message.value.text)) : []);
const editing = ref(false);
const editText = ref('');
const editRevision = ref(0);
const editError = ref('');
const saving = ref(false);

function applyUpdate(updated: ChatMessage): void {
	const next = mergeChatMessage<ChatMessage>(message.value, updated);
	localMessage.value = next;
	emit('updated', next);
}

async function saveEdit(): Promise<void> {
	if (saving.value) return;
	saving.value = true;
	editError.value = '';
	try {
		applyUpdate(await chatApi('chat/messages/update', { messageId: message.value.id, text: editText.value, expectedRevision: editRevision.value }));
		editing.value = false;
	} catch {
		editError.value = i18n.ts._chatPro.editConflict;
		const userId = isMe.value ? message.value.toUserId : message.value.fromUserId;
		if (userId) {
			try {
				const state = await chatApi('chat/messages/state', { userId, messageIds: [message.value.id] });
				if (state.messages[0]) applyUpdate(state.messages[0]);
			} catch { /* Keep the user's editing draft on a network failure. */ }
		}
	} finally { saving.value = false; }
}

provide(DI.mfmEmojiReactCallback, (reaction) => {
	if ($i.policies.chatAvailability !== 'available') return;

	sound.playMisskeySfx('reaction');
	misskeyApi('chat/messages/react', {
		messageId: props.message.id,
		reaction: reaction,
	});
});

function react(ev: PointerEvent) {
	if ($i.policies.chatAvailability !== 'available') return;

	const targetEl = getHTMLElementOrNull(ev.currentTarget ?? ev.target);
	if (!targetEl) return;

	reactionPicker.show(targetEl, null, async (reaction) => {
		sound.playMisskeySfx('reaction');
		misskeyApi('chat/messages/react', {
			messageId: props.message.id,
			reaction: reaction,
		});
	});
}

function onReactionClick(record: Misskey.entities.ChatMessage['reactions'][0]) {
	if ($i.policies.chatAvailability !== 'available') return;

	if (record.user.id === $i.id) {
		misskeyApi('chat/messages/unreact', {
			messageId: props.message.id,
			reaction: record.reaction,
		});
	} else {
		if (!props.message.reactions.some(r => r.user.id === $i.id && r.reaction === record.reaction)) {
			sound.playMisskeySfx('reaction');
			misskeyApi('chat/messages/react', {
				messageId: props.message.id,
				reaction: record.reaction,
			});
		}
	}
}

function onContextmenu(ev: PointerEvent) {
	if (ev.target && isLink(ev.target as HTMLElement)) return;
	if (window.getSelection()?.toString() !== '') return;

	showMenu(ev, true);
}

function showMenu(ev: PointerEvent, contextmenu = false) {
	const menu: MenuItem[] = [];
	if (message.value.recalledAt) return;
	if (props.privateLayout && message.value.toUserId && $i.policies.chatAvailability === 'available') {
		menu.push({ text: i18n.ts._chatDaily.reply, icon: 'ti ti-corner-up-left', action: () => emit('reply', message.value) });
	}
	if (isMe.value && message.value.toUserId && message.value.text && !message.value.privateAttachmentFallback && Date.now() - new Date(message.value.createdAt).getTime() < 86_400_000 && $i.policies.chatAvailability === 'available') {
		menu.push({ text: i18n.ts._chatPro.editMessage, icon: 'ti ti-pencil', action: () => { editText.value = message.value.text ?? ''; editRevision.value = message.value.revision ?? 0; editError.value = ''; editing.value = true; } });
	}

	if (!isMe.value && $i.policies.chatAvailability === 'available') {
		menu.push({
			text: i18n.ts.reaction,
			icon: 'ti ti-mood-plus',
			action: (ev) => {
				react(ev);
			},
		});

		menu.push({
			type: 'divider',
		});
	}

	menu.push({
		text: i18n.ts.copyContent,
		icon: 'ti ti-copy',
		action: () => {
			copyToClipboard(props.message.text ?? '');
		},
	});

	menu.push({
		type: 'divider',
	});

	if (isMe.value && $i.policies.chatAvailability === 'available') {
		menu.push({
			text: message.value.toUserId ? i18n.ts._chatPro.recall : i18n.ts.delete,
			icon: 'ti ti-trash',
			danger: true,
			action: async () => {
				if (message.value.toUserId && (await os.confirm({ type: 'warning', text: i18n.ts._chatPro.recallConfirm })).canceled) return;
				await os.apiWithDialog('chat/messages/delete', { messageId: message.value.id });
				if (message.value.toUserId) {
					const state = await chatApi('chat/messages/state', { userId: message.value.toUserId, messageIds: [message.value.id] });
					if (state.messages[0]) applyUpdate(state.messages[0]);
				}
			},
		});
	}

	if (!isMe.value && props.message.fromUser != null) {
		menu.push({
			text: i18n.ts.reportAbuse,
			icon: 'ti ti-exclamation-circle',
			action: async () => {
				const localUrl = `${url}/chat/messages/${props.message.id}`;
				const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkAbuseReportWindow.vue').then(x => x.default), {
					user: props.message.fromUser!,
					initialComment: `${localUrl}\n-----\n`,
				}, {
					closed: () => dispose(),
				});
			},
		});
	}

	if (contextmenu) {
		os.contextMenu(menu, ev);
	} else {
		os.popupMenu(menu, ev.currentTarget ?? ev.target);
	}
}
</script>

<style lang="scss" module>
.transition_reaction_move,
.transition_reaction_enterActive,
.transition_reaction_leaveActive {
	transition: opacity 0.2s cubic-bezier(0,.5,.5,1), transform 0.2s cubic-bezier(0,.5,.5,1) !important;
}
.transition_reaction_enterFrom,
.transition_reaction_leaveTo {
	opacity: 0;
	transform: scale(0.7);
}
.transition_reaction_leaveActive {
	position: absolute;
}

.root {
	position: relative;
	display: flex;

	&.isMe {
		flex-direction: row-reverse;
		text-align: right;

		.footer {
			flex-direction: row-reverse;
		}
	}
}

.avatar {
	display: block;
	width: 50px;
	height: 50px;

	&.useSticky {
		position: sticky;
		top: calc(16px + var(--MI-stickyTop, 0px));
	}
}

@container (max-width: 450px) {
	.root {
		&.isMe {
			.avatar {
				display: none;
			}
		}
	}

	.avatar {
		width: 42px;
		height: 42px;
	}

	.fukidashi {
		font-size: 90%;
	}
}

.body {
	min-width: 0;
	max-width: calc(100% - 70px);
	margin: 0 12px;

	&.fullWidth {
		width: 100%;
	}
}

.header {
	min-height: 4px; // fukidashiの位置調整も兼ねるため
	font-size: 80%;
}

.fukidashi {
	text-align: left;
	overflow-wrap: anywhere;
}

.editInput { box-sizing: border-box; width: 100%; min-height: 80px; font: inherit; color: var(--MI_THEME-fg); background: var(--MI_THEME-panel); border: 1px solid var(--MI_THEME-divider); border-radius: 8px; padding: 8px; }

.content {
	overflow: clip;
	overflow-wrap: break-word;
	word-break: break-word;
}

.footer {
	display: flex;
	flex-direction: row;
	gap: 0.5em;
	margin-top: 4px;
	font-size: 75%;
}

.time {
	opacity: 0.5;
}

.reactions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
	margin-top: 8px;

	&:empty {
		display: none;
	}
}

.reaction {
	display: flex;
	align-items: center;
	border: solid 1px var(--MI_THEME-divider);
	border-radius: 999px;
	padding: 8px;

	&.reactionMy {
		border-color: var(--MI_THEME-accent);
	}
}

.reactionAvatar {
	width: 24px;
	height: 24px;
	margin-right: 8px;
}

.reactionIcon {
	width: 24px;
	height: 24px;
}
</style>
