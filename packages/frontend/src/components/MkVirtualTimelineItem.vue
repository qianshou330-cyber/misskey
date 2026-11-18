<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div ref="rootEl" :style="rendered ? undefined : { height: `${height}px` }" :data-virtualized="!rendered" @focusout="onFocusOut" @transitionrun="onMotionStart" @transitionend="onMotionEnd" @transitioncancel="onMotionEnd">
	<div v-if="rendered" ref="contentEl" :class="$style.content"><slot></slot></div>
</div>
</template>

<script lang="ts" setup>
import { inject, nextTick, onBeforeUnmount, onMounted, provide, ref, useTemplateRef, watch } from 'vue';
import { timelineViewportKey, virtualTimelineKey } from '@/utility/timeline-viewport.js';

provide(virtualTimelineKey, true);
const viewport = inject(timelineViewportKey, null);
const rootEl = useTemplateRef('rootEl');
const contentEl = useTemplateRef('contentEl');
const rendered = ref(viewport == null);
const height = ref(180);
let hasMeasuredContent = false;
let nearViewport = false;
let stopObserving: (() => void) | undefined;
let stopMeasuring: (() => void) | undefined;
let finishMotion: (() => void) | undefined;

function updateVisibility(visible: boolean): void {
	nearViewport = visible;
	const element = rootEl.value;
	if (!element || rendered.value === visible) return;
	if (!visible && element.contains(window.document.activeElement)) return;
	// Layout height is unaffected by ancestor transforms.
	if (!visible && contentEl.value && !hasMeasuredContent) height.value = Math.max(1, contentEl.value.offsetHeight);
	rendered.value = visible;
}

function onFocusOut(): void {
	void nextTick(() => updateVisibility(nearViewport));
}

function onMotionStart(event: TransitionEvent): void {
	if (event.target !== rootEl.value || !['transform', 'opacity'].includes(event.propertyName)) return;
	if (!rendered.value || !viewport?.isNear(rootEl.value!)) return;
	finishMotion = viewport?.pin(rootEl.value!);
}

function onMotionEnd(event: TransitionEvent): void {
	if (event.target !== rootEl.value || !['transform', 'opacity'].includes(event.propertyName)) return;
	finishMotion?.();
	finishMotion = undefined;
}

watch(contentEl, content => {
	stopMeasuring?.();
	hasMeasuredContent = false;
	stopMeasuring = content && rootEl.value ? viewport?.observeContent(rootEl.value, content) : undefined;
}, { flush: 'post' });

onMounted(() => {
	if (!rootEl.value || !viewport) return;
	stopObserving = viewport.observe(rootEl.value, {
		visibility: updateVisibility,
		resize: measuredHeight => {
			if (rendered.value) {
				height.value = Math.max(1, measuredHeight);
				hasMeasuredContent = true;
			}
		},
		isRendered: () => rendered.value,
	});
});

onBeforeUnmount(() => {
	stopMeasuring?.();
	stopObserving?.();
	finishMotion?.();
});
</script>

<style lang="scss" module>
.content {
	display: flow-root;
}
</style>
