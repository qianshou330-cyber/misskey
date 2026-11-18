<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.shell">
	<aside :class="$style.sidebar">
		<MkA to="/chat" :class="$style.sidebarTitle">{{ i18n.ts.directMessage }}</MkA>
		<MkA to="/chat/contacts" :class="$style.sidebarTitle"><i class="ti ti-users"></i> {{ i18n.ts._chatPro.contacts }}</MkA>
		<MkChatHistories/>
	</aside>
	<div :class="$style.root">
		<PageWithHeader v-model:tab="tab" :class="$style.conversation" :reversed="tab === 'chat'" :tabs="tabs" :leadingActions="leadingActions" :actions="actions">
			<div v-if="tab === 'search'" class="_spacer"><XSearch :userId="userId"/></div>
			<div v-else class="_spacer" style="--MI_SPACER-w: 700px;">
				<div v-if="error" role="alert" class="_gaps"><MkInfo warn>{{ i18n.ts._chatPro.loadingFailed }}</MkInfo><MkButton @click="synchronize">{{ i18n.ts._chatPro.retry }}</MkButton></div>
				<MkLoading v-if="!initialized && !error"/>
					<div v-else ref="timelineEl" :class="$style.messages" aria-live="polite">
					<MkButton v-if="hasOlder" :wait="paging" rounded :class="$style.more" @click="loadPage(true)">{{ i18n.ts.loadMore }}</MkButton>
					<MkInfo v-if="!messages.length && initialized">{{ i18n.ts._chat.noMessagesYet }}</MkInfo>
					<TransitionGroup :enterActiveClass="prefer.s.animation ? $style.enter : ''" :enterFromClass="prefer.s.animation ? $style.enterFrom : ''" tag="div" :class="$style.messages" @leave="finishRemoval">
						<template v-for="item in timeline.toReversed()" :key="item.id">
							<MkVirtualTimelineItem v-if="item.type === 'item'" data-timeline-row :data-scroll-anchor="item.id" :class="{ [$style.highlighted]: highlightedId === item.id }">
								<XMessage v-if="active" :message="normalize(item.data)" privateLayout @updated="onUpdated" @reply="selectReply" @openReply="openContext"/>
							</MkVirtualTimelineItem>
							<div v-else :class="$style.date">{{ item.prevText }} · {{ item.nextText }}</div>
						</template>
					</TransitionGroup>
					<MkButton v-if="hasNewer" :wait="paging" rounded :class="$style.more" @click="loadPage(false)">{{ i18n.ts._chatPro.loadNewer }}</MkButton>
					<XPendingMessage v-for="item in outboxItems" :key="item.snapshot.clientMessageId" :item="item" :status="item.status" :failureCode="item.failureCode" :user="$i" @retry="outbox.queue.retry($event)" @discard="discardPending"/>
				</div>
			</div>
		</PageWithHeader>
		<footer v-if="tab === 'chat'" ref="footerEl" :class="$style.footer">
			<MkInfo v-if="user && (!user.canChat || user.host !== null)" warn>{{ i18n.ts._chat.chatNotAvailableInOtherAccount }}</MkInfo>
			<MkInfo v-if="$i.policies.chatAvailability !== 'available'" warn>{{ $i.policies.chatAvailability === 'readonly' ? i18n.ts._chat.chatIsReadOnlyForThisAccountOrServer : i18n.ts._chat.chatNotAvailableForThisAccountOrServer }}</MkInfo>
			<div v-if="!connected || syncing" role="status" :class="$style.status">{{ !connected ? i18n.ts._chatPro.reconnecting : i18n.ts._chatPro.syncing }}</div>
			<div v-if="contextMode" :class="$style.status" role="status">{{ i18n.ts._chatDaily.contextViewing }}</div>
			<div v-if="contextError" role="alert" :class="$style.status">{{ i18n.ts._chatDaily.contextFailed }}</div>
			<MkButton v-if="newMessages || hasNewer || contextMode" rounded :class="$style.more" @click="jumpToLatest">{{ i18n.ts._chatPro.newest }}</MkButton>
			<XForm v-if="user && active" v-model:reply="selectedReply" :user="user" :class="$style.form" @beforeResize="scrollPosition?.beforeResize()" @afterResize="scrollPosition?.afterResize()"/>
		</footer>
	</div>
</div>
</template>

<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, provide, ref, useTemplateRef, watch } from 'vue';
import * as Misskey from 'misskey-js';
import { getScrollContainer } from '@@/js/scroll.js';
import XMessage from './XMessage.vue';
import XPendingMessage from './XPendingMessage.vue';
import XForm from './room.form.vue';
import XSearch from './room.search.vue';
import type { ChatMessage, ChatReply } from '@/types/chat.js';
import type { NormalizedChatMessage } from './room.vue';
import { ensureSignin } from '@/i.js';
import { i18n } from '@/i18n.js';
import { prefer } from '@/preferences.js';
import { definePage } from '@/page.js';
import { useRouter } from '@/router.js';
import { useStream } from '@/stream.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { chatApi } from '@/utility/chat-api.js';
import { mergeChatMessage, mergeChatWindow } from '@/utility/chat-state.js';
import { chatReferenceIds, chatReplySummary, isPrivateChatMessage, reconcileChatReplies, unavailableChatReply } from '@/utility/chat-replies.js';
import { showChatConversationMenu } from '@/utility/chat-conversation-settings.js';
import { useChatRead } from '@/composables/use-chat-read.js';
import { useChatOutbox } from '@/composables/use-chat-outbox.js';
import { TimelineViewport, timelineViewportKey } from '@/utility/timeline-viewport.js';
import { captureTimelineAnchor, restoreTimelineAnchor } from '@/utility/timeline-window.js';
import { ChatScrollPosition } from '@/utility/chat-scroll-position.js';
import { makeDateSeparatedTimelineComputedRef } from '@/utility/timeline-date-separate.js';
import MkVirtualTimelineItem from '@/components/MkVirtualTimelineItem.vue';
import MkChatHistories from '@/components/MkChatHistories.vue';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';

const props = defineProps<{ userId: string }>();
const $i = ensureSignin();
const router = useRouter();
const stream = useStream();
const user = ref<Misskey.entities.UserDetailed>();
const messages = ref<ChatMessage[]>([]);
const selectedReply = ref<ChatReply | null>(null);
const contextMode = ref(false);
const contextError = ref(false);
const highlightedId = ref<string | null>(null);
const timeline = makeDateSeparatedTimelineComputedRef(messages);
const initialized = ref(false);
const syncing = ref(false);
const connected = ref(stream.state === 'connected');
const error = ref(false);
const paging = ref(false);
const hasOlder = ref(false);
const hasNewer = ref(false);
const newMessages = ref(false);
const tab = ref('chat');
const active = ref(true);
const timelineEl = useTemplateRef('timelineEl');
const footerEl = useTemplateRef('footerEl');
let scrollPosition: ChatScrollPosition | undefined;
watch([timelineEl, footerEl, active, tab], () => {
	scrollPosition?.dispose();
	scrollPosition = undefined;
	const root = timelineEl.value;
	const container = root ? getScrollContainer(root) : null;
	if (root && container && footerEl.value && active.value && tab.value === 'chat') {
		scrollPosition = new ChatScrollPosition(root, container, footerEl.value, () => hasNewer.value || contextMode.value);
	}
}, { flush: 'post' });
const viewport = new TimelineViewport();
provide(timelineViewportKey, viewport);
const outbox = useChatOutbox($i.id, props.userId);
const outboxItems = outbox.items;
let controller = new AbortController();
let generation = 0;
let mounted = true;
let connection: Misskey.IChannelConnection<Misskey.Channels['chatUser']> | null = null;
let timer: number | undefined;
let buffered: ChatMessage[] = [];
const bufferedNewIds = new Set<string>();
let resyncRequired = false;

// Keep incoming motion, but release trimmed rows immediately instead of keeping
// their DOM for Vue's default two-frame leave phase outside the 120-row window.
function finishRemoval(_element: Element, done: () => void): void { done(); }

function bufferMessage(message: ChatMessage, isNew = false): void {
	if (isNew) bufferedNewIds.add(message.id);
	const index = buffered.findIndex(item => item.id === message.id);
	if (index >= 0) buffered[index] = mergeChatMessage(buffered[index], message);
	else buffered.push(message);
	// A bounded buffer must never silently drop the missing part of a live stream.
	if (buffered.length > 240) { bufferedNewIds.delete(buffered.shift()!.id); resyncRequired = true; }
}

function normalize(message: ChatMessage): NormalizedChatMessage & ChatMessage {
	return { ...message, fromUser: message.fromUser ?? (message.fromUserId === $i.id ? $i : user.value!), reactions: message.reactions.map(reaction => ({ ...reaction, user: reaction.user ?? (message.fromUserId === $i.id ? user.value! : $i) })) };
}

function atLatest(): boolean {
	const container = timelineEl.value ? getScrollContainer(timelineEl.value) : null;
	return !contextMode.value && !hasNewer.value && (!container || Math.abs(container.scrollTop) <= 48);
}

function selectReply(message: ChatMessage): void {
	if (!isPrivateChatMessage(message, $i.id, props.userId) || message.recalledAt) return;
	selectedReply.value = chatReplySummary(message);
}

function reconcileReferences(updates: ChatMessage[], missingIds: string[] = []): void {
	messages.value = reconcileChatReplies(messages.value, updates, missingIds, $i.id, props.userId);
	if (!selectedReply.value) return;
	const selected = selectedReply.value;
	const updated = updates.find(message => message.id === selected.id && isPrivateChatMessage(message, $i.id, props.userId));
	if (missingIds.includes(selected.id)) selectedReply.value = unavailableChatReply(selected.id);
	else if (updated && !selected.unavailable && !selected.recalledAt && (updated.revision ?? 0) >= selected.revision) selectedReply.value = chatReplySummary(updated);
}

function merge(incoming: ChatMessage[], older = false): void {
	const root = timelineEl.value;
	const container = root ? getScrollContainer(root) : null;
	const anchor = root ? captureTimelineAnchor(root, container) : null;
	const follow = atLatest() && !older;
	const combined = mergeChatWindow(messages.value, incoming, older, follow ? undefined : anchor?.id);
	const all = [...messages.value, ...incoming];
	if (all.some(message => message.id < (combined.at(-1)?.id ?? message.id))) hasOlder.value = true;
	if (all.some(message => message.id > (combined[0]?.id ?? message.id))) hasNewer.value = true;
	messages.value = combined;
	reconcileReferences(incoming);
	for (const message of incoming) if (message.clientMessageId) outbox.queue.confirm(message.clientMessageId);
	void nextTick(() => {
		if (follow) container?.scrollTo({ top: 0, behavior: 'instant' });
		else if (root && anchor) restoreTimelineAnchor(root, container, anchor);
		scrollPosition?.refresh();
	});
}

const reader = useChatRead({ root: () => timelineEl.value, enabled: () => initialized.value && connected.value && !syncing.value && !error.value && active.value && tab.value === 'chat', generation: () => generation, userId: props.userId, accountId: $i.id, messages: () => messages.value, merge });

function onMessage(message: ChatMessage): void {
	if (message.clientMessageId) outbox.queue.confirm(message.clientMessageId);
	if (syncing.value) { bufferMessage(message, true); return; }
	if (atLatest() || messages.value.some(item => item.id === message.id)) merge([message]);
	else { hasNewer.value = true; newMessages.value = true; }
}

function onUpdated(message: ChatMessage): void {
	if (syncing.value) { bufferMessage(message); return; }
	reconcileReferences([message]);
	if (messages.value.some(item => item.id === message.id)) merge([message]);
}

function onRead(event: { messages: ChatMessage[] }): void { event.messages.forEach(onUpdated); }

function discardPending(clientMessageId: string): void {
	const snapshot = outbox.queue.discard(clientMessageId);
	for (const attachmentId of snapshot?.attachmentIds ?? []) void chatApi('chat/attachments/delete', { attachmentId }).catch(() => undefined);
}

function invalidateMessage(event: { messageId: string } | string): void {
	const id = typeof event === 'string' ? event : event.messageId;
	if (!messages.value.some(message => message.id === id) && !chatReferenceIds(messages.value, selectedReply.value).includes(id)) return;
	if (syncing.value) resyncRequired = true;
	else void synchronize();
}

async function synchronize(): Promise<void> {
	if (syncing.value || !mounted || !active.value || window.document.hidden) return;
	const current = ++generation;
	const firstPage = !initialized.value;
	const wasLatest = firstPage || atLatest();
	const limit = firstPage ? 20 : 30;
	resyncRequired = false;
	reader.reset();
	syncing.value = true;
	error.value = false;
	try {
		user.value ??= await misskeyApi('users/show', { userId: props.userId }, undefined, controller.signal);
		const snapshotIds = [...new Set([...messages.value.map(message => message.id), ...chatReferenceIds(messages.value, selectedReply.value)])];
		const pages = await Promise.all(Array.from({ length: Math.ceil(snapshotIds.length / 100) }, (_, index) => chatApi('chat/messages/state', { userId: props.userId, messageIds: snapshotIds.slice(index * 100, (index + 1) * 100) }, controller.signal)));
		const latest = await misskeyApi('chat/messages/user-timeline', { userId: props.userId, limit }, undefined, controller.signal) as ChatMessage[];
		if (!mounted || current !== generation) return;
		const missing = new Set(pages.flatMap(page => page.missingIds));
		const states = pages.flatMap(page => page.messages);
		reconcileReferences(states, [...missing]);
		messages.value = messages.value.filter(message => !missing.has(message.id));
		// Reference prefetch never inserts rows or marks them read.
		const visibleIds = new Set(messages.value.map(message => message.id));
		merge(states.filter(message => visibleIds.has(message.id)));
		if (wasLatest) {
			// A full non-overlapping page means an unknown-size gap. Restart with a
			// continuous newest page instead of displaying disconnected history.
			const gap = messages.value.length > 0 && latest.length === limit && !latest.some(message => messages.value.some(item => item.id === message.id));
			if (gap) messages.value = [];
			merge(latest);
			if (firstPage || gap) hasOlder.value = latest.length === limit;
		} else if (latest.some(message => message.id > (messages.value[0]?.id ?? ''))) { hasNewer.value = true; newMessages.value = true; }
		const queued = buffered;
		buffered = [];
		for (const message of queued) {
			reconcileReferences([message]);
			if (messages.value.some(item => item.id === message.id) || (bufferedNewIds.has(message.id) && atLatest())) merge([message]);
			else if (bufferedNewIds.has(message.id)) hasNewer.value = true;
		}
		bufferedNewIds.clear();
		initialized.value = true;
	} catch { if (mounted && current === generation) error.value = true; } finally {
		if (current === generation) {
			syncing.value = false;
			if (resyncRequired && !error.value) void synchronize();
		}
	}
}

async function openContext(messageId: string): Promise<void> {
	if (paging.value || syncing.value || !active.value) return;
	const current = ++generation;
	paging.value = true;
	syncing.value = true;
	contextError.value = false;
	reader.reset();
	try {
		const result = await chatApi('chat/messages/context', { userId: props.userId, messageId }, AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]));
		if (!mounted || current !== generation) return;
		if (!result.messages.some(message => message.id === messageId && isPrivateChatMessage(message, $i.id, props.userId))) throw new Error('CHAT_CONTEXT_UNAVAILABLE');
		contextMode.value = true;
		highlightedId.value = messageId;
		messages.value = mergeChatWindow([], result.messages.filter(message => isPrivateChatMessage(message, $i.id, props.userId)));
		hasOlder.value = result.hasOlder;
		hasNewer.value = result.hasNewer;
		error.value = false;
		for (const update of buffered) {
			reconcileReferences([update]);
			if (messages.value.some(message => message.id === update.id)) merge([update]);
			else if (bufferedNewIds.has(update.id) && update.id > (messages.value[0]?.id ?? '')) { hasNewer.value = true; newMessages.value = true; }
		}
		buffered = [];
		bufferedNewIds.clear();
		await nextTick();
		if (!mounted || current !== generation) return;
		const target = Array.from(timelineEl.value?.querySelectorAll<HTMLElement>('[data-scroll-anchor]') ?? []).find(element => element.dataset.scrollAnchor === messageId);
		// Materialize a virtualized target before measuring its real height.
		if (target) viewport.pin(target);
		await nextTick();
		if (!mounted || current !== generation) return;
		target?.scrollIntoView({ block: 'center', behavior: 'instant' });
		scrollPosition?.focusMessage(messageId);
	} catch {
		if (current === generation) contextError.value = true;
	} finally {
		if (current === generation) { paging.value = false; syncing.value = false; if (buffered.length || resyncRequired) void synchronize(); }
	}
}

async function loadPage(older: boolean): Promise<void> {
	if (paging.value || syncing.value || !messages.value.length) return;
	paging.value = true;
	const current = generation;
	try {
		const page = await misskeyApi('chat/messages/user-timeline', { userId: props.userId, limit: 30, ...(older ? { untilId: messages.value.at(-1)!.id } : { sinceId: messages.value[0].id }) }, undefined, controller.signal) as ChatMessage[];
		if (current !== generation) return;
		merge(page, older);
		if (older) hasOlder.value = page.length === 30;
		else hasNewer.value = page.length === 30;
	} catch { if (current === generation) error.value = true; } finally { if (current === generation) paging.value = false; }
}

async function jumpToLatest(): Promise<void> {
	if (paging.value || syncing.value) return;
	paging.value = true;
	const current = ++generation;
	syncing.value = true;
	resyncRequired = false;
	error.value = false;
	reader.reset();
	try {
		const latest = await misskeyApi('chat/messages/user-timeline', { userId: props.userId, limit: 30 }, undefined, controller.signal) as ChatMessage[];
		if (!mounted || current !== generation) return;
		messages.value = [];
		contextMode.value = false;
		contextError.value = false;
		highlightedId.value = null;
		hasNewer.value = false;
		newMessages.value = false;
		hasOlder.value = latest.length === 30;
		merge(latest);
		const queued = buffered;
		buffered = [];
		reconcileReferences(queued);
		merge(queued.filter(message => bufferedNewIds.has(message.id) || messages.value.some(item => item.id === message.id)));
		bufferedNewIds.clear();
		await nextTick();
		if (timelineEl.value) getScrollContainer(timelineEl.value)?.scrollTo({ top: 0, behavior: 'instant' });
		scrollPosition?.refresh();
	} catch { if (current === generation) error.value = true; } finally {
		if (current === generation) {
			paging.value = false;
			syncing.value = false;
			if (resyncRequired && !error.value) void synchronize();
		}
	}
}

function disconnected(): void { connected.value = false; generation++; syncing.value = false; paging.value = false; reader.reset(); }

function reconnected(): void { connected.value = true; void synchronize(); }

function visibility(): void { reader.reset(); if (!window.document.hidden) void synchronize(); }

function activate(): void {
	active.value = true;
	if (connection || !mounted) return;
	if (controller.signal.aborted) controller = new AbortController();
	connected.value = stream.state === 'connected';
	// Subscribe before reading the initial snapshot to close the fetch/subscribe gap.
	connection = stream.useChannel('chatUser', { otherId: props.userId });
	connection.on('message', onMessage);
	connection.on('updated', onUpdated);
	connection.on('recalled', onUpdated);
	connection.on('read', onRead);
	connection.on('deleted', invalidateMessage);
	connection.on('react', invalidateMessage);
	connection.on('unreact', invalidateMessage);
	stream.on('_connected_', reconnected);
	stream.on('_disconnected_', disconnected);
	outbox.listeners.add(onMessage);
	outbox.queue.expire();
	window.document.addEventListener('visibilitychange', visibility);
	timer = window.setInterval(() => { outbox.queue.expire(); if (connected.value) void synchronize(); }, 30_000);
	void synchronize();
}

function deactivate(): void {
	active.value = false;
	scrollPosition?.dispose();
	scrollPosition = undefined;
	generation++;
	controller.abort();
	syncing.value = false;
	paging.value = false;
	buffered = [];
	bufferedNewIds.clear();
	reader.reset();
	connection?.dispose();
	connection = null;
	window.clearInterval(timer);
	timer = undefined;
	stream.off('_connected_', reconnected);
	stream.off('_disconnected_', disconnected);
	outbox.listeners.delete(onMessage);
	window.document.removeEventListener('visibilitychange', visibility);
}

onMounted(activate);
onActivated(activate);
onDeactivated(deactivate);
onBeforeUnmount(() => {
	mounted = false;
	deactivate();
	controller.abort();
	viewport.dispose();
});

const tabs = computed(() => [{ key: 'chat', title: i18n.ts._chat.messages, icon: 'ti ti-messages' }, { key: 'search', title: i18n.ts.search, icon: 'ti ti-search' }]);
const leadingActions = computed(() => [{ icon: 'ti ti-arrow-left', text: i18n.ts.goBack, handler: () => router.push('/chat') }]);
const actions = computed(() => [
	{ icon: 'ti ti-users', text: i18n.ts._chatPro.contacts, handler: () => router.push('/chat/contacts') },
	{ icon: 'ti ti-dots', text: i18n.ts._chatDaily.settings, handler: (event: MouseEvent) => { void showChatConversationMenu(props.userId, event.currentTarget); } },
]);
definePage(computed(() => ({ title: user.value?.name ?? user.value?.username ?? i18n.ts.directMessage, avatar: user.value })));
</script>

<style module lang="scss">
.shell { height: 100%; min-height: 0; display: flex; container-type: inline-size; }
.sidebar { display: none; width: 300px; flex-shrink: 0; overflow-y: auto; border-right: 1px solid var(--MI_THEME-divider); }
.sidebarTitle { display: block; padding: 16px; font-weight: bold; }
.root { display: flex; flex: 1; min-width: 0; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; }
.conversation { flex: 1 1 0; height: auto; min-height: 0; container-type: size; contain: size style paint; }
.footer { flex-shrink: 0; width: 100%; padding-top: 8px; padding-bottom: env(safe-area-inset-bottom, 0px); background: var(--MI_THEME-panel); }
.form { margin: 0 auto; width: 100%; max-width: 700px; }
.messages { display: flex; flex-direction: column; gap: 12px; }
.more { margin: 4px auto; }
.date { text-align: center; font-size: 85%; opacity: .7; padding: var(--MI-marginHalf); }
.status { padding: 8px; text-align: center; font-size: 85%; color: var(--MI_THEME-fgTransparentWeak); }
.enter { transition: opacity .2s, transform .2s; }
.enterFrom { opacity: 0; transform: translateY(12px); }
.highlighted { border-radius: var(--MI-radius); outline: 2px solid var(--MI_THEME-accent); outline-offset: 4px; background: var(--MI_THEME-accentedBg); }
@container (min-width: 960px) { .sidebar { display: block; } }
</style>
