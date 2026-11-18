<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<div v-if="items.length" :class="$style.items">
		<div v-for="item in items" :key="item.key" :class="$style.item">
			<img v-if="item.preview" :src="item.preview" :alt="item.name" :class="$style.thumbnail">
			<span :class="$style.name">{{ item.name }}</span>
			<progress v-if="item.uploading" :value="item.progress" max="1" :aria-label="i18n.ts.uploading"></progress>
			<span v-if="item.failed && item.failureCode" role="alert" :class="$style.failure">{{ item.failureCode === 'CHAT_REPLY_REQUIRED' ? i18n.ts._chatPro.replyRequired : i18n.ts._chatPro.firstMessageTextOnly }}</span>
			<button v-if="item.failed" class="_textButton" @click="retry(item)">{{ item.failureCode ? i18n.ts._chatPro.retry : i18n.ts._chatPro.uploadFailed }}</button>
			<button class="_button" :aria-label="i18n.ts.remove" @click="remove(item)"><i class="ti ti-x"></i></button>
		</div>
	</div>
	<XVoiceRecorder v-if="recording" @recorded="onRecorded" @cancel="recording = false"/>
</div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import XVoiceRecorder from './XVoiceRecorder.vue';
import type { ChatAttachment, ChatSendFailureCode } from '@/types/chat.js';
import { CHAT_ATTACHMENT_LIMIT, uploadChatAttachment } from '@/utility/chat-media.js';
import { chatApi } from '@/utility/chat-api.js';
import { getChatSendFailureCode } from '@/utility/chat-send-failure.js';
import { chooseDriveFile } from '@/utility/drive.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';

type UploadItem = { key: string; name: string; file?: File; driveId?: string; kind: 'file' | 'voice'; attachment?: ChatAttachment; uploading: boolean; failed: boolean; failureCode?: ChatSendFailureCode; progress: number; preview?: string; abort?: () => void; removed: boolean };
const props = defineProps<{ userId: string }>();
const attachments = defineModel<ChatAttachment[]>({ required: true });
const emit = defineEmits<{ (event: 'busy', busy: boolean): void }>();
const items = ref<UploadItem[]>([]);
const recording = ref(false);
const canAddAttachments = computed(() => items.value.length < CHAT_ATTACHMENT_LIMIT);
const busy = computed(() => recording.value || items.value.some(item => item.uploading || item.failed));
watch(busy, value => emit('busy', value), { immediate: true });
watch(attachments, values => {
	for (const item of items.value) if (item.attachment && !values.some(value => value.id === item.attachment!.id)) { item.removed = true; if (item.preview) URL.revokeObjectURL(item.preview); }
	items.value = items.value.filter(item => !item.removed);
});
let mounted = true;

async function retry(item: UploadItem): Promise<void> {
	if (item.uploading || item.removed) return;
	item.uploading = true;
	item.failed = false;
	item.failureCode = undefined;
	try {
		let result: ChatAttachment;
		if (item.driveId) result = await chatApi('chat/attachments/import-drive', { toUserId: props.userId, fileId: item.driveId });
		else {
			const upload = uploadChatAttachment(item.file!, props.userId, item.kind, progress => { item.progress = progress; });
			item.abort = upload.abort;
			result = await upload.promise;
		}
		if (!mounted || item.removed) { await chatApi('chat/attachments/delete', { attachmentId: result.id }); return; }
		item.attachment = result;
		attachments.value = [...attachments.value, result];
	} catch (error) {
		if (!item.removed) { item.failed = true; item.failureCode = getChatSendFailureCode(error); }
	} finally { item.uploading = false; item.abort = undefined; }
}

function addFiles(files: File[], kind: 'file' | 'voice' = 'file'): void {
	if (items.value.length + files.length > CHAT_ATTACHMENT_LIMIT) { void os.alert({ type: 'error', text: i18n.ts._chatPro.attachmentLimit }); return; }
	for (const file of files) {
		const item: UploadItem = { key: crypto.randomUUID(), name: file.name, file, kind, uploading: false, failed: false, progress: 0, removed: false, preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined };
		items.value.push(item);
		void retry(items.value.at(-1)!);
	}
}

function addDriveFiles(files: { id: string; name: string }[]): void {
	if (items.value.length + files.length > CHAT_ATTACHMENT_LIMIT) { void os.alert({ type: 'error', text: i18n.ts._chatPro.attachmentLimit }); return; }
	for (const file of files) { items.value.push({ key: crypto.randomUUID(), name: file.name, driveId: file.id, kind: 'file', uploading: false, failed: false, progress: 0, removed: false }); void retry(items.value.at(-1)!); }
}

async function remove(item: UploadItem): Promise<void> {
	item.removed = true;
	item.abort?.();
	if (item.preview) URL.revokeObjectURL(item.preview);
	items.value = items.value.filter(value => value.key !== item.key);
	if (item.attachment) { attachments.value = attachments.value.filter(value => value.id !== item.attachment!.id); try { await chatApi('chat/attachments/delete', { attachmentId: item.attachment.id }); } catch { /* Unsent staging expires on the server. */ } }
}

function choose(event: PointerEvent): void {
	if (!mounted || !canAddAttachments.value) return;
	os.popupMenu([
		{ text: i18n.ts._chatPro.fromDevice, icon: 'ti ti-upload', action: async () => { addFiles(await os.chooseFileFromPc({ multiple: true })); } },
		{ text: i18n.ts._chatPro.fromDrive, icon: 'ti ti-cloud', action: async () => {
			addDriveFiles(await chooseDriveFile({ multiple: true }));
		} },
	], event.currentTarget ?? event.target);
}

function onRecorded(file: File): void { recording.value = false; addFiles([file], 'voice'); }

function toggleRecording(): void {
	if (!mounted || (!recording.value && !canAddAttachments.value)) return;
	recording.value = !recording.value;
}

defineExpose({ addFiles, addDriveFiles, choose, toggleRecording, canAddAttachments, recording });
onBeforeUnmount(() => { mounted = false; for (const item of [...items.value]) void remove(item); });
</script>

<style module lang="scss">
.root { padding: 0 12px; }
.items { display: flex; overflow-x: auto; gap: 8px; padding: 8px 0; }
.item { display: flex; flex-direction: column; position: relative; flex: 0 0 110px; gap: 4px; padding: 8px; border: 1px solid var(--MI_THEME-divider); border-radius: 10px; }
.thumbnail { width: 100%; height: 60px; object-fit: cover; border-radius: 6px; }
.name { font-size: 75%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item progress { width: 100%; }
.failure { font-size: 80%; overflow-wrap: anywhere; }
</style>
