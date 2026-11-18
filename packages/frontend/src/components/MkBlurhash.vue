<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<canvas
	v-show="show"
	ref="canvas"
	draggable="false"
	tabindex="-1"
	style="-webkit-user-drag: none;"
></canvas>
</template>

<script lang="ts">
import DrawBlurhash from '@/workers/draw-blurhash?worker';
import { BlurhashWorkerPool } from '@@/js/blurhash-worker-pool.js';

const pool = new BlurhashWorkerPool(() => new DrawBlurhash());
if (import.meta.hot) import.meta.hot.dispose(() => pool.dispose());
</script>

<script lang="ts" setup>
import { useTemplateRef } from 'vue';
import { useBlurhash } from '@@/js/use-blurhash.js';

const props = withDefaults(defineProps<{
	blurhash: string | null;
	onlyAvgColor?: boolean;
	width?: number;
	height?: number;
	// v-showが何故か動作しないため
	show?: boolean;
}>(), {
	onlyAvgColor: false,
	width: 64,
	height: 64,
	show: true,
});

const canvas = useTemplateRef('canvas');
useBlurhash(canvas, () => ({ hash: props.blurhash, width: props.width, height: props.height, onlyAvgColor: props.onlyAvgColor }), pool);
</script>
