<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader>
	<div class="_spacer" style="--MI_SPACER-w: 900px;">
		<MkLoading v-if="fetching"/>
		<MkError v-else-if="error" @retry="fetchResource"/>
		<div v-else-if="resource" :class="$style.root">
			<section :class="$style.hero">
				<div :class="$style.appIcon">
					<i class="ti ti-brand-android"></i>
				</div>
				<div :class="$style.heroBody">
					<div :class="$style.kicker">APK 资源</div>
					<h1 :class="$style.title">{{ resource.name }}</h1>
					<p :class="$style.summary">{{ resource.description ?? '该资源暂未填写介绍。作者可在下方补充版本、包名、截图等信息。' }}</p>
					<div :class="$style.meta">
						<span>{{ resource.versionName ? `版本：${resource.versionName}` : '版本：待补充' }}</span>
						<span>{{ bytes(resource.file.size) }}</span>
						<span>{{ resource.downloadCount }} 次下载</span>
						<span>{{ new Date(resource.updatedAt).toLocaleString() }}</span>
					</div>
					<div v-if="canEdit && resource.status !== 'published'" :class="$style.reviewStatus">
						<i class="ti ti-clock"></i>
						<span>{{ reviewStatusText }}</span>
					</div>
				</div>
				<MkButton primary rounded :wait="downloading" @click="download">
					<i class="ti ti-download"></i>
					<span>立即下载</span>
				</MkButton>
			</section>

			<section v-if="resource.screenshotFiles.length > 0" :class="$style.panel">
				<h2>截图</h2>
				<div :class="$style.screenshotGrid">
					<a
						v-for="file in resource.screenshotFiles"
						:key="file.id"
						:href="file.url"
						target="_blank"
						rel="noopener"
						:class="$style.screenshotLink"
					>
						<MkDriveFileThumbnail :file="file" fit="cover"/>
					</a>
				</div>
			</section>

			<section :class="$style.grid">
				<div :class="$style.panel">
					<h2>审核状态</h2>
					<p><i :class="statusIcon"></i> {{ statusText }}</p>
					<p>{{ statusDescription }}</p>
					<div v-if="resource.rejectionReason || resource.reviewNote || resource.reviewedAt" :class="$style.reviewInfo">
						<p v-if="resource.rejectionReason">拒绝原因：{{ resource.rejectionReason }}</p>
						<p v-if="resource.reviewNote">审核备注：{{ resource.reviewNote }}</p>
						<p v-if="resource.reviewedAt">审核时间：{{ new Date(resource.reviewedAt).toLocaleString() }}</p>
					</div>
				</div>
				<div :class="$style.panel">
					<h2>资源信息</h2>
					<p>包名：{{ resource.packageName ?? '待补充' }}</p>
					<p>版本号：{{ resource.versionCode ?? '待补充' }}</p>
					<p>文件名：{{ resource.file.name }}</p>
					<p>文件类型：{{ resource.file.type || 'application/vnd.android.package-archive' }}</p>
				</div>
				<div :class="[$style.panel, $style.wide]">
					<h2>维护信息</h2>
					<p>最后更新：{{ new Date(resource.updatedAt).toLocaleString() }}</p>
					<p>资源文件由 Misskey Drive 保存。管理员删除资源记录时不会删除原始 Drive 文件。</p>
				</div>
			</section>

			<section :class="$style.panel">
				<h2>版本历史</h2>
				<MkLoading v-if="versionsFetching"/>
				<div v-else-if="versions.length === 0" :class="$style.versionEmpty">暂无版本记录</div>
				<div v-else :class="$style.versionList">
					<article v-for="version in versions" :key="version.id" :class="$style.versionItem">
						<div>
							<div :class="$style.versionTitle">{{ version.versionName ?? '未填写版本' }}</div>
							<div :class="$style.versionMeta">
								<span>版本号：{{ version.versionCode ?? '待补充' }}</span>
								<span>{{ new Date(version.createdAt).toLocaleString() }}</span>
								<span>{{ version.file.name }}</span>
							</div>
						</div>
						<p v-if="version.changelog" :class="$style.changelog">{{ version.changelog }}</p>
					</article>
				</div>
			</section>

			<section v-if="canEdit" :class="$style.panel">
				<h2>编辑资源信息</h2>
				<input ref="screenshotsInput" type="file" accept="image/*" multiple :class="$style.input" @change="onScreenshotsChange">
				<div :class="$style.form">
					<MkInput v-model="editName" :disabled="saving">
						<template #label>资源名称</template>
					</MkInput>
					<MkInput v-model="editPackageName" :disabled="saving" placeholder="com.example.app">
						<template #label>包名</template>
					</MkInput>
					<div :class="$style.columns">
						<MkInput v-model="editVersionName" :disabled="saving" placeholder="1.0.0">
							<template #label>版本名称</template>
						</MkInput>
						<MkInput v-model="editVersionCode" type="number" :disabled="saving" :min="0">
							<template #label>版本号</template>
						</MkInput>
					</div>
					<MkTextarea v-model="editDescription" :disabled="saving" tall>
						<template #label>介绍</template>
					</MkTextarea>
					<MkTextarea v-model="editChangelog" :disabled="saving" tall>
						<template #label>本次更新日志</template>
					</MkTextarea>
				</div>
				<div :class="$style.editScreenshots">
					<div :class="$style.subTitle">截图</div>
					<MkButton rounded :disabled="saving" @click="chooseScreenshots">
						<i class="ti ti-photo-plus"></i> 上传截图
					</MkButton>
					<div v-if="editScreenshotFiles.length > 0" :class="$style.editScreenshotGrid">
						<div v-for="file in editScreenshotFiles" :key="file.id" :class="$style.editScreenshotItem">
							<MkDriveFileThumbnail :file="file" fit="cover"/>
							<button class="_button" :class="$style.removeButton" type="button" @click="removeScreenshot(file.id)">
								<i class="ti ti-x"></i>
							</button>
						</div>
					</div>
				</div>
				<MkButton primary rounded :disabled="editName.trim().length === 0" :wait="saving" @click="saveMetadata">
					<i class="ti ti-device-floppy"></i> {{ saveButtonText }}
				</MkButton>
			</section>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import * as Misskey from 'misskey-js';
import MkButton from '@/components/MkButton.vue';
import MkDriveFileThumbnail from '@/components/MkDriveFileThumbnail.vue';
import MkInput from '@/components/MkInput.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import bytes from '@/filters/bytes.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { definePage } from '@/page.js';
import { $i } from '@/i.js';
import type { ApkResource, ApkResourceDownload, ApkResourceVersion } from '@/types/apk-resource.js';

const props = defineProps<{
	fileId: string;
}>();

const resource = ref<ApkResource | null>(null);
const fetching = ref(true);
const downloading = ref(false);
const saving = ref(false);
const error = ref<unknown>(null);
const screenshotsInput = ref<HTMLInputElement | null>(null);
const versions = ref<ApkResourceVersion[]>([]);
const versionsFetching = ref(false);

const editName = ref('');
const editPackageName = ref('');
const editVersionName = ref('');
const editVersionCode = ref<number | null>(null);
const editDescription = ref('');
const editChangelog = ref('');
const editScreenshotFiles = ref<Misskey.entities.DriveFile[]>([]);

const title = computed(() => resource.value?.name ?? 'APK 资源');
const canEdit = computed(() => resource.value != null && $i != null && resource.value.userId === $i.id);
const reviewStatusText = computed(() => {
	if (resource.value?.status === 'pending') return '资源已提交审核，通过后会进入公开资源库。';
	if (resource.value?.status === 'rejected') return '资源未通过审核，修改并保存后会重新提交审核。';
	if (resource.value?.status === 'draft') return '资源仍为草稿状态。';
	return '';
});
const saveButtonText = computed(() => resource.value?.status === 'rejected' ? '保存并重新提交' : '保存');
const statusText = computed(() => {
	switch (resource.value?.status) {
		case 'published': return '已发布';
		case 'pending': return '待审核';
		case 'rejected': return '未通过审核';
		case 'draft': return '草稿';
		default: return '未知状态';
	}
});
const statusDescription = computed(() => {
	switch (resource.value?.status) {
		case 'published': return '该资源已进入公开资源库，登录用户可以查看并下载。';
		case 'pending': return '该资源正在等待管理员审核，目前只有作者可以查看。';
		case 'rejected': return '该资源未通过审核，作者修改并保存后会重新进入待审核状态。';
		case 'draft': return '该资源尚未进入公开审核流程。';
		default: return '暂时无法识别该资源的审核状态。';
	}
});
const statusIcon = computed(() => {
	switch (resource.value?.status) {
		case 'published': return 'ti ti-circle-check';
		case 'pending': return 'ti ti-clock';
		case 'rejected': return 'ti ti-circle-x';
		case 'draft': return 'ti ti-pencil';
		default: return 'ti ti-info-circle';
	}
});

function hydrateEditForm() {
	if (!resource.value) return;
	editName.value = resource.value.name;
	editPackageName.value = resource.value.packageName ?? '';
	editVersionName.value = resource.value.versionName ?? '';
	editVersionCode.value = resource.value.versionCode;
	editDescription.value = resource.value.description ?? '';
	editChangelog.value = '';
	editScreenshotFiles.value = [...resource.value.screenshotFiles];
}

async function fetchVersions() {
	if (!resource.value) return;
	versionsFetching.value = true;
	try {
		versions.value = await misskeyApi<ApkResourceVersion[]>('apk/resources/versions', {
			resourceId: resource.value.id,
			limit: 20,
		});
	} finally {
		versionsFetching.value = false;
	}
}

function fetchResource() {
	fetching.value = true;
	error.value = null;
	misskeyApi<ApkResource>('apk/resources/show', {
		resourceId: props.fileId,
	}).then(res => {
		resource.value = res;
		hydrateEditForm();
		return fetchVersions();
	}).catch(err => {
		error.value = err;
	}).finally(() => {
		fetching.value = false;
	});
}

async function download() {
	if (!resource.value) return;
	downloading.value = true;
	try {
		const res = await misskeyApi<ApkResourceDownload>('apk/resources/download', {
			resourceId: resource.value.id,
		});
		resource.value.downloadCount = res.downloadCount;
		window.open(res.url, '_blank', 'noopener');
	} finally {
		downloading.value = false;
	}
}

async function saveMetadata() {
	if (!resource.value || editName.value.trim().length === 0) return;
	saving.value = true;
	try {
		resource.value = await misskeyApi<ApkResource>('apk/resources/update', {
			resourceId: resource.value.id,
			name: editName.value.trim(),
			packageName: editPackageName.value.trim() || null,
			versionName: editVersionName.value.trim() || null,
			versionCode: editVersionCode.value,
			changelog: editChangelog.value.trim() || null,
			description: editDescription.value.trim() || null,
			screenshotFileIds: editScreenshotFiles.value.map(file => file.id),
		});
		hydrateEditForm();
		await fetchVersions();
	} finally {
		saving.value = false;
	}
}

function chooseScreenshots() {
	screenshotsInput.value?.click();
}

async function onScreenshotsChange(ev: Event) {
	const input = ev.target as HTMLInputElement;
	const files = Array.from(input.files ?? []).filter(file => file.type.startsWith('image/'));
	input.value = '';
	if (files.length === 0) return;

	const driveFiles = await os.launchUploader(files, {
		multiple: true,
		features: {
			imageEditing: false,
			watermark: false,
		},
	});
	const map = new Map([...editScreenshotFiles.value, ...driveFiles].map(file => [file.id, file]));
	editScreenshotFiles.value = Array.from(map.values()).slice(0, 8);
}

function removeScreenshot(fileId: string) {
	editScreenshotFiles.value = editScreenshotFiles.value.filter(file => file.id !== fileId);
}

watch(() => props.fileId, fetchResource, { immediate: true });

definePage(() => ({
	title: title.value,
	icon: 'ti ti-brand-android',
}));
</script>

<style lang="scss" module>
.root {
	display: flex;
	flex-direction: column;
	gap: var(--MI-margin);
}

.hero,
.panel {
	border: 1px solid color(from var(--MI_THEME-accent) srgb r g b / 0.18);
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-panel);
}

.hero {
	display: grid;
	grid-template-columns: 88px minmax(0, 1fr) auto;
	gap: 20px;
	align-items: center;
	padding: 24px;
}

.appIcon {
	display: grid;
	place-items: center;
	width: 88px;
	height: 88px;
	border-radius: 22px;
	background: linear-gradient(135deg, #68f5c8, #58d8ff);
	color: #07111f;
	font-size: 48px;
}

.heroBody {
	min-width: 0;
}

.kicker {
	margin-bottom: 6px;
	color: var(--MI_THEME-accent);
	font-size: 0.85em;
	font-weight: 700;
}

.title {
	margin: 0;
	font-size: 1.8em;
	line-height: 1.2;
}

.summary {
	margin: 10px 0 0;
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.74);
}

.meta {
	display: flex;
	flex-wrap: wrap;
	gap: 10px;
	margin-top: 14px;
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.72);
	font-size: 0.9em;
}

.reviewStatus {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	margin-top: 12px;
	padding: 8px 10px;
	border-radius: 8px;
	color: var(--MI_THEME-warn);
	background: color(from var(--MI_THEME-warn) srgb r g b / 0.12);
}

.grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: var(--MI-margin);
}

.panel {
	padding: 20px;
}

.panel h2 {
	margin: 0 0 12px;
	font-size: 1.1em;
}

.panel p {
	margin: 8px 0 0;
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.78);
}

.reviewInfo {
	display: grid;
	gap: 4px;
	margin-top: 12px;
	padding: 10px 12px;
	border-radius: 8px;
	background: color(from var(--MI_THEME-accent) srgb r g b / 0.08);
}

.reviewInfo p {
	margin: 0;
	white-space: pre-wrap;
}

.wide {
	grid-column: 1 / -1;
}

.versionEmpty {
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.68);
}

.versionList {
	display: grid;
	gap: 12px;
}

.versionItem {
	display: grid;
	gap: 8px;
	padding: 14px;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 8px;
}

.versionTitle {
	font-weight: 700;
	color: var(--MI_THEME-fgHighlighted);
}

.versionMeta {
	display: flex;
	flex-wrap: wrap;
	gap: 8px 14px;
	margin-top: 6px;
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.68);
	font-size: 0.92em;
}

.changelog {
	margin: 0;
	white-space: pre-wrap;
}

.input {
	display: none;
}

.form {
	display: flex;
	flex-direction: column;
	gap: 14px;
	margin-bottom: 16px;
}

.columns {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 14px;
}

.screenshotGrid {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 10px;
}

.screenshotLink {
	display: block;
	aspect-ratio: 16 / 9;
	overflow: clip;
	border-radius: 8px;
}

.screenshotLink > * {
	width: 100%;
	height: 100%;
}

.editScreenshots {
	display: flex;
	flex-direction: column;
	gap: 12px;
	margin-bottom: 16px;
}

.subTitle {
	font-weight: 700;
	color: var(--MI_THEME-fgHighlighted);
}

.editScreenshotGrid {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	gap: 10px;
}

.editScreenshotItem {
	position: relative;
	aspect-ratio: 16 / 9;
	overflow: clip;
	border-radius: 8px;
}

.editScreenshotItem > :first-child {
	width: 100%;
	height: 100%;
}

.removeButton {
	position: absolute;
	top: 6px;
	right: 6px;
	display: grid;
	place-items: center;
	width: 28px;
	height: 28px;
	border-radius: 999px;
	background: color(from #000 srgb r g b / 0.62);
	color: #fff;
}

@media (max-width: 700px) {
	.hero {
		grid-template-columns: 64px minmax(0, 1fr);
	}

	.appIcon {
		width: 64px;
		height: 64px;
		border-radius: 16px;
		font-size: 34px;
	}

	.grid,
	.columns,
	.screenshotGrid,
	.editScreenshotGrid {
		grid-template-columns: 1fr;
	}
}
</style>
