<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<Teleport to="body">
	<MkModal ref="modal" preferType="drawer" :disableAnimation="reduceMotion" :returnFocusTo="returnFocusTo" @click="emit('close')" @esc="emit('close')" @closed="emit('closed')">
		<section ref="sheet" :class="$style.root" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1" data-testid="kpop-song-sheet" @keydown.tab="cycleFocus">
			<header :class="$style.header">
				<h2 :class="$style.title">{{ title }}</h2>
				<button ref="closeButton" class="_button" :class="$style.close" :aria-label="i18n.ts.close" @click="emit('close')"><i class="ti ti-x" aria-hidden="true"></i></button>
			</header>
			<div :class="$style.body"><slot></slot></div>
		</section>
	</MkModal>
</Teleport>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, useTemplateRef } from 'vue';
import MkModal from '@/components/MkModal.vue';
import { i18n } from '@/i18n.js';
import { lockKpopSheetScroll } from '@/utility/kpop-sheet-scroll-lock.js';

const props = defineProps<{ title: string; returnFocusTo?: HTMLElement | null }>();
const emit = defineEmits<{ (event: 'close'): void; (event: 'closed'): void }>();
const sheet = useTemplateRef('sheet');
const closeButton = useTemplateRef('closeButton');
const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
const reduceMotion = ref(motion.matches);

function updateMotion(): void { reduceMotion.value = motion.matches; }

function cycleFocus(event: KeyboardEvent): void {
	const root = sheet.value;
	if (!root || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
	// Recompute on every key press: history, retry buttons and source links load
	// asynchronously, and closed details must not receive keyboard focus.
	const candidates = [...root.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"]')]
		.filter(el => el.tabIndex >= 0 && !el.matches(':disabled, [aria-disabled="true"]') && !el.closest('[inert]') && el.getClientRects().length > 0 && !['hidden', 'collapse'].includes(window.getComputedStyle(el).visibility))
		.sort((a, b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity));
	const current = window.document.activeElement;
	const first = candidates[0];
	const last = candidates.at(-1);
	if (!first || !last) {
		event.preventDefault();
		root.focus({ preventScroll: true });
	} else if (event.shiftKey && (current === first || !candidates.includes(current as HTMLElement))) {
		event.preventDefault();
		last.focus();
	} else if (!event.shiftKey && (current === last || !candidates.includes(current as HTMLElement))) {
		event.preventDefault();
		first.focus();
	}
}

let releaseScroll: (() => void) | null = null;
onMounted(() => {
	motion.addEventListener('change', updateMotion);
	if (sheet.value) releaseScroll = lockKpopSheetScroll(sheet.value);
	void nextTick(() => closeButton.value?.focus({ preventScroll: true }));
});
onUnmounted(() => {
	motion.removeEventListener('change', updateMotion);
	releaseScroll?.();
	releaseScroll = null;
	// MkModal releases its inert focus trap before this parent's unmounted hook.
	if (props.returnFocusTo?.isConnected) props.returnFocusTo.focus({ preventScroll: true });
	emit('closed');
});
</script>

<style lang="scss" module>
.root {
	display: flex;
	flex-direction: column;
	width: 100%;
	max-width: 699px;
	max-height: min(88dvh, calc(100dvh - env(safe-area-inset-top, 0px) - 16px));
	margin: 0 auto;
	border-radius: var(--MI-radius) var(--MI-radius) 0 0;
	background: var(--MI_THEME-panel);
	color: var(--MI_THEME-fg);
	overflow: hidden;
}
.header {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 12px 12px 12px 16px;
	border-bottom: 1px solid var(--MI_THEME-divider);
	flex-shrink: 0;
}
.title {
	flex: 1;
	min-width: 0;
	margin: 0;
	font-size: 1em;
	overflow-wrap: anywhere;
}
.close {
	display: grid;
	place-items: center;
	width: 44px;
	height: 44px;
	flex-shrink: 0;
	border-radius: var(--MI-radius);
	&:focus-visible { outline: 2px solid var(--MI_THEME-focus); }
}
.body {
	min-height: 0;
	overflow: auto;
	overscroll-behavior: contain;
	padding: 16px 16px max(16px, env(safe-area-inset-bottom, 0px));
}
@media (prefers-reduced-motion: reduce) {
	.root { scroll-behavior: auto; }
}
</style>
