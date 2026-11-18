<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root" class="_gaps_s">
	<div role="status">{{ recording ? i18n.ts._chatPro.recording : i18n.ts._chatPro.preview }} <span>{{ seconds }} {{ i18n.ts._time.second }}</span></div>
	<button v-if="!recording && !previewUrl" class="_buttonPrimary" :disabled="requesting || finishing" @click="start">{{ i18n.ts._chatPro.record }}</button>
	<button v-if="recording" class="_buttonPrimary" @click="stop">{{ i18n.ts._chatPro.stopRecording }}</button>
	<template v-if="previewUrl"><div ref="waveEl"></div><audio ref="audioEl" :src="previewUrl" :aria-label="i18n.ts._chatPro.preview" controls preload="metadata" @play="onPreviewPlay"></audio></template>
	<div v-if="error" role="alert">{{ error }}</div>
	<div class="_buttons"><button v-if="recordedFile" class="_buttonPrimary" @click="accept">{{ i18n.ts._chatPro.sendVoice }}</button><button class="_textButton" @click="cancel">{{ i18n.ts._chatPro.discardRecording }}</button></div>
</div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue';
import type WaveSurfer from 'wavesurfer.js';
import { i18n } from '@/i18n.js';
import { claimChatAudio, releaseChatAudio } from '@/utility/chat-media.js';

const emit = defineEmits<{ (event: 'recorded', file: File): void; (event: 'cancel'): void }>();
const recording = ref(false);
const requesting = ref(false);
const finishing = ref(false);
const seconds = ref(0);
const previewUrl = ref<string>();
const error = ref('');
const recordedFile = ref<File>();
const audioEl = useTemplateRef('audioEl');
const waveEl = useTemplateRef('waveEl');
type RecordingSession = { recorder: MediaRecorder; chunks: Blob[]; generation: number; finished: boolean; stopRequested: boolean };
let session: RecordingSession | undefined;
let microphone: MediaStream | undefined;
let waveform: WaveSurfer | undefined;
let tick: number | undefined;
let deadline: number | undefined;
let generation = 0;
let mounted = true;
let pageHidden = false;

function releaseMicrophone(): void {
	const stream = microphone;
	microphone = undefined;
	for (const track of stream?.getTracks() ?? []) { track.onended = null; track.onmute = null; track.stop(); }
	window.clearInterval(tick);
	window.clearTimeout(deadline);
	tick = undefined;
	deadline = undefined;
}

function inForeground(): boolean { return mounted && !pageHidden && !window.document.hidden; }

function stop(): void {
	const current = session;
	recording.value = false;
	if (current && !current.finished && !current.stopRequested) {
		current.stopRequested = true;
		finishing.value = true;
		try {
			if (current.recorder.state !== 'inactive') current.recorder.stop();
		} catch { void finish(current); }
	}
	releaseMicrophone();
}

async function finish(current: RecordingSession): Promise<void> {
	if (current.finished) return;
	current.finished = true;
	current.recorder.ondataavailable = null;
	current.recorder.onerror = null;
	current.recorder.onstop = null;
	if (session === current) { session = undefined; releaseMicrophone(); recording.value = false; finishing.value = false; }
	if (!mounted || current.generation !== generation) return;
	if (!current.chunks.length) { error.value ||= i18n.ts._chatPro.recordingInterrupted; return; }
	const type = current.recorder.mimeType || current.chunks[0].type;
	const extension = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
	recordedFile.value = new File(current.chunks, `voice-${Date.now()}.${extension}`, { type });
	previewUrl.value = URL.createObjectURL(recordedFile.value);
	await nextTick();
	try {
		const library = await import('wavesurfer.js');
		if (!mounted || current.generation !== generation || !waveEl.value || !audioEl.value) return;
		const theme = getComputedStyle(waveEl.value);
		const preview = library.default.create({ container: waveEl.value, media: audioEl.value, url: previewUrl.value, height: 48, waveColor: theme.getPropertyValue('--MI_THEME-fgTransparentWeak').trim(), progressColor: theme.getPropertyValue('--MI_THEME-accent').trim(), barWidth: 3 });
		waveform = preview;
		preview.on('error', () => { if (waveform === preview) { waveform = undefined; preview.destroy(); } });
	} catch { /* Native audio controls remain available when waveform decoding fails. */ }
}

function interrupt(): void {
	if (requesting.value) { generation++; requesting.value = false; }
	if (session || recording.value) stop();
	error.value = i18n.ts._chatPro.recordingInterrupted;
}

async function start(): Promise<void> {
	if (!inForeground() || requesting.value || recording.value || finishing.value || recordedFile.value) return;
	const current = ++generation;
	requesting.value = true;
	error.value = '';
	try {
		if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('RECORDING_UNSUPPORTED');
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		if (!inForeground() || current !== generation) { stream.getTracks().forEach(track => track.stop()); return; }
		microphone = stream;
		const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
		const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
		const active: RecordingSession = { recorder, chunks: [], generation: current, finished: false, stopRequested: false };
		session = active;
		recorder.ondataavailable = event => { if (event.data.size > 0 && current === generation && !active.finished) active.chunks.push(event.data); };
		recorder.onerror = () => { if (current === generation) { error.value = i18n.ts._chatPro.microphoneError; stop(); } };
		recorder.onstop = () => { void finish(active); };
		for (const track of stream.getTracks()) { track.onended = interrupt; track.onmute = interrupt; }
		seconds.value = 0;
		recorder.start(250);
		recording.value = true;
		const started = performance.now();
		tick = window.setInterval(() => { seconds.value = Math.min(300, Math.floor((performance.now() - started) / 1000)); }, 250);
		deadline = window.setTimeout(stop, 300_000);
	} catch {
		if (mounted && current === generation) { error.value = i18n.ts._chatPro.microphoneError; stop(); if (session) void finish(session); }
	} finally { if (current === generation) requesting.value = false; }
}

function accept(): void { if (recordedFile.value) emit('recorded', recordedFile.value); }

function cancel(): void { generation++; requesting.value = false; stop(); emit('cancel'); }

function onPreviewPlay(): void { if (audioEl.value) { if (inForeground()) claimChatAudio(audioEl.value); else audioEl.value.pause(); } }

function background(): void {
	pageHidden = true;
	audioEl.value?.pause();
	if (requesting.value || recording.value || session) interrupt();
}

function visibility(): void { if (window.document.hidden) background(); else pageHidden = false; }

function foreground(): void { pageHidden = false; }

onMounted(() => { window.document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', background); window.addEventListener('pageshow', foreground); });
onBeforeUnmount(() => {
	mounted = false;
	generation++;
	stop();
	waveform?.destroy();
	if (audioEl.value) releaseChatAudio(audioEl.value);
	if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
	window.document.removeEventListener('visibilitychange', visibility);
	window.removeEventListener('pagehide', background);
	window.removeEventListener('pageshow', foreground);
});
</script>

<style module lang="scss">
.root { padding: 12px; border: 1px solid var(--MI_THEME-divider); border-radius: 12px; background: var(--MI_THEME-panel); }
.root audio { width: 100%; }
</style>
