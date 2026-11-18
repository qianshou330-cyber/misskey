<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<button class="_button" :class="$style.play" :disabled="loading" :aria-label="playing ? i18n.ts._chatPro.pause : i18n.ts._chatPro.play" @click="toggle"><i :class="playing ? 'ti ti-player-pause' : 'ti ti-player-play'"></i></button>
	<div ref="waveEl" :class="$style.wave"><span v-if="!ready">{{ i18n.ts._chatPro.voice }}</span></div>
	<span :class="$style.time">{{ formatTime(position) }} / {{ formatTime((attachment.durationMs ?? 0) / 1000) }}</span>
	<span v-if="failed" role="alert">{{ failed === 'budget' ? i18n.ts._chatPro.mediaBudget : failed === 'tap' ? i18n.ts._chatPro.playbackTap : i18n.ts._chatPro.fileUnavailable }}</span>
</div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue';
import type WaveSurfer from 'wavesurfer.js';
import type { ChatAttachment } from '@/types/chat.js';
import { fetchChatAttachment, claimChatAudio, releaseChatAudio, isChatMediaBudgetError } from '@/utility/chat-media.js';
import type { ChatMediaLease } from '@/utility/chat-media.js';
import { i18n } from '@/i18n.js';

const props = defineProps<{ attachment: ChatAttachment }>();
const waveEl = useTemplateRef('waveEl');
const playing = ref(false);
const loading = ref(false);
const failed = ref<'budget' | 'unavailable' | 'tap' | null>(null);
const ready = ref(false);
const position = ref(0);
let controller: AbortController | undefined;
let waveform: WaveSurfer | undefined;
let media: HTMLAudioElement | undefined;
let mediaLease: ChatMediaLease | undefined;
let mounted = true;
let pageHidden = false;
let generation = 0;
let playbackIntent = 0;
let allowPlayback = false;
let subscriptions: (() => void)[] = [];

function formatTime(seconds: number): string { return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; }

function inForeground(): boolean { return mounted && !pageHidden && !window.document.hidden; }

function disposePlayer(): void {
	allowPlayback = false;
	controller?.abort();
	controller = undefined;
	for (const unsubscribe of subscriptions) unsubscribe();
	subscriptions = [];
	const previous = waveform;
	waveform = undefined;
	previous?.destroy();
	if (media) releaseChatAudio(media);
	media = undefined;
	mediaLease?.release();
	mediaLease = undefined;
	playing.value = false;
	ready.value = false;
	position.value = 0;
}

function fail(error: unknown, current: number): void {
	if (!mounted || current !== generation) return;
	if (error instanceof Error && error.name === 'NotAllowedError' && ready.value) {
		allowPlayback = false;
		waveform?.pause();
		playing.value = false;
		failed.value = 'tap';
	} else {
		generation++;
		disposePlayer();
		failed.value = isChatMediaBudgetError(error) ? 'budget' : 'unavailable';
	}
	loading.value = false;
}

async function toggle(): Promise<void> {
	if (loading.value || !inForeground()) return;
	if (playing.value) { allowPlayback = false; waveform?.pause(); playing.value = false; return; }
	const current = generation;
	const intent = ++playbackIntent;
	loading.value = true;
	failed.value = null;
	try {
		if (!waveform) {
			const library = await import('wavesurfer.js');
			if (!mounted || current !== generation || !waveEl.value) return;
			controller = new AbortController();
			const lease = await fetchChatAttachment(props.attachment.id, 'original', controller.signal, props.attachment.size);
			if (!mounted || current !== generation || !waveEl.value) { lease.release(); return; }
			mediaLease = lease;
			const objectUrl = lease.createObjectURL();
			media = new Audio();
			const theme = getComputedStyle(waveEl.value);
			const player = library.default.create({ container: waveEl.value, height: 40, media, waveColor: theme.getPropertyValue('--MI_THEME-fgTransparentWeak').trim(), progressColor: theme.getPropertyValue('--MI_THEME-accent').trim(), barWidth: 3, barGap: 2, cursorWidth: 0 });
			waveform = player;
			subscriptions = [
				player.on('timeupdate', time => { position.value = time; }),
				player.on('play', () => { if (!allowPlayback || !inForeground()) { player.pause(); return; } playing.value = true; if (media) claimChatAudio(media); }),
				player.on('pause', () => { playing.value = false; }),
				player.on('finish', () => { playing.value = false; allowPlayback = false; }),
				player.on('error', error => { fail(error, current); }),
			];
			await player.load(objectUrl, props.attachment.peaks.length ? [props.attachment.peaks] : undefined, props.attachment.durationMs ? props.attachment.durationMs / 1000 : undefined);
			if (!mounted || current !== generation) return;
			ready.value = true;
		}
		if (!inForeground() || intent !== playbackIntent) return;
		allowPlayback = true;
		await waveform.play();
		if (current === generation && (!inForeground() || intent !== playbackIntent)) { allowPlayback = false; waveform.pause(); }
	} catch (error) {
		if (intent === playbackIntent) fail(error, current);
	} finally { if (current === generation) loading.value = false; }
}

function background(): void {
	pageHidden = true;
	playbackIntent++;
	allowPlayback = false;
	waveform?.pause();
	media?.pause();
	playing.value = false;
	if (loading.value && !ready.value) { generation++; disposePlayer(); loading.value = false; }
}

function visibility(): void { if (window.document.hidden) background(); else pageHidden = false; }

function foreground(): void { pageHidden = false; }

onMounted(() => { window.document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', background); window.addEventListener('pageshow', foreground); });
onBeforeUnmount(() => {
	mounted = false;
	generation++;
	disposePlayer();
	window.document.removeEventListener('visibilitychange', visibility);
	window.removeEventListener('pagehide', background);
	window.removeEventListener('pageshow', foreground);
});
</script>

<style module lang="scss">
.root { display: flex; align-items: center; gap: 8px; min-width: 190px; flex-wrap: wrap; }
.play { width: 40px; height: 40px; border-radius: 50%; background: var(--MI_THEME-accentedBg); font-size: 24px; }
.wave { flex: 1; min-width: 80px; height: 40px; overflow: hidden; }
.time { font-variant-numeric: tabular-nums; font-size: 75%; }
</style>
