<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader>
	<div class="_spacer" style="--MI_SPACER-w: 900px;">
		<div :class="$style.root">
			<div :class="$style.toolbar">
				<MkButton
					v-for="item in statusTabs"
					:key="item.value"
					:primary="status === item.value"
					rounded
					@click="setStatus(item.value)"
				>
					{{ item.label }}
				</MkButton>
			</div>

			<div v-if="loading" :class="$style.empty">
				<i class="ti ti-loader"></i>
				<span>加载中...</span>
			</div>

			<div v-else-if="resources.length === 0" :class="$style.empty">
				<i class="ti ti-package"></i>
				<span>暂无 APK 资源</span>
			</div>

			<div v-else :class="$style.list">
				<article v-for="resource in resources" :key="resource.id" :class="$style.item">
					<div :class="$style.main">
						<div :class="$style.titleRow">
							<MkA :to="`/resources/${resource.id}`" :class="$style.title">{{ resource.name }}</MkA>
							<span :class="[$style.status, $style[`status_${resource.status}`]]">{{ statusText(resource.status) }}</span>
						</div>
						<div :class="$style.meta">
							<span>{{ resource.file.name }}</span>
							<span>{{ resource.packageName ?? '未填写包名' }}</span>
							<span>{{ resource.versionName ?? '未填写版本' }}</span>
							<span>{{ resource.downloadCount }} 下载</span>
						</div>
						<p v-if="resource.description" :class="$style.description">{{ resource.description }}</p>
						<div :class="$style.ids">
							<span>资源 ID: {{ resource.id }}</span>
							<span>用户 ID: {{ resource.userId }}</span>
						</div>
					</div>

					<div :class="$style.actions">
						<MkButton v-if="resource.status !== 'published'" primary rounded :wait="busyResourceId === resource.id" @click="updateStatus(resource, 'published')">
							<i class="ti ti-check"></i> 通过
						</MkButton>
						<MkButton v-if="resource.status !== 'rejected'" danger rounded :wait="busyResourceId === resource.id" @click="updateStatus(resource, 'rejected')">
							<i class="ti ti-x"></i> 拒绝
						</MkButton>
						<MkButton v-if="resource.status !== 'pending'" rounded :wait="busyResourceId === resource.id" @click="updateStatus(resource, 'pending')">
							<i class="ti ti-clock"></i> 待审
						</MkButton>
						<MkButton rounded danger :wait="busyResourceId === resource.id" @click="deleteResource(resource)">
							<i class="ti ti-trash"></i> 删除记录
						</MkButton>
					</div>
				</article>
			</div>

			<div v-if="resources.length > 0" :class="$style.more">
				<MkButton rounded :disabled="loading" @click="loadMore">
					<i class="ti ti-chevron-down"></i> 加载更多
				</MkButton>
			</div>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { ref } from 'vue';
import MkButton from '@/components/MkButton.vue';
import * as os from '@/os.js';
import { definePage } from '@/page.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import type { ApkResource, ApkResourceStatus } from '@/types/apk-resource.js';

type AdminApkResourceStatus = ApkResourceStatus | 'all';

const statusTabs: { value: AdminApkResourceStatus; label: string }[] = [
	{ value: 'pending', label: '待审核' },
	{ value: 'published', label: '已发布' },
	{ value: 'rejected', label: '已拒绝' },
	{ value: 'all', label: '全部' },
];

const status = ref<AdminApkResourceStatus>('pending');
const resources = ref<ApkResource[]>([]);
const loading = ref(false);
const busyResourceId = ref<string | null>(null);

function statusText(value: ApkResourceStatus): string {
	switch (value) {
		case 'draft': return '草稿';
		case 'pending': return '待审核';
		case 'published': return '已发布';
		case 'rejected': return '已拒绝';
	}
}

async function load(reset = false) {
	loading.value = true;
	try {
		const items = await misskeyApi<ApkResource[]>('admin/apk/resources/list', {
			limit: 20,
			status: status.value,
			...(reset || resources.value.length === 0 ? {} : { untilId: resources.value.at(-1)?.id }),
		});

		resources.value = reset ? items : [...resources.value, ...items];
	} finally {
		loading.value = false;
	}
}

function loadMore() {
	return load(false);
}

function setStatus(value: AdminApkResourceStatus) {
	status.value = value;
	resources.value = [];
	return load(true);
}

async function updateStatus(resource: ApkResource, nextStatus: Extract<ApkResourceStatus, 'pending' | 'published' | 'rejected'>) {
	busyResourceId.value = resource.id;
	try {
		const updated = await misskeyApi<ApkResource>('admin/apk/resources/update-status', {
			resourceId: resource.id,
			status: nextStatus,
		});
		resources.value = resources.value.map(item => item.id === updated.id ? updated : item).filter(item => status.value === 'all' || item.status === status.value);
	} finally {
		busyResourceId.value = null;
	}
}

async function deleteResource(resource: ApkResource) {
	const { canceled } = await os.confirm({
		type: 'warning',
		text: `删除资源记录：${resource.name}`,
	});
	if (canceled) return;

	busyResourceId.value = resource.id;
	try {
		await misskeyApi('admin/apk/resources/delete', {
			resourceId: resource.id,
		});
		resources.value = resources.value.filter(item => item.id !== resource.id);
	} finally {
		busyResourceId.value = null;
	}
}

load(true);

definePage(() => ({
	title: 'APK 资源审核',
	icon: 'ti ti-packages',
}));
</script>

<style lang="scss" module>
.root {
	display: flex;
	flex-direction: column;
	gap: var(--MI-margin);
}

.toolbar,
.actions,
.more {
	display: flex;
	flex-wrap: wrap;
	gap: 10px;
}

.toolbar {
	position: sticky;
	top: 0;
	z-index: 1;
	padding: 12px 0;
	background: var(--MI_THEME-bg);
}

.list {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.item {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	gap: 18px;
	padding: 18px;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-panel);
}

.main {
	min-width: 0;
}

.titleRow {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 10px;
}

.title {
	font-size: 1.1em;
	font-weight: 700;
	color: var(--MI_THEME-fgHighlighted);
}

.status {
	padding: 3px 9px;
	border-radius: 999px;
	font-size: 0.85em;
	background: var(--MI_THEME-buttonBg);
}

.status_pending {
	color: var(--MI_THEME-warn);
}

.status_published {
	color: var(--MI_THEME-success);
}

.status_rejected {
	color: var(--MI_THEME-error);
}

.status_draft {
	color: var(--MI_THEME-fgTransparentWeak);
}

.meta,
.ids {
	display: flex;
	flex-wrap: wrap;
	gap: 8px 14px;
	margin-top: 8px;
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.68);
	font-size: 0.92em;
}

.description {
	margin: 12px 0 0;
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.78);
	white-space: pre-wrap;
}

.actions {
	align-content: start;
	justify-content: flex-end;
}

.empty {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 10px;
	min-height: 180px;
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.68);
	border: 1px dashed var(--MI_THEME-divider);
	border-radius: var(--MI-radius);
}

.more {
	justify-content: center;
}

@media (max-width: 700px) {
	.item {
		grid-template-columns: 1fr;
	}

	.actions {
		justify-content: flex-start;
	}
}
</style>
