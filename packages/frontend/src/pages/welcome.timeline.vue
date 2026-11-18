<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<section
	:class="[$style.root, { [$style.preview]: preview }]"
	:aria-label="i18n.ts.timeline"
	data-testid="welcome-scroll"
	:data-animated="animated"
	:data-paused="keyboardReading || hovered"
	:data-loaded="notes.length > 0"
>
	<div
		ref="viewportEl"
		:class="[$style.viewport, { [$style.animated]: animated }]"
		data-testid="welcome-scroll-viewport"
		:tabindex="animated ? -1 : 0"
		@mouseenter="hovered = true"
		@mouseleave="hovered = false"
		@focusin="onFocusIn"
	>
		<div
			ref="trackEl"
			:class="[$style.track, { [$style.moving]: animated }]"
			:style="{ '--welcome-scroll-distance': `${distance}px`, animationPlayState: hovered ? 'paused' : 'running' }"
			data-testid="welcome-scroll-track"
			@animationiteration.self="flushPending"
		>
			<div ref="mainEl" :class="$style.group" data-testid="welcome-scroll-main">
				<XNote v-for="note in notes" :key="note.id" :note="note" :preview="preview"/>
			</div>
			<div v-if="animated" :class="$style.group" aria-hidden="true" data-testid="welcome-scroll-duplicate">
				<XNote v-for="note in notes" :key="note.id" :note="note" :preview="preview" :duplicate="true"/>
			</div>
		</div>
	</div>
</section>
</template>

<script lang="ts" setup>
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue';
import type * as Misskey from 'misskey-js';
import XNote from '@/pages/welcome.timeline.note.vue';
import { misskeyApi, misskeyApiGet } from '@/utility/misskey-api.js';
import { instance } from '@/instance.js';
import { useStream } from '@/stream.js';
import { prefer } from '@/preferences.js';
import { i18n } from '@/i18n.js';

withDefaults(defineProps<{ preview?: boolean }>(), { preview: false });
const emit = defineEmits<{
	(ev: 'ready'): void;
	(ev: 'unavailable'): void;
}>();

const notes = shallowRef<Misskey.entities.Note[]>([]);
const viewportEl = useTemplateRef('viewportEl');
const trackEl = useTemplateRef('trackEl');
const mainEl = useTemplateRef('mainEl');
const active = ref(false);
const hovered = ref(false);
const keyboardReading = ref(false);
const reducedMotion = ref(false);
const overflows = ref(false);
const distance = ref(0);
const motionAllowed = computed(() => prefer.r.animation.value && !reducedMotion.value);
const animated = computed(() => active.value && motionAllowed.value && overflows.value && !keyboardReading.value);
let pending: Misskey.entities.Note[] = [];
let generation = 0;
let controller: AbortController | null = null;
let observer: ResizeObserver | null = null;
let media: MediaQueryList | null = null;
let connection: Misskey.IChannelConnection<Misskey.Channels['globalTimeline']> | null = null;
let announcedReady = false;

function uniquePublic(items: Misskey.entities.Note[]): Misskey.entities.Note[] {
	const ids = new Set<string>();
	return items.filter(note => {
		if (note.visibility !== 'public' || ids.has(note.id)) return false;
		ids.add(note.id);
		return true;
	}).slice(0, 20);
}

function flushPending(): void {
	if (!active.value || pending.length === 0) return;
	notes.value = uniquePublic([...pending, ...notes.value]);
	pending = [];
}

function prepend(note: Misskey.entities.Note): void {
	if (!active.value || note.visibility !== 'public' || notes.value.some(existing => existing.id === note.id) || pending.some(existing => existing.id === note.id)) return;
	if (animated.value) pending = [note, ...pending].slice(0, 20);
	else notes.value = uniquePublic([note, ...notes.value]);
}

function measure(): void {
	if (!active.value || !viewportEl.value || !mainEl.value || !trackEl.value) return;
	const height = mainEl.value.getBoundingClientRect().height;
	const gap = Number.parseFloat(window.getComputedStyle(trackEl.value).rowGap) || 0;
	distance.value = height + gap;
	overflows.value = notes.value.length > 0 && viewportEl.value.clientHeight > 0 && height > viewportEl.value.clientHeight + 1;
}

function onKeyboard(event: KeyboardEvent): void {
	// Stop before Tab moves focus into a translated or duplicated card.
	if (event.key === 'Tab') keyboardReading.value = true;
}

function onFocusIn(event: FocusEvent): void {
	const target = event.target;
	// Mouse focus must not move a card between pointerdown and click.
	if (!(target instanceof HTMLElement) || !target.matches(':focus-visible')) return;
	keyboardReading.value = true;
	void nextTick(() => {
		if (active.value && target.isConnected) target.scrollIntoView({ block: 'nearest' });
	});
}

function updateMotionPreference(): void { reducedMotion.value = media?.matches ?? false; }

function boundedRequest<T>(request: Promise<T>, signal: AbortSignal): Promise<T> {
	let timer: number;
	let cancel: () => void;
	const bounded = new Promise<T>((resolve, reject) => {
		cancel = (): void => { reject(new Error('Welcome timeline request aborted')); };
		timer = window.setTimeout(() => reject(new Error('Welcome timeline request timed out')), 15_000);
		signal.addEventListener('abort', cancel, { once: true });
		if (signal.aborted) cancel();
		request.then(resolve, reject);
	});
	// Clean up even when the underlying fetch never settles.
	return bounded.finally(() => { window.clearTimeout(timer); signal.removeEventListener('abort', cancel); });
}

async function loadNotes(current: number, signal: AbortSignal): Promise<void> {
	let result: Misskey.entities.Note[] = [];
	let global = false;
	const stillActive = (): boolean => active.value && current === generation && !signal.aborted;
	if (instance.policies?.gtlAvailable !== false) {
		try {
			result = uniquePublic(await boundedRequest(misskeyApi('notes/global-timeline', { limit: 20 }, null, signal), signal));
			global = result.length > 0;
		} catch { /* Anonymous global access can be disabled; try the public featured feed below. */ }
	}
	if (!stillActive()) return;
	if (!global) {
		try {
			result = uniquePublic(await boundedRequest(misskeyApiGet('notes/featured', { limit: 20 }), signal));
		} catch { /* An unavailable feed must not hide the existing visitor dashboard. */ }
	}
	if (!stillActive()) return;
	if (result.length === 0) {
		if (notes.value.length === 0) emit('unavailable');
		return;
	}
	notes.value = uniquePublic([...result, ...notes.value]);
	if (!announcedReady) { announcedReady = true; emit('ready'); }
	// Subscribe only after committing the snapshot, so an immediate live note cannot be overwritten.
	if (global) {
		try {
			connection = useStream().useChannel('globalTimeline', { withRenotes: true });
			connection.on('note', note => { if (stillActive()) prepend(note); });
		} catch {
			connection?.dispose();
			connection = null;
			// Retain the successfully loaded feed if streaming is temporarily unavailable.
		}
	}
	await nextTick();
	if (stillActive()) measure();
}

function activate(): void {
	if (active.value) return;
	active.value = true;
	const current = ++generation;
	controller = new AbortController();
	media = window.matchMedia('(prefers-reduced-motion: reduce)');
	updateMotionPreference();
	media.addEventListener('change', updateMotionPreference);
	window.addEventListener('keydown', onKeyboard);
	observer = new ResizeObserver(measure);
	if (viewportEl.value) observer.observe(viewportEl.value);
	if (mainEl.value) observer.observe(mainEl.value);
	measure();
	void loadNotes(current, controller.signal);
}

function deactivate(): void {
	if (!active.value) return;
	active.value = false;
	generation++;
	controller?.abort();
	controller = null;
	connection?.dispose();
	connection = null;
	observer?.disconnect();
	observer = null;
	media?.removeEventListener('change', updateMotionPreference);
	media = null;
	window.removeEventListener('keydown', onKeyboard);
	pending = [];
	hovered.value = false;
}

watch(animated, value => { if (!value) flushPending(); });
watch(notes, () => { void nextTick(measure); });
onMounted(activate);
onActivated(activate);
onDeactivated(deactivate);
onBeforeUnmount(deactivate);
</script>

<style lang="scss" module>
@keyframes welcomeScroll {
	from { transform: translate3d(0, 0, 0); }
	to { transform: translate3d(0, calc(-1 * var(--welcome-scroll-distance)), 0); }
}

.root {
	display: flex;
	flex-direction: column;
	min-width: 0;
	min-height: 0;
	text-align: right;
}

.preview {
	height: 100%;

	.moving { animation-duration: 60s; }
}

.viewport {
	flex: 1;
	min-height: 0;
	overflow: auto;
	overscroll-behavior: contain;
	scrollbar-gutter: stable;

	&:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: -2px; }

	&.animated {
		overflow: hidden;
		mask-image: linear-gradient(to bottom, transparent, currentColor 48px, currentColor calc(100% - 48px), transparent);
	}
}

.track, .group {
	display: flex;
	flex-direction: column;
	gap: var(--MI-margin);
}

.group {
	flex-shrink: 0;
}

.moving {
	animation: welcomeScroll 30s linear infinite;
	will-change: transform;
}
</style>
