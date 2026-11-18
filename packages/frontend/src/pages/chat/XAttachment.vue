<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<XVoiceMessage v-if="attachment.kind === 'voice'" :attachment="attachment"/>
	<button v-else-if="attachment.kind === 'image' && previewUrl" class="_button" :aria-label="i18n.ts._chatPro.preview" @click="preview"><img :src="previewUrl" :alt="attachment.name" :width="attachment.width ?? undefined" :height="attachment.height ?? undefined" :class="$style.image"></button>
	<div v-else :class="$style.file"><i class="ti ti-file"></i> {{ attachment.name }}</div>
	<div :class="$style.details"><span>{{ bytes(attachment.size) }}</span><button class="_textButton" :disabled="loading" @click="download">{{ i18n.ts._chatPro.download }}</button></div>
	<div v-if="failed" role="alert">
		<button v-if="attachment.kind === 'image' && !previewUrl" class="_textButton" @click="loadPreview">{{ failed === 'budget' ? i18n.ts._chatPro.mediaBudget : i18n.ts._chatPro.fileUnavailable }}</button>
		<span v-else>{{ failed === 'budget' ? i18n.ts._chatPro.mediaBudget : i18n.ts._chatPro.fileUnavailable }}</span>
	</div>
	<div v-if="saveError" role="alert">{{ saveError }}</div>
	<div v-if="attachment.legacyExposure === 'possible'" :class="$style.legacy">{{ i18n.ts._chatPro.legacyFile }}</div>
</div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import XVoiceMessage from './XVoiceMessage.vue';
import type { ChatAttachment } from '@/types/chat.js';
import { fetchChatAttachment, isChatMediaBudgetError } from '@/utility/chat-media.js';
import type { ChatMediaLease } from '@/utility/chat-media.js';
import { i18n } from '@/i18n.js';
import bytes from '@/filters/bytes.js';
import * as os from '@/os.js';
import { $i } from '@/i.js';
import { NativeDownloadError, registerNativeDownloadAbort, saveNativeDownload } from '@/utility/native-download.js';

const props = defineProps<{ attachment: ChatAttachment }>();
const previewUrl = ref<string>();
const loading = ref(false);
const failed = ref<'budget' | 'unavailable' | null>(null);
const saveError = ref<string | null>(null);
const controller = new AbortController();
const leases = new Set<ChatMediaLease>();
let previewLease: ChatMediaLease | undefined;
let mounted = true;

function release(lease: ChatMediaLease): void { lease.release(); leases.delete(lease); }

async function loadPreview(): Promise<void> {
	if (props.attachment.kind !== 'image' || !props.attachment.hasPreview) return;
	failed.value = null;
	try {
		const lease = await fetchChatAttachment(props.attachment.id, 'preview', controller.signal);
		if (mounted) {
			if (previewLease) release(previewLease);
			leases.add(lease);
			previewLease = lease;
			previewUrl.value = lease.createObjectURL();
			failed.value = null;
		} else lease.release();
	} catch (error) { if (mounted) failed.value = isChatMediaBudgetError(error) ? 'budget' : 'unavailable'; }
}

async function preview(): Promise<void> {
	if (loading.value) return;
	loading.value = true;
	try {
		const lease = await fetchChatAttachment(props.attachment.id, 'original', controller.signal, props.attachment.size);
		if (!mounted) { lease.release(); return; }
		leases.add(lease);
		const objectUrl = lease.createObjectURL();
		try {
			const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkLightbox.vue').then(module => module.default), { defaultIndex: 0, contents: [{ id: props.attachment.id, type: 'image', url: objectUrl, filename: props.attachment.name }] }, { closed: () => { dispose(); release(lease); } });
		} catch (error) { release(lease); throw error; }
	} catch (error) { failed.value = isChatMediaBudgetError(error) ? 'budget' : 'unavailable'; } finally { loading.value = false; }
}

async function download(): Promise<void> {
	if (loading.value) return;
	loading.value = true;
	failed.value = null;
	saveError.value = null;
	const accountId = $i?.id;
	const saveController = new AbortController();
	const abortSave = (): void => saveController.abort();
	controller.signal.addEventListener('abort', abortSave, { once: true });
	const unregister = registerNativeDownloadAbort(saveController);
	let downloadLease: ChatMediaLease | undefined;
	try {
		const lease = await fetchChatAttachment(props.attachment.id, 'download', saveController.signal, props.attachment.size);
		if (!mounted) { lease.release(); return; }
		leases.add(lease);
		downloadLease = lease;
		if (await saveNativeDownload(lease, props.attachment.name, saveController.signal, () => Boolean(accountId) && $i?.id === accountId)) {
			release(lease);
			os.toast(i18n.ts._androidApp.saved);
			return;
		}
		const objectUrl = lease.createObjectURL();
		const link = window.document.createElement('a');
		link.href = objectUrl;
		link.download = props.attachment.name;
		link.click();
		window.setTimeout(() => release(lease), 60_000);
	} catch (error) {
		if (downloadLease) release(downloadLease);
		if (error instanceof NativeDownloadError) {
			if (error.code !== 'cancelled' && mounted) saveError.value = error.code === 'unsupported' ? i18n.ts._androidApp.updateWebView : error.code === 'busy' ? i18n.ts._androidApp.saveBusy : error.code === 'timeout' ? i18n.ts._androidApp.saveTimeout : i18n.ts._androidApp.saveFailed;
		} else if (mounted && !saveController.signal.aborted) failed.value = isChatMediaBudgetError(error) ? 'budget' : 'unavailable';
	} finally {
		unregister();
		controller.signal.removeEventListener('abort', abortSave);
		loading.value = false;
	}
}

onMounted(loadPreview);
onBeforeUnmount(() => { mounted = false; controller.abort(); for (const lease of leases) lease.release(); leases.clear(); });
</script>

<style module lang="scss">
.root { min-width: 160px; max-width: 100%; }
.image { display: block; max-width: 100%; max-height: 360px; height: auto; object-fit: contain; border-radius: 10px; }
.file { overflow-wrap: anywhere; }
.details { display: flex; gap: 12px; font-size: 80%; margin-top: 8px; }
.legacy { margin-top: 8px; font-size: 75%; color: var(--MI_THEME-warn); }
</style>
