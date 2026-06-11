<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader>
	<div class="_spacer" style="--MI_SPACER-w: 1040px;">
		<div :class="$style.root">
			<section :class="$style.hero">
				<div>
					<div :class="$style.kicker">NexusHub</div>
					<h1>资源库</h1>
					<p>集中展示已发布的 APK 资源。文件仍由 Drive 存储，资源库负责应用信息、下载统计和后续审核流程。</p>
				</div>
				<div :class="$style.actions">
					<MkButton primary rounded type="routerLink" to="/resources/upload">
						<i class="ti ti-package-import"></i> 上传 APK
					</MkButton>
					<MkButton rounded type="routerLink" to="/my/drive">
						<i class="ti ti-cloud"></i> 文件管理
					</MkButton>
				</div>
			</section>

			<MkLoading v-if="fetching"/>
			<MkError v-else-if="error" @retry="fetchResources"/>
			<div v-else-if="resources.length === 0" :class="$style.empty">
				<i class="ti ti-package-off"></i>
				<div>暂无 APK 资源</div>
			</div>
			<div v-else :class="$style.grid">
				<MkA
					v-for="resource in resources"
					:key="resource.id"
					:class="$style.cardLink"
					:to="`/resources/${resource.id}`"
				>
					<NxApkResourceCard :file="resource.file" :name="resource.name" :downloadCount="resource.downloadCount"/>
				</MkA>
			</div>

			<MkButton v-if="canFetchMore && !fetching" :class="$style.more" primary rounded @click="fetchMore">
				{{ i18n.ts.loadMore }}
			</MkButton>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { ref } from 'vue';
import MkButton from '@/components/MkButton.vue';
import NxApkResourceCard from '@/components/NxApkResourceCard.vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import type { ApkResource } from '@/types/apk-resource.js';

const limit = 20;
const resources = ref<ApkResource[]>([]);
const fetching = ref(true);
const error = ref<unknown>(null);
const canFetchMore = ref(false);

async function fetchResources() {
	fetching.value = true;
	error.value = null;

	try {
		const items = await misskeyApi<ApkResource[]>('apk/resources/list', {
			limit,
		});
		resources.value = items;
		canFetchMore.value = items.length === limit;
	} catch (err) {
		error.value = err;
	} finally {
		fetching.value = false;
	}
}

async function fetchMore() {
	const last = resources.value.at(-1);
	if (!last) return;

	fetching.value = true;
	error.value = null;

	try {
		const items = await misskeyApi<ApkResource[]>('apk/resources/list', {
			limit,
			untilId: last.id,
		});
		resources.value = [...resources.value, ...items];
		canFetchMore.value = items.length === limit;
	} catch (err) {
		error.value = err;
	} finally {
		fetching.value = false;
	}
}

fetchResources();

definePage(() => ({
	title: '资源库',
	icon: 'ti ti-packages',
}));
</script>

<style lang="scss" module>
.root {
	display: flex;
	flex-direction: column;
	gap: var(--MI-margin);
}

.hero {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 20px;
	padding: 24px;
	border: 1px solid color(from var(--MI_THEME-accent) srgb r g b / 0.18);
	border-radius: var(--MI-radius);
	background: linear-gradient(135deg, color(from var(--MI_THEME-panelHighlight) srgb r g b / 0.92), var(--MI_THEME-panel));
}

.kicker {
	margin-bottom: 6px;
	color: var(--MI_THEME-accent);
	font-size: 0.85em;
	font-weight: 700;
}

.hero h1 {
	margin: 0;
	font-size: 1.8em;
	line-height: 1.2;
}

.hero p {
	max-width: 620px;
	margin: 10px 0 0;
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.76);
}

.actions {
	display: flex;
	flex-wrap: wrap;
	justify-content: flex-end;
	gap: 10px;
}

.grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: var(--MI-margin);
}

.cardLink {
	display: block;
	color: inherit;
	text-decoration: none;
}

.empty {
	display: grid;
	place-items: center;
	gap: 10px;
	min-height: 180px;
	padding: 28px;
	border: 1px dashed color(from var(--MI_THEME-accent) srgb r g b / 0.28);
	border-radius: var(--MI-radius);
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.7);
	background: color(from var(--MI_THEME-panel) srgb r g b / 0.72);
	text-align: center;
}

.empty i {
	color: var(--MI_THEME-accent);
	font-size: 34px;
}

.more {
	margin-right: auto;
	margin-left: auto;
}

@media (max-width: 700px) {
	.hero {
		align-items: stretch;
		flex-direction: column;
	}

	.actions {
		justify-content: flex-start;
	}

	.grid {
		grid-template-columns: 1fr;
	}
}
</style>
