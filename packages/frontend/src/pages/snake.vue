<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader>
	<div class="_spacer" style="--MI_SPACER-w: 1100px;">
		<div class="_gaps">
			<header :class="$style.heading">
				<div><h1>{{ i18n.ts._snakeGame.title }}</h1><p>{{ i18n.ts._snakeGame.description }}</p></div>
				<MkA to="/games">{{ i18n.ts._snakeGame.allGames }}</MkA>
			</header>
			<div v-if="!enabled" class="_panel" :class="$style.message" data-testid="snake-disabled">{{ i18n.ts._snakeGame.unavailable }}</div>
			<div v-else-if="!$i" class="_panel" :class="$style.message" data-testid="snake-signin">
				<p>{{ i18n.ts._snakeGame.signin }}</p>
				<MkButton primary @click="pleaseLogin()">{{ i18n.ts.login }}</MkButton>
			</div>
			<template v-else>
				<div :class="$style.status" aria-live="polite" data-testid="snake-status">
					<span>{{ statusText }}</span>
					<span>{{ i18n.ts._snakeGame.humans }} {{ humans }} / {{ maxHumans }}</span>
					<span>{{ i18n.ts._snakeGame.computers }} {{ bots }}</span>
					<strong>{{ i18n.ts._snakeGame.score }} {{ score }}</strong>
				</div>
				<div :class="$style.layout">
					<div :class="$style.arena" class="_panel">
						<div ref="surfaceEl" tabindex="0" :class="$style.surface" :aria-label="i18n.ts._snakeGame.controls" data-testid="snake-surface">
							<canvas ref="canvasEl" :class="$style.canvas" :aria-label="i18n.ts._snakeGame.title" role="img"></canvas>
						</div>
						<div v-if="status !== 'playing'" :class="$style.overlay" data-testid="snake-overlay">
							<h2>{{ statusText }}</h2>
							<p v-if="status === 'dead'">{{ i18n.ts._snakeGame.score }} {{ score }}</p>
							<p v-if="errorText" role="alert">{{ errorText }}</p>
							<MkButton primary :disabled="status === 'connecting'" data-testid="snake-start" @click="start">{{ status === 'idle' ? i18n.ts.start : i18n.ts._snakeGame.playAgain }}</MkButton>
						</div>
						<button ref="boostEl" class="_button" :class="$style.boost" :disabled="status !== 'playing'" :aria-label="i18n.ts._snakeGame.boost" data-testid="snake-boost"><i class="ti ti-bolt" aria-hidden="true"></i> {{ i18n.ts._snakeGame.boost }}</button>
					</div>
					<aside class="_panel" :class="$style.ranking" :aria-label="i18n.ts._snakeGame.ranking">
						<h2>{{ i18n.ts._snakeGame.ranking }}</h2>
						<ol data-testid="snake-ranking">
							<li v-for="row in ranking" :key="row.id" :class="{ [$style.self]: row.id === selfId }"><span :class="$style.nickname">{{ row.name }}<small v-if="row.isBot">{{ i18n.ts._snakeGame.computer }}</small></span><strong>{{ row.score }}</strong></li>
						</ol>
						<p v-if="ranking.length === 0">{{ i18n.ts._snakeGame.waiting }}</p>
					</aside>
				</div>
				<p :class="$style.help">{{ i18n.ts._snakeGame.controls }}</p>
				<p :class="$style.help">{{ i18n.ts._snakeGame.rules }}</p>
			</template>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue';
import MkButton from '@/components/MkButton.vue';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { $i } from '@/i.js';
import { pleaseLogin } from '@/utility/please-login.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { SnakeClient, loadSnakeSocket } from '@/games/snake/client.js';
import { SnakeControls } from '@/games/snake/input.js';
import { drawSnake } from '@/games/snake/renderer.js';
import { useSnakeAvailability } from '@/games/snake/availability.js';
import type { SnakeRank, SnakeStatus, SnakeTicket } from '@/games/snake/types.js';

const enabled = useSnakeAvailability();
const surfaceEl = useTemplateRef('surfaceEl');
const canvasEl = useTemplateRef('canvasEl');
const boostEl = useTemplateRef('boostEl');
const status = ref<SnakeStatus>('idle');
const score = ref(0);
const code = ref('');
const humans = ref(0);
const maxHumans = ref(20);
const bots = ref(0);
const ranking = shallowRef<SnakeRank[]>([]);
const selfId = ref('');
const pageActive = ref(true);
let controls: SnakeControls | null = null;
let observer: ResizeObserver | null = null;
let frame = 0;
let mounted = false;

const client = new SnakeClient({
	ticket: signal => misskeyApi<SnakeTicket>('games/snake/session', {}, undefined, signal),
	factory: loadSnakeSocket,
	origin: window.location.origin,
	changed: () => {
		const began = status.value !== 'playing' && client.status === 'playing';
		status.value = client.status;
		code.value = client.code;
		score.value = client.score;
		humans.value = client.scene.current?.humans ?? 0;
		maxHumans.value = client.maxHumans;
		bots.value = client.scene.current?.bots ?? 0;
		ranking.value = client.scene.current?.leaderboard ?? [];
		selfId.value = client.scene.selfId;
		if (client.status !== 'playing') controls?.resetBoost();
		if (began) void nextTick(() => surfaceEl.value?.focus({ preventScroll: true }));
	},
});

const statusText = computed(() => ({ idle: i18n.ts._snakeGame.ready, connecting: i18n.ts._snakeGame.connecting, playing: i18n.ts._snakeGame.playing, dead: i18n.ts._snakeGame.gameOver, disconnected: i18n.ts._snakeGame.disconnected, error: i18n.ts._snakeGame.failed })[status.value]);
const errorText = computed(() => {
	if (!code.value) return '';
	if (code.value === 'FULL') return i18n.ts._snakeGame.full;
	if (code.value === 'DUPLICATE') return i18n.ts._snakeGame.duplicate;
	if (['TICKET_INVALID', 'TICKET_EXPIRED', 'TICKET_REPLAY', 'TICKET_BEFORE_BOOT'].includes(code.value)) return i18n.ts._snakeGame.ticketExpired;
	return i18n.ts._snakeGame.retry;
});

async function start(): Promise<void> {
	if (!pageActive.value || !enabled.value || !$i) return;
	await client.start();
}

function draw(now: number): void {
	if (!pageActive.value || !canvasEl.value) return;
	if (!window.document.hidden) {
		drawSnake(canvasEl.value, client.scene, now, i18n.ts._snakeGame.computer);
		if (client.status === 'playing') {
			const input = controls?.frame(now);
			if (input) client.input(input);
		}
	}
	frame = requestAnimationFrame(draw);
}

function releaseCanvas(): void {
	if (frame) cancelAnimationFrame(frame);
	frame = 0;
	controls?.dispose();
	controls = null;
	observer?.disconnect();
	observer = null;
}

function attachCanvas(): void {
	releaseCanvas();
	if (!mounted || !pageActive.value || !enabled.value || !$i || !surfaceEl.value || !boostEl.value || !canvasEl.value) return;
	controls = new SnakeControls(surfaceEl.value, boostEl.value);
	observer = new ResizeObserver(() => { if (canvasEl.value) drawSnake(canvasEl.value, client.scene, performance.now(), i18n.ts._snakeGame.computer); });
	observer.observe(surfaceEl.value);
	frame = requestAnimationFrame(draw);
}

function visibilityChanged(): void {
	if (!window.document.hidden) return;
	controls?.resetBoost();
	const input = controls?.frame(performance.now());
	if (input && client.status === 'playing') client.input(input);
}

function activate(): void {
	pageActive.value = true;
	if (!mounted) return;
	window.document.removeEventListener('visibilitychange', visibilityChanged);
	window.document.addEventListener('visibilitychange', visibilityChanged);
	void nextTick(attachCanvas);
}

function deactivate(): void {
	pageActive.value = false;
	client.close();
	releaseCanvas();
	window.document.removeEventListener('visibilitychange', visibilityChanged);
}

watch([enabled, surfaceEl], () => {
	if (!enabled.value) client.close();
	void nextTick(attachCanvas);
});
onMounted(() => { mounted = true; activate(); });
onActivated(activate);
onDeactivated(deactivate);
onBeforeUnmount(() => { mounted = false; deactivate(); });
definePage(() => ({ title: i18n.ts._snakeGame.title, icon: 'ti ti-device-gamepad' }));
</script>

<style lang="scss" module>
.heading { display: flex; justify-content: space-between; align-items: center; gap: 16px; h1 { margin: 0 0 8px; font-size: 1.5em; } p { margin: 0; opacity: .75; } }
.message { padding: 32px; text-align: center; }
.status { display: flex; gap: 16px; flex-wrap: wrap; font-size: .9em; }
.layout { display: grid; grid-template-columns: minmax(0, 1fr) 220px; gap: 16px; }
.arena { position: relative; min-width: 0; overflow: hidden; border-radius: var(--MI-radius); }
.surface { height: min(68vh, 640px); min-height: 340px; touch-action: none; outline-offset: -3px; &:focus-visible { outline: 2px solid var(--MI_THEME-focus); } }
.canvas { display: block; width: 100%; height: 100%; }
.overlay { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 12px; padding: 24px; text-align: center; background: color-mix(in srgb, var(--MI_THEME-panel) 88%, transparent); h2, p { margin: 0; } }
.boost { position: absolute; bottom: 16px; right: 16px; padding: 16px 20px; border-radius: 999px; background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); touch-action: none; user-select: none; &:disabled { opacity: .45; } &:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 2px; } }
.ranking { padding: 16px; h2 { font-size: 1em; margin: 0 0 16px; } ol { margin: 0; padding-left: 24px; } li { padding: 7px 0; overflow-wrap: anywhere; } strong { float: right; margin-left: 8px; } small { margin-left: 6px; color: var(--MI_THEME-warn); } }
.nickname { overflow-wrap: anywhere; }
.self { color: var(--MI_THEME-accent); }
.help { margin: 0; font-size: .9em; opacity: .75; line-height: 1.6; }
@media (max-width: 800px) { .layout { grid-template-columns: minmax(0, 1fr); } .ranking ol { columns: 2; } .heading { align-items: start; flex-direction: column; } }
</style>
