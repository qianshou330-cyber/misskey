<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow ref="dialog" :width="560" :height="620" @close="close" @click="close" @esc="close" @closed="emit('closed')">
	<template #header>{{ i18n.ts._homeAnnouncements.edit }}</template>
	<div class="_spacer _gaps" :class="$style.body" data-testid="announcement-editor">
		<MkLoading v-if="loading"/>
		<p v-if="error" role="alert">{{ error }}</p>
		<template v-if="!loading && !selected">
			<p v-if="choices.length">{{ i18n.ts._homeAnnouncements.select }}</p>
			<MkButton v-for="item in choices" :key="item.id" full @click="select(item)">{{ item.title }}</MkButton>
			<MkButton v-if="error" @click="load">{{ i18n.ts.retry }}</MkButton>
		</template>
		<template v-if="selected">
			<MkInput v-model="title" :disabled="saving" :ariaLabel="i18n.ts.title" data-testid="announcement-title"><template #label>{{ i18n.ts.title }}</template></MkInput>
			<MkTextarea v-model="text" :disabled="saving" :ariaLabel="i18n.ts.text" mfmAutocomplete :mfmPreview="true" data-testid="announcement-text"><template #label>{{ i18n.ts.text }}</template></MkTextarea>
			<MkInput v-model="imageUrl" type="url" :disabled="saving" :ariaLabel="i18n.ts.imageUrl" data-testid="announcement-image"><template #label>{{ i18n.ts.imageUrl }}</template></MkInput>
			<MkButton v-if="conflict" :disabled="saving" @click="reloadSelected">{{ i18n.ts._homeAnnouncements.reload }}</MkButton>
		</template>
	</div>
	<template #footer>
		<div class="_buttons" :class="$style.footer">
			<MkButton :disabled="saving" data-testid="announcement-cancel" @click="close()">{{ i18n.ts.cancel }}</MkButton>
			<MkButton v-if="selected" primary :disabled="!canSave" :wait="saving" data-testid="announcement-save" @click="save">{{ i18n.ts.save }}</MkButton>
		</div>
	</template>
</MkModalWindow>
</template>

<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue';
import type { HomeAnnouncement } from '@/utility/home-announcements.js';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkInput from '@/components/MkInput.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import MkButton from '@/components/MkButton.vue';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { loadHomeAnnouncements } from '@/utility/home-announcements.js';

const props = defineProps<{ initialId: string | null }>();
const emit = defineEmits<{ (event: 'saved'): void; (event: 'closed'): void }>();
const dialog = useTemplateRef('dialog');
const ownerId = $i?.id;
const choices = ref<HomeAnnouncement[]>([]);
const selected = ref<HomeAnnouncement | null>(null);
const title = ref('');
const text = ref('');
const imageUrl = ref('');
const loading = ref(true);
const saving = ref(false);
const unavailable = ref(false);
const conflict = ref(false);
const error = ref('');
let closed = false;
let request: AbortController | null = null;
let timeout: number | null = null;
const authorized = computed(() => $i?.id === ownerId && $i?.isAdmin === true);
const canSave = computed(() => authorized.value && selected.value != null && !saving.value && !loading.value && !unavailable.value && !conflict.value && title.value.trim().length > 0 && text.value.trim().length > 0);

function stopRequest(): void {
	request?.abort();
	request = null;
	if (timeout != null) window.clearTimeout(timeout);
	timeout = null;
}

function beginRequest(): AbortController {
	stopRequest();
	const controller = new AbortController();
	request = controller;
	timeout = window.setTimeout(() => controller.abort(), 15_000);
	return controller;
}

function current(controller: AbortController): boolean {
	return !closed && authorized.value && request === controller;
}

function readActive(controller: AbortController): Promise<HomeAnnouncement[]> {
	return loadHomeAnnouncements((params, signal) => misskeyApi('announcements', params, null, signal), controller.signal);
}

function select(item: HomeAnnouncement): void {
	if (!authorized.value || saving.value) return;
	selected.value = item;
	title.value = item.title;
	text.value = item.text;
	imageUrl.value = item.imageUrl ?? '';
	unavailable.value = false;
	conflict.value = false;
	error.value = '';
}

async function load(): Promise<void> {
	if (!authorized.value || closed) return;
	loading.value = true;
	error.value = '';
	const controller = beginRequest();
	try {
		const items = await readActive(controller);
		if (!current(controller)) return;
		choices.value = items;
		if (props.initialId != null) {
			const item = items.find(value => value.id === props.initialId);
			if (item) select(item);
			else error.value = i18n.ts._homeAnnouncements.unavailable;
		} else if (items.length === 1) {
			select(items[0]);
		} else if (items.length === 0) {
			error.value = i18n.ts._homeAnnouncements.unavailable;
		}
	} catch {
		if (current(controller)) error.value = i18n.ts._homeAnnouncements.loadFailed;
	} finally {
		if (current(controller)) { loading.value = false; stopRequest(); }
	}
}

function reloadSelected(): void {
	const latest = choices.value.find(item => item.id === selected.value?.id);
	if (latest) select(latest);
}

async function save(): Promise<void> {
	if (!canSave.value || !selected.value) return;
	const original = selected.value;
	const values = { id: original.id, title: title.value, text: text.value, imageUrl: imageUrl.value.trim() || null };
	saving.value = true;
	error.value = '';
	const controller = beginRequest();
	try {
		// An ended/deleted/converted announcement must not be revived by an old homepage.
		const items = await readActive(controller);
		if (!current(controller)) return;
		choices.value = items;
		const latest = items.find(item => item.id === original.id);
		if (!latest) {
			unavailable.value = true;
			error.value = i18n.ts._homeAnnouncements.unavailable;
			return;
		}
		if (latest.updatedAt !== original.updatedAt || latest.title !== original.title || latest.text !== original.text || latest.imageUrl !== original.imageUrl) {
			conflict.value = true;
			error.value = i18n.ts._homeAnnouncements.changed;
			return;
		}
		await misskeyApi('admin/announcements/update', values, undefined, controller.signal);
		if (!current(controller)) return;
		emit('saved');
		close(true);
	} catch {
		if (current(controller)) error.value = i18n.ts._homeAnnouncements.saveFailed;
	} finally {
		if (request === controller) { saving.value = false; stopRequest(); }
	}
}

function close(force = false): void {
	if (saving.value && !force) return;
	closed = true;
	stopRequest();
	dialog.value?.close();
}

watch(authorized, allowed => { if (!allowed) close(true); }, { flush: 'sync' });
onMounted(load);
onUnmounted(() => { closed = true; stopRequest(); });
</script>

<style lang="scss" module>
.body { --MI_SPACER-min: 16px; --MI_SPACER-max: 24px; }
.footer { padding: 12px 16px; justify-content: flex-end; }
</style>
