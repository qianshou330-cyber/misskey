<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div ref="root" :class="$style.root" :style="{ minHeight: `${minHeight}px` }" :aria-busy="!component && !failed">
	<slot v-if="component && active" :component="component"></slot>
	<MkError v-else-if="failed" @retry="load"/>
	<MkLoading v-else/>
</div>
</template>

<script lang="ts" setup>
import { onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, shallowRef, useTemplateRef } from 'vue';
import type { Component } from 'vue';
import MkError from '@/components/global/MkError.vue';

const props = withDefaults(defineProps<{
	loader: () => Promise<{ default: Component }>;
	deferred?: boolean;
	nearViewport?: boolean;
	minHeight?: number;
}>(), { deferred: false, nearViewport: false, minHeight: 150 });
const root = useTemplateRef('root');
const component = shallowRef<Component>();
const failed = ref(false);
const active = ref(false);
let pending = false;
let frame = 0;
let idle: number | undefined;
let timer: number | undefined;
let observer: IntersectionObserver | undefined;
let disposed = false;

function cancel() {
	cancelAnimationFrame(frame);
	if (idle !== undefined) window.cancelIdleCallback(idle);
	window.clearTimeout(timer);
	observer?.disconnect();
	observer = undefined;
}

async function load() {
	if (!active.value || pending || component.value) return;
	cancel();
	failed.value = false;
	pending = true;
	try {
		const result = await props.loader();
		if (!disposed) component.value = result.default;
	} catch {
		if (!disposed) failed.value = true;
	} finally {
		pending = false;
	}
}

function ready() {
	if (!active.value) return;
	cancel();
	if (props.nearViewport && root.value && typeof IntersectionObserver !== 'undefined') {
		observer = new IntersectionObserver(entries => {
			if (entries.some(entry => entry.isIntersecting)) void load();
		});
		observer.observe(root.value);
	} else {
		void load();
	}
}

function activate() {
	if (active.value) return;
	active.value = true;
	if (component.value || failed.value) return;
	if (!props.deferred) { ready(); return; }
	// Two frames allow the primary content to paint before optional imports start.
	// The timer also handles browsers without idle callbacks or throttled frames.
	timer = window.setTimeout(ready, 1000);
	frame = requestAnimationFrame(() => {
		frame = requestAnimationFrame(() => {
			if ('requestIdleCallback' in window) idle = window.requestIdleCallback(ready, { timeout: 1000 });
			else ready();
		});
	});
}

function deactivate() { active.value = false; cancel(); }

onMounted(activate);
onActivated(activate);
onDeactivated(deactivate);
onBeforeUnmount(() => { disposed = true; deactivate(); });
</script>

<style lang="scss" module>
.root {
	min-width: 0;
}
</style>
