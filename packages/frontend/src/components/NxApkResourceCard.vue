<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<div :class="$style.icon">
		<i class="ti ti-brand-android"></i>
	</div>
	<div :class="$style.body">
		<div :class="$style.name">{{ props.name ?? appName }}</div>
		<div :class="$style.meta">
			<span>APK</span>
			<span>{{ bytes(file.size) }}</span>
			<span v-if="downloadCount != null">{{ downloadCount }} 次下载</span>
			<span>{{ updatedAt }}</span>
		</div>
		<div :class="$style.status">
			<i class="ti ti-package"></i>
			<span>Drive 文件</span>
		</div>
	</div>
	<div :class="$style.action">
		<span>下载</span>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import * as Misskey from 'misskey-js';
import bytes from '@/filters/bytes.js';

const props = defineProps<{
	file: Misskey.entities.DriveFile;
	name?: string;
	downloadCount?: number;
}>();

const appName = computed(() => props.file.name.replace(/\.apk$/i, ''));
const updatedAt = computed(() => new Date(props.file.createdAt).toLocaleDateString());
</script>

<style lang="scss" module>
.root {
	display: grid;
	grid-template-columns: 44px minmax(0, 1fr) auto;
	gap: 10px;
	align-items: center;
	min-height: 92px;
	padding: 12px;
	border: 1px solid color(from var(--MI_THEME-accent) srgb r g b / 0.2);
	border-radius: 10px;
	background: linear-gradient(135deg, color(from var(--MI_THEME-panelHighlight) srgb r g b / 0.95), color(from var(--MI_THEME-panel) srgb r g b / 0.95));
	box-shadow: inset 0 0 0 1px color(from #fff srgb r g b / 0.03);
}

.icon {
	display: grid;
	place-items: center;
	width: 44px;
	height: 44px;
	border-radius: 12px;
	color: #07111f;
	background: linear-gradient(135deg, #68f5c8, #58d8ff);
	font-size: 24px;
}

.body {
	min-width: 0;
}

.name {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-weight: 700;
	color: var(--MI_THEME-fgHighlighted);
}

.meta {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	margin-top: 5px;
	font-size: 0.78em;
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.72);
}

.status {
	display: flex;
	align-items: center;
	gap: 4px;
	margin-top: 6px;
	font-size: 0.78em;
	color: var(--MI_THEME-success);
}

.action {
	align-self: end;
	padding: 6px 10px;
	border-radius: 999px;
	background: var(--MI_THEME-accent);
	color: var(--MI_THEME-fgOnAccent);
	font-size: 0.78em;
	font-weight: 700;
}
</style>
