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
					<p>集中展示已发布的 APK 资源。作者可以在“我的资源”中查看待审核、已发布和被拒绝的资源。</p>
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

			<section :class="$style.filters">
				<div :class="$style.segmented">
					<MkButton
						v-for="item in ownerTabs"
						:key="item.value"
						:primary="owner === item.value"
						rounded
						@click="setOwner(item.value)"
					>
						{{ item.label }}
					</MkButton>
				</div>

				<div v-if="owner === 'me'" :class="$style.segmented">
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

				<div :class="$style.searchRow">
					<MkInput v-model="queryInput" :class="$style.search" placeholder="搜索资源名、包名或文件名" @keydown.enter="applySearch">
						<template #prefix><i class="ti ti-search"></i></template>
					</MkInput>
					<MkButton rounded :disabled="fetching" @click="applySearch">搜索</MkButton>
					<MkButton v-if="query" rounded :disabled="fetching" @click="clearSearch">清空</MkButton>
				</div>

				<div :class="$style.segmented">
					<MkButton
						v-for="item in sortTabs"
						:key="item.value"
						:primary="sort === item.value"
						rounded
						@click="setSort(item.value)"
					>
						{{ item.label }}
					</MkButton>
				</div>
			</section>

			<MkLoading v-if="fetching && resources.length === 0"/>
			<MkError v-else-if="error" @retry="fetchResources"/>
			<div v-else-if="resources.length === 0" :class="$style.empty">
				<i class="ti ti-package-off"></i>
				<div>{{ emptyText }}</div>
			</div>
			<div v-else :class="$style.grid">
				<MkA
					v-for="resource in resources"
					:key="resource.id"
					:class="$style.cardLink"
					:to="`/resources/${resource.id}`"
				>
					<div :class="$style.cardWrap">
						<NxApkResourceCard :file="resource.file" :name="resource.name" :downloadCount="resource.downloadCount"/>
						<div v-if="owner === 'me'" :class="[$style.status, $style[`status_${resource.status}`]]">
							{{ statusText(resource.status) }}
						</div>
					</div>
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
import { computed, ref } from 'vue';
import MkButton from '@/components/MkButton.vue';
import MkInput from '@/components/MkInput.vue';
import NxApkResourceCard from '@/components/NxApkResourceCard.vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import type { ApkResource, ApkResourceStatus } from '@/types/apk-resource.js';

type OwnerFilter = 'all' | 'me';
type StatusFilter = ApkResourceStatus | 'all';
type SortFilter = 'latest' | 'downloads';

const limit = 20;
const ownerTabs: { value: OwnerFilter; label: string }[] = [
	{ value: 'all', label: '全部资源' },
	{ value: 'me', label: '我的资源' },
];
const statusTabs: { value: StatusFilter; label: string }[] = [
	{ value: 'all', label: '全部状态' },
	{ value: 'pending', label: '待审核' },
	{ value: 'published', label: '已发布' },
	{ value: 'rejected', label: '已拒绝' },
	{ value: 'draft', label: '草稿' },
];
const sortTabs: { value: SortFilter; label: string }[] = [
	{ value: 'latest', label: '最新' },
	{ value: 'downloads', label: '下载量' },
];

const owner = ref<OwnerFilter>('all');
const status = ref<StatusFilter>('all');
const sort = ref<SortFilter>('latest');
const query = ref('');
const queryInput = ref('');
const resources = ref<ApkResource[]>([]);
const fetching = ref(true);
const error = ref<unknown>(null);
const canFetchMore = ref(false);

const emptyText = computed(() => {
	if (query.value) return '没有匹配的 APK 资源';
	return owner.value === 'me' ? '你还没有 APK 资源' : '暂无已发布 APK 资源';
});

function statusText(value: ApkResourceStatus): string {
	switch (value) {
		case 'draft': return '草稿';
		case 'pending': return '待审核';
		case 'published': return '已发布';
		case 'rejected': return '已拒绝';
	}
}

function requestParams(untilId?: string) {
	return {
		limit,
		owner: owner.value,
		status: owner.value === 'me' ? status.value : 'all',
		sort: sort.value,
		...(query.value ? { query: query.value } : {}),
		...(untilId ? { untilId } : {}),
	};
}

async function fetchResources() {
	fetching.value = true;
	error.value = null;

	try {
		const items = await misskeyApi<ApkResource[]>('apk/resources/list', requestParams());
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
		const items = await misskeyApi<ApkResource[]>('apk/resources/list', requestParams(last.id));
		resources.value = [...resources.value, ...items];
		canFetchMore.value = items.length === limit;
	} catch (err) {
		error.value = err;
	} finally {
		fetching.value = false;
	}
}

function resetAndFetch() {
	resources.value = [];
	canFetchMore.value = false;
	return fetchResources();
}

function setOwner(value: OwnerFilter) {
	owner.value = value;
	return resetAndFetch();
}

function setStatus(value: StatusFilter) {
	status.value = value;
	return resetAndFetch();
}

function setSort(value: SortFilter) {
	sort.value = value;
	return resetAndFetch();
}

function applySearch() {
	query.value = queryInput.value.trim();
	return resetAndFetch();
}

function clearSearch() {
	query.value = '';
	queryInput.value = '';
	return resetAndFetch();
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

.actions,
.segmented,
.searchRow {
	display: flex;
	flex-wrap: wrap;
	gap: 10px;
}

.actions {
	justify-content: flex-end;
}

.filters {
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding: 16px;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-panel);
}

.searchRow {
	align-items: center;
}

.search {
	flex: 1 1 260px;
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

.cardWrap {
	position: relative;
}

.status {
	position: absolute;
	top: 12px;
	right: 12px;
	padding: 4px 9px;
	border-radius: 999px;
	font-size: 0.85em;
	font-weight: 700;
	background: var(--MI_THEME-panel);
	box-shadow: 0 1px 6px color(from #000 srgb r g b / 0.16);
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
