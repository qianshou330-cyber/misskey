<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<component :is="prefer.s.enablePullToRefresh ? MkPullToRefresh : 'div'" :refresher="() => reloadTimeline()">
	<MkLoading v-if="paginator.fetching.value"/>

	<MkError v-else-if="paginator.error.value" @retry="paginator.init()"/>

	<div v-else-if="paginator.items.value.length === 0" key="_empty_">
		<slot name="empty"><MkResult type="empty" :text="i18n.ts.noNotes"/></slot>
	</div>

	<div v-else ref="rootEl">
		<div v-if="paginator.queuedAheadItemsCount.value > 0" :class="$style.new">
			<div :class="$style.newBg1"></div>
			<div :class="$style.newBg2"></div>
			<button class="_button" :class="$style.newButton" @click="releaseQueue()"><i class="ti ti-circle-arrow-up"></i> {{ i18n.ts.newNote }}</button>
		</div>
		<TransitionGroup
			:class="$style.notes"
			:css="false"
			:moveClass="motionEnabled ? $style.transition_x_move : $style.noMove"
			tag="div"
			@enter="enterRow"
			@enterCancelled="cancelRowMotion"
			@leave="leaveRow"
			@leaveCancelled="cancelRowMotion"
		>
			<MkVirtualTimelineItem v-for="(note, i) in paginator.items.value" :key="note.id" data-timeline-row :data-scroll-anchor="note.id">
					<div v-if="i > 0 && isSeparatorNeeded(paginator.items.value[i -1].createdAt, note.createdAt)" :class="$style.date">
						<span><i class="ti ti-chevron-up"></i> {{ getSeparatorInfo(paginator.items.value[i -1].createdAt, note.createdAt)?.prevText }}</span>
						<span style="height: 1em; width: 1px; background: var(--MI_THEME-divider);"></span>
						<span>{{ getSeparatorInfo(paginator.items.value[i -1].createdAt, note.createdAt)?.nextText }} <i class="ti ti-chevron-down"></i></span>
					</div>
					<MkNote :class="$style.note" :note="note" :withHardMute="true"/>
					<div v-if="note._shouldInsertAd_" :class="$style.ad">
						<MkAd :preferForms="['horizontal', 'horizontal-big']"/>
					</div>
			</MkVirtualTimelineItem>
		</TransitionGroup>
		<button v-show="paginator.canFetchOlder.value" key="_more_" v-appear="prefer.s.enableInfiniteScroll ? fetchOlderAutomatically : null" :disabled="paginator.fetchingOlder.value" class="_button" :class="$style.more" @click="fetchOlder">
			<div v-if="!paginator.fetchingOlder.value">{{ i18n.ts.loadMore }}</div>
			<MkLoading v-else :inline="true"/>
		</button>
	</div>
</component>
</template>

<script lang="ts" setup>
import { computed, watch, onUnmounted, provide, useTemplateRef, TransitionGroup, onMounted, ref, markRaw, nextTick } from 'vue';
import * as Misskey from 'misskey-js';
import { useInterval } from '@@/js/use-interval.js';
import { useDocumentVisibility } from '@@/js/use-document-visibility.js';
import { getScrollContainer, scrollToTop } from '@@/js/scroll.js';
import type { BasicTimelineType } from '@/timelines.js';
import type { SoundStore } from '@/preferences/def.js';
import type { IPaginator, MisskeyEntity } from '@/utility/paginator.js';
import MkPullToRefresh from '@/components/MkPullToRefresh.vue';
import { useStream } from '@/stream.js';
import * as sound from '@/utility/sound.js';
import { $i } from '@/i.js';
import { instance } from '@/instance.js';
import { prefer } from '@/preferences.js';
import { store } from '@/store.js';
import MkNote from '@/components/MkNote.vue';
import { i18n } from '@/i18n.js';
import { DI } from '@/di.js';
import { useGlobalEvent } from '@/events.js';
import { isSeparatorNeeded, getSeparatorInfo } from '@/utility/timeline-date-separate.js';
import { Paginator } from '@/utility/paginator.js';
import MkVirtualTimelineItem from '@/components/MkVirtualTimelineItem.vue';
import { TimelineViewport, timelineViewportKey } from '@/utility/timeline-viewport.js';
import { captureTimelineAnchor, isTimelineAtTop, restoreTimelineAnchor, retainTimelineWindow, TIMELINE_WINDOW_SIZE } from '@/utility/timeline-window.js';
import type { TimelineAnchor } from '@/utility/timeline-window.js';

const props = withDefaults(defineProps<{
	src: BasicTimelineType | 'mentions' | 'directs' | 'list' | 'antenna' | 'channel' | 'role' | 'topic';
	list?: string;
	antenna?: string;
	channel?: string;
	role?: string;
	topic?: string;
	sound?: boolean;
	customSound?: SoundStore | null;
	withRenotes?: boolean;
	withReplies?: boolean;
	withSensitive?: boolean;
	onlyFiles?: boolean;
	forceRealtime?: boolean;
}>(), {
	withRenotes: true,
	withReplies: false,
	withSensitive: true,
	onlyFiles: false,
	forceRealtime: false,
	sound: false,
	customSound: null,
});

provide('inTimeline', true);
provide('tl_withSensitive', computed(() => props.withSensitive));
provide(DI.inChannel, computed(() => props.src === 'channel' ? props.channel ?? null : null));

// Share one pair of observers across every note in this timeline. MkNote and
// its media subscriptions are unmounted outside the viewport while the wrapper
// keeps their measured height, so scrolling does not retain an unbounded DOM.
const timelineViewport = new TimelineViewport();
provide(timelineViewportKey, timelineViewport);

let paginator: IPaginator<Misskey.entities.Note>;

if (props.src === 'antenna') {
	paginator = markRaw(new Paginator('antennas/notes', {
		computedParams: computed(() => ({
			antennaId: props.antenna!,
		})),
		useShallowRef: true,
	}));
} else if (props.src === 'home') {
	paginator = markRaw(new Paginator('notes/timeline', {
		computedParams: computed(() => ({
			withRenotes: props.withRenotes,
			withFiles: props.onlyFiles ? true : undefined,
		})),
		useShallowRef: true,
	}));
} else if (props.src === 'local') {
	paginator = markRaw(new Paginator('notes/local-timeline', {
		computedParams: computed(() => ({
			withRenotes: props.withRenotes,
			withReplies: props.withReplies,
			withFiles: props.onlyFiles ? true : undefined,
		})),
		useShallowRef: true,
	}));
} else if (props.src === 'social') {
	paginator = markRaw(new Paginator('notes/hybrid-timeline', {
		computedParams: computed(() => ({
			withRenotes: props.withRenotes,
			withReplies: props.withReplies,
			withFiles: props.onlyFiles ? true : undefined,
		})),
		useShallowRef: true,
	}));
} else if (props.src === 'global') {
	paginator = markRaw(new Paginator('notes/global-timeline', {
		computedParams: computed(() => ({
			withRenotes: props.withRenotes,
			withFiles: props.onlyFiles ? true : undefined,
		})),
		useShallowRef: true,
	}));
} else if (props.src === 'mentions') {
	paginator = markRaw(new Paginator('notes/mentions', {
		useShallowRef: true,
	}));
} else if (props.src === 'directs') {
	paginator = markRaw(new Paginator('notes/mentions', {
		params: {
			visibility: 'specified',
		},
		useShallowRef: true,
	}));
} else if (props.src === 'list') {
	paginator = markRaw(new Paginator('notes/user-list-timeline', {
		computedParams: computed(() => ({
			withRenotes: props.withRenotes,
			withFiles: props.onlyFiles ? true : undefined,
			listId: props.list!,
		})),
		useShallowRef: true,
	}));
} else if (props.src === 'channel') {
	paginator = markRaw(new Paginator('channels/timeline', {
		computedParams: computed(() => ({
			channelId: props.channel!,
		})),
		useShallowRef: true,
	}));
} else if (props.src === 'role') {
	paginator = markRaw(new Paginator('roles/notes', {
		computedParams: computed(() => ({
			roleId: props.role!,
		})),
		useShallowRef: true,
	}));
} else if (props.src === 'topic') {
	paginator = markRaw(new Paginator('notes/topic-timeline', {
		computedParams: computed(() => ({
			topicId: props.topic!,
			withRenotes: props.withRenotes,
			withFiles: props.onlyFiles ? true : undefined,
		})),
		useShallowRef: true,
	}));
} else {
	throw new Error('Unrecognized timeline type: ' + props.src);
}

const realtimeEnabled = props.forceRealtime || store.s.realtimeMode || props.src === 'topic';
const shouldBufferStreamNotes = props.forceRealtime || props.src === 'topic';
const pendingStreamNotes: Misskey.entities.Note[] = [];
let streamInitialised = false;
let streamWasDisconnected = false;

const suppressMotion = ref(false);
const motionEnabled = computed(() => prefer.r.animation.value && !suppressMotion.value);
const trueDeletions = new Set<string>();
const rowMotions = new Map<Element, () => void>();
let pauseAutomaticOlder = false;
let mounted = false;

function flushPendingStreamNotes() {
	for (const note of pendingStreamNotes.toReversed()) {
		paginator.prepend(note);
	}
	pendingStreamNotes.length = 0;
}

if (shouldBufferStreamNotes) {
	watch(paginator.fetching, (fetching) => {
		if (!fetching) flushPendingStreamNotes();
	});
}

onMounted(async () => {
	mounted = true;
	await paginator.init();
	if (!mounted) return;
	streamInitialised = true;
	if (shouldBufferStreamNotes) flushPendingStreamNotes();
});

// Register effects during setup so Vue owns and stops them on unmount.
if (paginator.computedParams) {
	watch(paginator.computedParams, () => {
		if (mounted) void reloadTimeline();
	}, { deep: true });
}
watch(paginator.items, () => {
	if (motionEnabled.value) timelineViewport.pinRendered();
}, { flush: 'pre' });

function isTop(): boolean {
	return isTimelineAtTop(rootEl.value, scrollContainer);
}

let scrollContainer: HTMLElement | null = null;
let scrollTarget: HTMLElement | Window | null = null;

function onScrollContainerScroll() {
	if (isTop()) {
		paginator.releaseQueue();
	}
}

function onScrollIntent(event: Event): void {
	if (event instanceof KeyboardEvent && !['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) return;
	pauseAutomaticOlder = false;
}

function detachScrollTarget(): void {
	scrollTarget?.removeEventListener('scroll', onScrollContainerScroll);
	for (const event of ['wheel', 'touchmove', 'pointerdown', 'keydown']) scrollTarget?.removeEventListener(event, onScrollIntent);
}

const rootEl = useTemplateRef('rootEl');
watch(rootEl, el => {
	detachScrollTarget();
	scrollContainer = el ? getScrollContainer(el) : null;
	scrollTarget = el ? scrollContainer ?? window : null;
	scrollTarget?.addEventListener('scroll', onScrollContainerScroll, { passive: true });
	for (const event of ['wheel', 'touchmove', 'pointerdown', 'keydown']) scrollTarget?.addEventListener(event, onScrollIntent, { passive: true });
}, { flush: 'post' });

onUnmounted(() => {
	detachScrollTarget();
	paginator.invalidate();
	for (const finish of rowMotions.values()) finish();
	rowMotions.clear();
	trueDeletions.clear();
	timelineViewport.dispose();
});

const visibility = useDocumentVisibility();
let isPausingUpdate = false;

watch(visibility, () => {
	if (visibility.value === 'hidden') {
		isPausingUpdate = true;
	} else { // 'visible'
		isPausingUpdate = false;
		if (isTop()) {
			releaseQueue();
		}
	}
});

let adInsertionCounter = 0;

const MIN_POLLING_INTERVAL = 1000 * 10;
const POLLING_INTERVAL =
	prefer.s.pollingInterval === 1 ? MIN_POLLING_INTERVAL * 1.5 * 1.5 :
	prefer.s.pollingInterval === 2 ? MIN_POLLING_INTERVAL * 1.5 :
	prefer.s.pollingInterval === 3 ? MIN_POLLING_INTERVAL :
	MIN_POLLING_INTERVAL;

if (!realtimeEnabled) {
	// TODO: 先頭のノートの作成日時が1日以上前であれば流速が遅いTLと見做してインターバルを通常より延ばす
	useInterval(async () => {
		paginator.fetchNewer({
			toQueue: !isTop() || isPausingUpdate,
			beforeCommit: items => items.slice(0, TIMELINE_WINDOW_SIZE).map(item => item.id),
		});
	}, POLLING_INTERVAL, {
		immediate: false,
		afterMounted: true,
	});

	useGlobalEvent('notePosted', (note) => {
		paginator.fetchNewer({
			toQueue: !isTop() || isPausingUpdate,
			beforeCommit: items => items.slice(0, TIMELINE_WINDOW_SIZE).map(item => item.id),
		});
	});
}

useGlobalEvent('noteDeleted', (noteId) => {
	if (paginator.items.value.some(note => note.id === noteId)) trueDeletions.add(noteId);
	paginator.removeItem(noteId);
});

useGlobalEvent('noteRemovedFromAntenna', (antennaId, noteId) => {
	if (props.src === 'antenna' && props.antenna === antennaId) {
		if (paginator.items.value.some(note => note.id === noteId)) trueDeletions.add(noteId);
		paginator.removeItem(noteId);
	}
});

function releaseQueue() {
	paginator.releaseQueue();
	scrollToTop(rootEl.value!);
}

function cancelRowMotion(element: Element): void {
	rowMotions.get(element)?.();
}

function animateRow(element: Element, frames: Keyframe[], duration: number, done: () => void): void {
	cancelRowMotion(element);
	const el = element as HTMLElement;
	const release = timelineViewport.pin(el);
	if (typeof el.animate !== 'function') {
		release();
		done();
		return;
	}
	const animation = el.animate(frames, { duration, easing: duration === 700 ? 'cubic-bezier(0.23, 1, 0.32, 1)' : 'cubic-bezier(0, .5, .5, 1)' });
	let finished = false;
	const finish = (): void => {
		if (finished) return;
		finished = true;
		window.clearTimeout(timer);
		rowMotions.delete(element);
		animation.cancel();
		release();
		done();
	};
	const timer = window.setTimeout(finish, duration + 100);
	rowMotions.set(element, finish);
	void animation.finished.then(finish, finish);
}

function enterRow(element: Element, done: () => void): void {
	const el = element as HTMLElement;
	if (!motionEnabled.value || !timelineViewport.isNear(el)) {
		done();
		return;
	}
	// Individual translate composes with TransitionGroup's transform-based FLIP.
	animateRow(el, [{ opacity: 0, translate: '0 -64px' }, { opacity: 1, translate: '0 0' }], 700, done);
}

function leaveRow(element: Element, done: () => void): void {
	const el = element as HTMLElement;
	const deleted = trueDeletions.delete(el.dataset.scrollAnchor!);
	if (!deleted || !motionEnabled.value || el.dataset.virtualized === 'true' || !timelineViewport.isNear(el)) {
		done();
		return;
	}
	// Vue has already disposed the note subscriptions; only its DOM fades out.
	el.style.overflow = 'hidden';
	animateRow(el, [{ opacity: 1, height: String(el.offsetHeight) + 'px' }, { opacity: 0, height: '0px' }], 200, done);
}

function fetchOlderAutomatically(): Promise<void> | undefined {
	if (!pauseAutomaticOlder) return fetchOlder();
	return undefined;
}

async function fetchOlder(): Promise<void> {
	let anchor: TimelineAnchor | null = null;
	let trimmed = false;
	await paginator.fetchOlder({
		beforeCommit: items => {
			if (items.length <= TIMELINE_WINDOW_SIZE) return undefined;
			suppressMotion.value = true;
			trimmed = true;
			for (const finish of rowMotions.values()) finish();
			// End a pending FLIP before measuring the layout anchor.
			for (const row of rootEl.value?.querySelectorAll<HTMLElement>('[data-timeline-row]') ?? []) {
				for (const animation of row.getAnimations?.() ?? []) animation.cancel();
			}
			anchor = rootEl.value ? captureTimelineAnchor(rootEl.value, scrollContainer) : null;
			const retained = retainTimelineWindow(items, anchor?.id, isTop());
			pauseAutomaticOlder = retained[0]?.id === items[0]?.id;
			return retained.map(item => item.id);
		},
	});
	if (!trimmed) return;
	await nextTick();
	if (mounted && anchor && rootEl.value) restoreTimelineAnchor(rootEl.value, scrollContainer, anchor);
	// Keep the same TransitionGroup instance; trimming is a silent layout commit.
	suppressMotion.value = false;
}

function prepend(note: Misskey.entities.Note & MisskeyEntity) {
	if (shouldBufferStreamNotes && paginator.fetching.value) {
		if (!pendingStreamNotes.some(pending => pending.id === note.id)) {
			pendingStreamNotes.unshift(note);
			if (pendingStreamNotes.length > 100) pendingStreamNotes.pop();
		}
		return;
	}

	adInsertionCounter++;

	if (instance.notesPerOneAd > 0 && adInsertionCounter % instance.notesPerOneAd === 0) {
		note._shouldInsertAd_ = true;
	}

	if (isTop() && !isPausingUpdate) {
		paginator.prepend(note);
	} else {
		paginator.enqueue(note);
	}

	if (props.sound) {
		if (props.customSound) {
			sound.playMisskeySfxFile(props.customSound);
		} else {
			sound.playMisskeySfx($i && (note.userId === $i.id) ? 'noteMy' : 'note');
		}
	}
}

const stream = realtimeEnabled ? useStream() : null;

const onStreamConnected = () => {
	if (shouldBufferStreamNotes && streamInitialised && streamWasDisconnected) {
		streamWasDisconnected = false;
		void reloadTimeline();
	}
};
const onStreamDisconnected = () => {
	if (shouldBufferStreamNotes) streamWasDisconnected = true;
};

if (shouldBufferStreamNotes) {
	stream?.on('_connected_', onStreamConnected);
	stream?.on('_disconnected_', onStreamDisconnected);
}

const connections = {
	antenna: null as Misskey.IChannelConnection<Misskey.Channels['antenna']> | null,
	homeTimeline: null as Misskey.IChannelConnection<Misskey.Channels['homeTimeline']> | null,
	localTimeline: null as Misskey.IChannelConnection<Misskey.Channels['localTimeline']> | null,
	hybridTimeline: null as Misskey.IChannelConnection<Misskey.Channels['hybridTimeline']> | null,
	globalTimeline: null as Misskey.IChannelConnection<Misskey.Channels['globalTimeline']> | null,
	main: null as Misskey.IChannelConnection<Misskey.Channels['main']> | null,
	userList: null as Misskey.IChannelConnection<Misskey.Channels['userList']> | null,
	channel: null as Misskey.IChannelConnection<Misskey.Channels['channel']> | null,
	roleTimeline: null as Misskey.IChannelConnection<Misskey.Channels['roleTimeline']> | null,
	topicTimeline: null as Misskey.IChannelConnection<Misskey.Channels['topicTimeline']> | null,
};

function connectChannel() {
	if (stream == null) return;
	if (props.src === 'antenna') {
		if (props.antenna == null) return;
		connections.antenna = stream.useChannel('antenna', {
			antennaId: props.antenna,
		});
		connections.antenna.on('note', prepend);
	} else if (props.src === 'home') {
		connections.homeTimeline = stream.useChannel('homeTimeline', {
			withRenotes: props.withRenotes,
			withFiles: props.onlyFiles ? true : undefined,
		});
		connections.main = stream.useChannel('main');
		connections.homeTimeline.on('note', prepend);
	} else if (props.src === 'local') {
		connections.localTimeline = stream.useChannel('localTimeline', {
			withRenotes: props.withRenotes,
			withReplies: props.withReplies,
			withFiles: props.onlyFiles ? true : undefined,
		});
		connections.localTimeline.on('note', prepend);
	} else if (props.src === 'social') {
		connections.hybridTimeline = stream.useChannel('hybridTimeline', {
			withRenotes: props.withRenotes,
			withReplies: props.withReplies,
			withFiles: props.onlyFiles ? true : undefined,
		});
		connections.hybridTimeline.on('note', prepend);
	} else if (props.src === 'global') {
		connections.globalTimeline = stream.useChannel('globalTimeline', {
			withRenotes: props.withRenotes,
			withFiles: props.onlyFiles ? true : undefined,
		});
		connections.globalTimeline.on('note', prepend);
	} else if (props.src === 'mentions') {
		connections.main = stream.useChannel('main');
		connections.main.on('mention', prepend);
	} else if (props.src === 'directs') {
		connections.main = stream.useChannel('main');
		connections.main.on('mention', note => {
			if (note.visibility === 'specified') {
				prepend(note);
			}
		});
	} else if (props.src === 'list') {
		if (props.list == null) return;
		connections.userList = stream.useChannel('userList', {
			withRenotes: props.withRenotes,
			withFiles: props.onlyFiles ? true : undefined,
			listId: props.list,
		});
		connections.userList.on('note', prepend);
	} else if (props.src === 'channel') {
		if (props.channel == null) return;
		connections.channel = stream.useChannel('channel', {
			channelId: props.channel,
		});
		connections.channel.on('note', prepend);
	} else if (props.src === 'role') {
		if (props.role == null) return;
		connections.roleTimeline = stream.useChannel('roleTimeline', {
			roleId: props.role,
		});
		connections.roleTimeline.on('note', prepend);
	} else if (props.src === 'topic') {
		if (props.topic == null) return;
		connections.topicTimeline = stream.useChannel('topicTimeline', {
			topicId: props.topic,
			withRenotes: props.withRenotes,
			withFiles: props.onlyFiles ? true : undefined,
		});
		connections.topicTimeline.on('note', prepend);
	}
}

function disconnectChannel() {
	for (const key in connections) {
		const conn = connections[key as keyof typeof connections];
		if (conn != null) {
			conn.dispose();
			connections[key as keyof typeof connections] = null;
		}
	}
}

if (realtimeEnabled) {
	connectChannel();
}

watch(() => [props.list, props.antenna, props.channel, props.role, props.topic, props.withRenotes], () => {
	if (realtimeEnabled) {
		disconnectChannel();
		connectChannel();
	}
});
watch(() => props.withSensitive, reloadTimeline);

onUnmounted(() => {
	mounted = false;
	stream?.off('_connected_', onStreamConnected);
	stream?.off('_disconnected_', onStreamDisconnected);
	disconnectChannel();
});

function reloadTimeline() {
	pauseAutomaticOlder = false;
	trueDeletions.clear();
	return new Promise<void>((res) => {
		adInsertionCounter = 0;

		paginator.reload().then(() => {
			res();
		});
	});
}

defineExpose({
	reloadTimeline,
});
</script>

<style lang="scss" module>
.transition_x_move {
	transition: transform 0.7s cubic-bezier(0.23, 1, 0.32, 1);
}

.noMove {
	transition: none;
}

.notes {
	container-type: inline-size;
	background: var(--MI_THEME-panel);
}

.note:not(:empty) {
	border-bottom: solid 0.5px var(--MI_THEME-divider);
}

.new {
	--gapFill: 0.5px; // 上位ヘッダーの高さにフォントの関係などで少数が含まれると、レンダリングエンジンによっては隙間が表示されてしまうため、隙間を隠すために少しずらす

	position: sticky;
	top: calc(var(--MI-stickyTop, 0px) - var(--gapFill));
	z-index: 1000;
	width: 100%;
	box-sizing: border-box;
	padding: calc(10px + var(--gapFill)) 0 10px 0;
}

/* 疑似progressive blur */
.newBg1, .newBg2 {
	position: absolute;
	top: 0;
	left: 0;
	right: 0;
	bottom: 0;
}

.newBg1 {
	height: 100%;
	-webkit-backdrop-filter: var(--MI-blur, blur(2px));
	backdrop-filter: var(--MI-blur, blur(2px));
	mask-image: linear-gradient( /* 疑似Easing Linear Gradients */
		to top,
		rgb(0 0 0 / 0%) 0%,
		rgb(0 0 0 / 4.9%) 7.75%,
		rgb(0 0 0 / 10.4%) 11.25%,
		rgb(0 0 0 / 45%) 23.55%,
		rgb(0 0 0 / 55%) 26.45%,
		rgb(0 0 0 / 89.6%) 38.75%,
		rgb(0 0 0 / 95.1%) 42.25%,
		rgb(0 0 0 / 100%) 50%
	);
}

.newBg2 {
	height: 75%;
	-webkit-backdrop-filter: var(--MI-blur, blur(4px));
	backdrop-filter: var(--MI-blur, blur(4px));
	mask-image: linear-gradient( /* 疑似Easing Linear Gradients */
		to top,
		rgb(0 0 0 / 0%) 0%,
		rgb(0 0 0 / 4.9%) 15.5%,
		rgb(0 0 0 / 10.4%) 22.5%,
		rgb(0 0 0 / 45%) 47.1%,
		rgb(0 0 0 / 55%) 52.9%,
		rgb(0 0 0 / 89.6%) 77.5%,
		rgb(0 0 0 / 95.1%) 91.9%,
		rgb(0 0 0 / 100%) 100%
	);
}

.newButton {
	position: relative;
	display: block;
	padding: 6px 12px;
	border-radius: 999px;
	width: max-content;
	margin: auto;
	background: var(--MI_THEME-accent);
	color: var(--MI_THEME-fgOnAccent);
	font-size: 90%;

	&:hover {
		background: hsl(from var(--MI_THEME-accent) h s calc(l + 5));
	}

	&:active {
		background: hsl(from var(--MI_THEME-accent) h s calc(l - 5));
	}
}

.date {
	display: flex;
	font-size: 85%;
	align-items: center;
	justify-content: center;
	gap: 1em;
	padding: 8px 8px;
	margin: 0 auto;
	border-bottom: solid 0.5px var(--MI_THEME-divider);
}

.ad {
	padding: 8px;
	background-size: auto auto;
	background-image: repeating-linear-gradient(45deg, transparent, transparent 8px, var(--MI_THEME-bg) 8px, var(--MI_THEME-bg) 14px);
	border-bottom: solid 0.5px var(--MI_THEME-divider);

	&:empty {
		display: none;
	}
}

.more {
	display: block;
	width: 100%;
	box-sizing: border-box;
	padding: 16px;
	background: var(--MI_THEME-panel);
}
</style>
