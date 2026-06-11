<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader>
	<div class="_spacer" style="--MI_SPACER-w: 760px;">
		<div :class="$style.root">
			<section :class="$style.panel">
				<div :class="$style.icon"><i class="ti ti-upload"></i></div>
				<h1>上传 APK</h1>
				<p>APK 文件会先进入 Misskey Drive，再创建 NexusHub 资源记录。Drive 上传、权限和存储限制保持不变。</p>

				<input ref="fileInput" type="file" accept=".apk,application/vnd.android.package-archive" :class="$style.input" @change="onFileChange">
				<input ref="screenshotsInput" type="file" accept="image/*" multiple :class="$style.input" @change="onScreenshotsChange">
				<div :class="$style.fileRow">
					<MkButton rounded @click="chooseFile">
						<i class="ti ti-package-import"></i> 选择 APK 文件
					</MkButton>
					<span :class="$style.fileName">{{ selectedFile?.name ?? '尚未选择文件' }}</span>
				</div>

				<div :class="$style.form">
					<MkInput v-model="name" :disabled="uploading">
						<template #label>资源名称</template>
					</MkInput>
					<MkInput v-model="packageName" :disabled="uploading" placeholder="com.example.app">
						<template #label>包名</template>
						<template #caption>{{ packageNameCaption }}</template>
					</MkInput>
					<div :class="$style.columns">
						<MkInput v-model="versionName" :disabled="uploading" placeholder="1.0.0">
							<template #label>版本名称</template>
						</MkInput>
						<MkInput v-model="versionCode" type="number" :disabled="uploading" :min="0">
							<template #label>版本号</template>
						</MkInput>
					</div>
					<MkTextarea v-model="description" :disabled="uploading" tall>
						<template #label>介绍</template>
					</MkTextarea>
					<MkTextarea v-model="changelog" :disabled="uploading" tall>
						<template #label>更新日志</template>
					</MkTextarea>
				</div>

				<div :class="$style.screenshots">
					<div :class="$style.subTitle">截图</div>
					<div :class="$style.fileRow">
						<MkButton rounded :disabled="uploading" @click="chooseScreenshots">
							<i class="ti ti-photo-plus"></i> 选择截图
						</MkButton>
						<span :class="$style.fileName">{{ selectedScreenshots.length }} / 8</span>
					</div>
					<div v-if="selectedScreenshots.length > 0" :class="$style.screenshotList">
						<div v-for="(file, index) in selectedScreenshots" :key="`${file.name}-${index}`" :class="$style.screenshotName">
							<span>{{ file.name }}</span>
							<button class="_button" :class="$style.removeButton" type="button" @click="removeScreenshot(index)">
								<i class="ti ti-x"></i>
							</button>
						</div>
					</div>
				</div>

				<MkButton primary rounded :disabled="!canSubmit" :wait="uploading" @click="upload">
					<i class="ti ti-upload"></i> 发布到资源库
				</MkButton>
			</section>

			<section v-if="createdResource" :class="$style.panel">
				<h2>上传完成</h2>
				<NxApkResourceCard :file="createdResource.file" :name="createdResource.name" :downloadCount="createdResource.downloadCount"/>
				<div :class="$style.actions">
					<MkButton rounded type="routerLink" :to="`/resources/${createdResource.id}`">
						<i class="ti ti-info-circle"></i> 查看详情
					</MkButton>
					<MkButton rounded type="routerLink" to="/resources">
						<i class="ti ti-cloud"></i> 打开资源库
					</MkButton>
				</div>
			</section>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, ref, useTemplateRef } from 'vue';
import MkButton from '@/components/MkButton.vue';
import MkInput from '@/components/MkInput.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import NxApkResourceCard from '@/components/NxApkResourceCard.vue';
import * as os from '@/os.js';
import { definePage } from '@/page.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import type { ApkResource } from '@/types/apk-resource.js';

const fileInput = useTemplateRef<HTMLInputElement>('fileInput');
const screenshotsInput = useTemplateRef<HTMLInputElement>('screenshotsInput');
const selectedFile = ref<File | null>(null);
const selectedScreenshots = ref<File[]>([]);
const createdResource = ref<ApkResource | null>(null);
const uploading = ref(false);

const name = ref('');
const packageName = ref('');
const versionName = ref('');
const versionCode = ref<number | null>(null);
const description = ref('');
const changelog = ref('');

const packageNameValid = computed(() => packageName.value.trim().length === 0 || /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(packageName.value.trim()));
const packageNameCaption = computed(() => packageNameValid.value ? '例如：com.example.app' : '包名格式不正确，应包含至少两段并以点分隔。');
const canSubmit = computed(() => selectedFile.value != null && name.value.trim().length > 0 && packageNameValid.value && !uploading.value);

function chooseFile() {
	fileInput.value?.click();
}

function chooseScreenshots() {
	screenshotsInput.value?.click();
}

function onFileChange(ev: Event) {
	const input = ev.target as HTMLInputElement;
	const file = input.files?.[0] ?? null;
	input.value = '';
	if (!file) return;

	if (!file.name.toLowerCase().endsWith('.apk')) {
		os.alert({
			type: 'warning',
			text: '请选择 .apk 文件。',
		});
		return;
	}

	if (file.size > 200 * 1024 * 1024) {
		os.alert({
			type: 'warning',
			text: 'APK 文件不能超过 200 MiB。',
		});
		return;
	}

	selectedFile.value = file;
	if (name.value.trim().length === 0) {
		name.value = file.name.replace(/\.apk$/i, '');
	}
}

function onScreenshotsChange(ev: Event) {
	const input = ev.target as HTMLInputElement;
	const files = Array.from(input.files ?? []);
	input.value = '';
	if (files.length === 0) return;
	selectedScreenshots.value = [...selectedScreenshots.value, ...files.filter(file => file.type.startsWith('image/'))].slice(0, 8);
}

function removeScreenshot(index: number) {
	selectedScreenshots.value = selectedScreenshots.value.filter((_, i) => i !== index);
}

async function upload() {
	if (!selectedFile.value || !canSubmit.value) return;

	uploading.value = true;
	try {
		const driveFiles = await os.launchUploader([selectedFile.value], {
			multiple: false,
			features: {
				imageEditing: false,
				watermark: false,
			},
		});
		const uploadedFile = driveFiles[0] ?? null;
		if (!uploadedFile) return;

		const screenshotDriveFiles = selectedScreenshots.value.length === 0 ? [] : await os.launchUploader(selectedScreenshots.value, {
			multiple: true,
			features: {
				imageEditing: false,
				watermark: false,
			},
		});

		createdResource.value = await misskeyApi<ApkResource>('apk/resources/create', {
			driveFileId: uploadedFile.id,
			name: name.value.trim(),
			packageName: packageName.value.trim() || null,
			versionName: versionName.value.trim() || null,
			versionCode: versionCode.value,
			changelog: changelog.value.trim() || null,
			description: description.value.trim() || null,
			screenshotFileIds: screenshotDriveFiles.map(file => file.id),
		});
	} finally {
		uploading.value = false;
	}
}

definePage(() => ({
	title: '上传 APK',
	icon: 'ti ti-upload',
}));
</script>

<style lang="scss" module>
.root {
	display: flex;
	flex-direction: column;
	gap: var(--MI-margin);
}

.panel {
	padding: 28px;
	border: 1px solid color(from var(--MI_THEME-accent) srgb r g b / 0.18);
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-panel);
}

.icon {
	display: grid;
	place-items: center;
	width: 56px;
	height: 56px;
	border-radius: 16px;
	background: color(from var(--MI_THEME-accent) srgb r g b / 0.16);
	color: var(--MI_THEME-accent);
	font-size: 30px;
}

.panel h1,
.panel h2 {
	margin: 18px 0 8px;
}

.panel p {
	margin: 0 0 20px;
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.76);
}

.input {
	display: none;
}

.fileRow {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 12px;
	margin-bottom: 20px;
}

.fileName {
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.74);
}

.form {
	display: flex;
	flex-direction: column;
	gap: 14px;
	margin-bottom: 20px;
}

.screenshots {
	margin-bottom: 20px;
}

.subTitle {
	margin-bottom: 10px;
	font-weight: 700;
	color: var(--MI_THEME-fgHighlighted);
}

.screenshotList {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.screenshotName {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 10px;
	padding: 8px 10px;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 8px;
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.78);
}

.removeButton {
	color: var(--MI_THEME-fg);
}

.columns {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 14px;
}

.actions {
	display: flex;
	flex-wrap: wrap;
	gap: 10px;
	margin-top: 16px;
}

@media (max-width: 600px) {
	.columns {
		grid-template-columns: 1fr;
	}
}
</style>
