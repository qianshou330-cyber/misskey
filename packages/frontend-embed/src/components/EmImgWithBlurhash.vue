<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div ref="root" :class="['chromatic-ignore', $style.root, { [$style.cover]: cover }]" :title="title ?? ''">
	<canvas v-show="hide" key="canvas" ref="canvas" :class="$style.canvas" :title="title ?? undefined" tabindex="-1"></canvas>
	<img v-show="!hide" key="img" ref="img" :height="imgHeight ?? undefined" :width="imgWidth ?? undefined" :class="$style.img" :src="src ?? undefined" :title="title ?? undefined" :alt="alt ?? undefined" loading="eager" decoding="async" tabindex="-1"/>
</div>
</template>

<script lang="ts">
import DrawBlurhash from '@/workers/draw-blurhash?worker';
import { BlurhashWorkerPool } from '@@/js/blurhash-worker-pool.js';

const pool = new BlurhashWorkerPool(() => new DrawBlurhash());
if (import.meta.hot) import.meta.hot.dispose(() => pool.dispose());
</script>

<script lang="ts" setup>
import { computed, nextTick, onBeforeUnmount, useTemplateRef, watch, ref } from 'vue';
import { useBlurhash } from '@@/js/use-blurhash.js';

const props = withDefaults(defineProps<{
	src?: string | null;
	hash?: string | null;
	alt?: string | null;
	title?: string | null;
	height?: number;
	width?: number;
	cover?: boolean;
	forceBlurhash?: boolean;
	onlyAvgColor?: boolean;
}>(), {
	src: null,
	alt: '',
	title: null,
	height: 64,
	width: 64,
	cover: true,
	forceBlurhash: false,
	onlyAvgColor: false,
});

const canvas = useTemplateRef('canvas');
const root = useTemplateRef('root');
const img = useTemplateRef('img');
const loaded = ref(false);
const imgWidth = ref(props.width);
const imgHeight = ref(props.height);
const hide = computed(() => !loaded.value || props.forceBlurhash);
let disposed = false;
let decodeGeneration = 0;

useBlurhash(canvas, () => ({ hash: props.hash ?? null, width: props.width, height: props.height, onlyAvgColor: props.onlyAvgColor }), pool);

watch([() => props.width, () => props.height, root], () => {
	const sourceRatio = props.width / props.height;
	const ratio = Number.isFinite(sourceRatio) && sourceRatio > 0 ? sourceRatio : 1;
	const clientWidth = root.value?.clientWidth ?? 300;
	imgWidth.value = clientWidth;
	imgHeight.value = Math.round(clientWidth / ratio);
}, { immediate: true });

watch([() => props.src, img], async () => {
	const generation = ++decodeGeneration;
	loaded.value = false;
	if (!props.src || disposed) return;
	await nextTick();
	const element = img.value;
	if (!element || disposed) return;
	try {
		await element.decode();
		if (!disposed && generation === decodeGeneration) loaded.value = true;
	} catch {
		// Keep the placeholder if the image fails or its source changes.
	}
}, { immediate: true });

onBeforeUnmount(() => {
	disposed = true;
	decodeGeneration++;
});
</script>

<style lang="scss" module>
.root {
	position: relative;
	width: 100%;
	height: 100%;

	&.cover {
		> .canvas,
		> .img {
			object-fit: cover;
		}
	}
}

.canvas,
.img {
	display: block;
	width: 100%;
	height: 100%;
}

.canvas {
	object-fit: contain;
}

.img {
	object-fit: contain;
}
</style>
