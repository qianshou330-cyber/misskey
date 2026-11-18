<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div
	ref="composerEl"
	:class="$style.root"
	@dragover.stop="onDragover"
	@drop.stop="onDrop"
>
	<div v-if="user && reply" :class="$style.reply">
		<XReply :reply="reply" :accountId="$i.id"/>
		<button type="button" class="_button" :class="$style.cancelReply" :aria-label="i18n.ts._chatDaily.cancelReply" @click="reply = null"><i class="ti ti-x"></i></button>
	</div>
	<textarea
		ref="textareaEl"
		v-model="text"
		:class="$style.textarea"
		:placeholder="i18n.ts.inputMessageHere"
		:aria-label="i18n.ts.inputMessageHere"
		:readonly="textareaReadOnly"
		:rows="user ? 1 : 2"
		@keydown="onKeydown"
		@input="onInput"
		@paste="onPaste"
	></textarea>
	<div v-if="user && sendError" :class="$style.sendError" role="alert">{{ i18n.ts._chatPro.outboxFull }}</div>
	<XAttachmentComposer v-if="user" ref="attachmentComposer" v-model="attachments" :userId="user.id" @busy="attachmentsBusy = $event"/>
	<footer :class="$style.footer">
		<button v-if="file && !user" class="_button" :class="$style.file" :aria-label="i18n.ts.remove" @click="file = null">{{ file.name }}</button>
		<div :class="[$style.buttons, { [$style.privateButtons]: user }]">
			<button v-if="user" class="_button" :class="$style.button" :disabled="!attachmentComposer?.canAddAttachments" :title="i18n.ts._chatPro.attachments" :aria-label="i18n.ts._chatPro.attachments" @click="attachmentComposer?.choose($event)"><i class="ti ti-paperclip"></i></button>
			<button v-else class="_button" :class="$style.button" :aria-label="i18n.ts.selectFile" @click="chooseFile"><i class="ti ti-photo-plus"></i></button>
			<button v-if="user" class="_button" :class="$style.button" :disabled="!attachmentComposer || (!attachmentComposer.recording && !attachmentComposer.canAddAttachments)" :title="i18n.ts._chatPro.voice" :aria-label="i18n.ts._chatPro.voice" :aria-pressed="attachmentComposer?.recording ?? false" @click="attachmentComposer?.toggleRecording()"><i class="ti ti-microphone"></i></button>
			<button class="_button" :class="$style.button" :aria-label="i18n.ts.emoji" @pointerdown="rememberEmojiFocus" @focus="rememberEmojiFocus" @click="insertEmoji"><i class="ti ti-mood-happy"></i></button>
			<button class="_button" :class="[$style.button, $style.send]" :disabled="!canSend || sending" :aria-label="i18n.ts.send" :title="i18n.ts.send" @pointerdown="onSendPointerDown" @click="send">
				<template v-if="!sending"><i class="ti ti-send"></i></template><template v-if="sending"><MkLoading :em="true"/></template>
			</button>
		</div>
	</footer>
	<input ref="fileEl" style="display: none;" type="file" @change="onChangeFile"/>
</div>
</template>

<script lang="ts" setup>
import { onMounted, onActivated, onDeactivated, watch, ref, shallowRef, computed, nextTick, onBeforeUnmount, useTemplateRef } from 'vue';
import * as Misskey from 'misskey-js';
//import insertTextAtCursor from 'insert-text-at-cursor';
import { formatTimeString } from '@/utility/format-time-string.js';
import { selectFile } from '@/utility/drive.js';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { miLocalStorage } from '@/local-storage.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { prefer } from '@/preferences.js';
import { Autocomplete } from '@/utility/autocomplete.js';
import { emojiPicker } from '@/utility/emoji-picker.js';
import { checkDragDataType, getDragData } from '@/drag-and-drop.js';
import { ensureSignin } from '@/i.js';
import { useChatOutbox } from '@/composables/use-chat-outbox.js';
import { chatDraftKey } from '@/utility/chat-state.js';
import { deviceKind } from '@/utility/device-kind.js';
import XAttachmentComposer from './XAttachmentComposer.vue';
import XReply from './XReply.vue';
import type { ChatAttachment, ChatMessage, ChatReply, ChatSendSnapshot } from '@/types/chat.js';

const props = defineProps<{
	user?: Misskey.entities.UserDetailed | null;
	room?: Misskey.entities.ChatRoom | null;
}>();

const emit = defineEmits<{
	(ev: 'beforeResize'): void;
	(ev: 'afterResize'): void;
}>();

const reply = defineModel<ChatReply | null>('reply', { default: null });

const composerEl = shallowRef<HTMLDivElement>();
const textareaEl = shallowRef<HTMLTextAreaElement>();
const fileEl = shallowRef<HTMLInputElement>();
const $i = ensureSignin();
const privateOutbox = props.user ? useChatOutbox($i.id, props.user.id) : null;
let retainedSnapshot: ChatSendSnapshot | undefined;
let retainedRevision = 0;
let textRevision = 0;

function accepted(message: ChatMessage): void {
	if (message.clientMessageId !== retainedSnapshot?.clientMessageId) return;
	if (textRevision === retainedRevision) { text.value = ''; reply.value = null; }
	retainedSnapshot = undefined;
}

const attachmentComposer = useTemplateRef('attachmentComposer');
const attachments = ref<ChatAttachment[]>([]);
const attachmentsBusy = ref(false);

const text = ref<string>('');
const file = ref<Misskey.entities.DriveFile | null>(null);
const sending = ref(false);
const sendError = ref(false);
const textareaReadOnly = ref(false);
let autocompleteInstance: Autocomplete | null = null;
let resizeObserver: ResizeObserver | null = null;
let resizeFrame: number | undefined;
let active = false;
let focusGeneration = 0;
let emojiWasFocused = false;
let observedWidth = 0;
let observedViewport: VisualViewport | null = null;

const canSend = computed(() => $i.policies.chatAvailability === 'available' && (!props.user || (props.user.canChat && props.user.host === null)) && !reply.value?.unavailable && !reply.value?.recalledAt && !attachmentsBusy.value && (text.value.trim() !== '' || (props.user ? attachments.value.length > 0 : file.value != null)));

function getDraftKey() {
	return chatDraftKey($i.id, props.user ? 'user:' + props.user.id : 'room:' + props.room?.id);
}

watch([text, file], saveDraft);
watch([text, () => reply.value?.id], () => { textRevision++; sendError.value = false; }, { flush: 'sync' });
watch(reply, scheduleResize, { flush: 'post' });
watch(text, scheduleResize, { flush: 'post' });

function isCompact(): boolean {
	return Boolean(props.user && (deviceKind === 'smartphone' || (composerEl.value?.clientWidth || window.innerWidth) <= 500));
}

function getViewportHeight(): number {
	if (window.visualViewport?.height) return window.visualViewport.height;
	const configured = Number.parseFloat(window.getComputedStyle(composerEl.value ?? window.document.documentElement).getPropertyValue('--MI-chatViewportHeight'));
	if (Number.isFinite(configured) && configured > 0) return configured;
	return window.document.documentElement.clientHeight;
}

function scheduleResize(): void {
	if (!active || resizeFrame != null) return;
	resizeFrame = window.requestAnimationFrame(() => {
		resizeFrame = undefined;
		autoResize();
	});
}

function onInput(): void {
	sendError.value = false;
	scheduleResize();
}

function autoResize(): void {
	const textarea = textareaEl.value;
	if (textarea == null || !active) return;

	const compact = isCompact();
	const minHeight = compact ? 48 : 80;
	const maxHeight = Math.max(minHeight, Math.min(compact ? 160 : 200, getViewportHeight() * 0.3));
	if (props.user) emit('beforeResize');
	textarea.style.minHeight = `${minHeight}px`;
	textarea.style.maxHeight = `${maxHeight}px`;
	textarea.style.padding = compact ? '12px' : '16px 16px 0';
	textarea.style.height = 'auto';
	const height = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
	textarea.style.height = `${height}px`;
	textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
	if (props.user) emit('afterResize');
}

function invalidateEditingFocus(): void {
	focusGeneration++;
	emojiWasFocused = false;
	textareaReadOnly.value = false;
}

function onVisibilityChange(): void {
	if (window.document.hidden) invalidateEditingFocus();
}

function activate(): void {
	if (active) return;
	active = true;
	if (composerEl.value) {
		observedWidth = composerEl.value.clientWidth;
		resizeObserver = new ResizeObserver(() => {
			const width = composerEl.value?.clientWidth ?? 0;
			if (width === observedWidth) return;
			observedWidth = width;
			scheduleResize();
		});
		resizeObserver.observe(composerEl.value);
	}
	observedViewport = window.visualViewport;
	observedViewport?.addEventListener('resize', scheduleResize, { passive: true });
	observedViewport?.addEventListener('scroll', scheduleResize, { passive: true });
	window.addEventListener('resize', scheduleResize, { passive: true });
	window.document.addEventListener('visibilitychange', onVisibilityChange);
	scheduleResize();
}

function deactivate(): void {
	active = false;
	invalidateEditingFocus();
	resizeObserver?.disconnect();
	resizeObserver = null;
	observedViewport?.removeEventListener('resize', scheduleResize);
	observedViewport?.removeEventListener('scroll', scheduleResize);
	observedViewport = null;
	window.removeEventListener('resize', scheduleResize);
	window.document.removeEventListener('visibilitychange', onVisibilityChange);
	if (resizeFrame != null) window.cancelAnimationFrame(resizeFrame);
	resizeFrame = undefined;
}

async function onPaste(ev: ClipboardEvent) {
	if (!ev.clipboardData) return;
	if (props.user) {
		const files = Array.from(ev.clipboardData.files);
		if (files.length) { ev.preventDefault(); attachmentComposer.value?.addFiles(files); }
		return;
	}

	const pastedFileName = 'yyyy-MM-dd HH-mm-ss [{{number}}]';

	const clipboardData = ev.clipboardData;
	const items = clipboardData.items;

	if (items.length === 1) {
		if (items[0].kind === 'file') {
			const pastedFile = items[0].getAsFile();
			if (!pastedFile) return;
			const lio = pastedFile.name.lastIndexOf('.');
			const ext = lio >= 0 ? pastedFile.name.slice(lio) : '';
			const formattedName = formatTimeString(new Date(pastedFile.lastModified), pastedFileName).replace(/{{number}}/g, '1') + ext;
			const renamedFile = new File([pastedFile], formattedName, { type: pastedFile.type });
			os.launchUploader([renamedFile], { multiple: false }).then(driveFiles => {
				file.value = driveFiles[0];
			});
		}
	} else {
		if (items[0].kind === 'file') {
			os.alert({
				type: 'error',
				text: i18n.ts.onlyOneFileCanBeAttached,
			});
		}
	}
}

function onDragover(ev: DragEvent) {
	if (!ev.dataTransfer) return;

	const isFile = ev.dataTransfer.items[0]?.kind === 'file';
	if (isFile || checkDragDataType(ev, ['driveFiles'])) {
		ev.preventDefault();
		switch (ev.dataTransfer.effectAllowed) {
			case 'all':
			case 'uninitialized':
			case 'copy':
			case 'copyLink':
			case 'copyMove':
				ev.dataTransfer.dropEffect = 'copy';
				break;
			case 'linkMove':
			case 'move':
				ev.dataTransfer.dropEffect = 'move';
				break;
			default:
				ev.dataTransfer.dropEffect = 'none';
				break;
		}
	}
}

function onDrop(ev: DragEvent): void {
	if (!ev.dataTransfer) return;
	if (props.user) {
		const files = Array.from(ev.dataTransfer.files);
		if (files.length) { ev.preventDefault(); attachmentComposer.value?.addFiles(files); } else if (checkDragDataType(ev, ['driveFiles'])) { ev.preventDefault(); attachmentComposer.value?.addDriveFiles(getDragData(ev, 'driveFiles') ?? []); }
		return;
	}

	// ファイルだったら
	if (ev.dataTransfer.files.length === 1) {
		ev.preventDefault();
		os.launchUploader([Array.from(ev.dataTransfer.files)[0]], { multiple: false }).then(files => { file.value = files[0]; });
		return;
	} else if (ev.dataTransfer.files.length > 1) {
		ev.preventDefault();
		os.alert({
			type: 'error',
			text: i18n.ts.onlyOneFileCanBeAttached,
		});
		return;
	}

	//#region ドライブのファイル
	{
		const droppedData = getDragData(ev, 'driveFiles');
		if (droppedData != null) {
			file.value = droppedData[0];
			ev.preventDefault();
		}
	}
	//#endregion
}

function onKeydown(ev: KeyboardEvent) {
	if (ev.isComposing || ev.key === 'Process' || ev.keyCode === 229) return;
	if (ev.key === 'Enter') {
		if (prefer.s['chat.sendOnEnter']) {
			if (!(ev.ctrlKey || ev.metaKey || ev.shiftKey)) {
				ev.preventDefault();
				send();
			}
		} else {
			if ((ev.ctrlKey || ev.metaKey)) {
				ev.preventDefault();
				send();
			}
		}
	}
}

// On mobile, focusing the send button first blurs the textarea and triggers a
// visual viewport resize while the keyboard is open. That resize can cancel the
// subsequent click event, so submit on the touch/pen pointerdown instead.
function onSendPointerDown(ev: PointerEvent) {
	if (ev.pointerType !== 'mouse') {
		ev.preventDefault();
		send();
	}
}

function chooseFile(ev: PointerEvent) {
	selectFile({
		anchorElement: ev.currentTarget ?? ev.target,
		multiple: false,
		label: i18n.ts.selectFile,
	}).then(selectedFile => {
		file.value = selectedFile;
	});
}

function onChangeFile() {
	if (fileEl.value == null || fileEl.value.files == null) return;

	if (fileEl.value.files[0]) {
		os.launchUploader(Array.from(fileEl.value.files), { multiple: false }).then(driveFiles => {
			file.value = driveFiles[0];
		});
	}
}

async function send() {
	if (!canSend.value || sending.value) return;

	sending.value = true;

	if (props.user) {
		const snapshotText = text.value;
		const snapshotRevision = textRevision;
		const snapshotAttachments = attachments.value.slice();
		const box = privateOutbox!;
		const snapshot = retainedSnapshot && retainedRevision === snapshotRevision && !snapshotAttachments.length && box.queue.items.some(item => item.snapshot.clientMessageId === retainedSnapshot!.clientMessageId) ? retainedSnapshot : { clientMessageId: crypto.randomUUID(), toUserId: props.user.id, text: snapshotText || undefined, attachmentIds: snapshotAttachments.map(attachment => attachment.id), replyToId: reply.value?.id ?? null };
		let result: Promise<boolean>;
		try {
			result = box.queue.enqueue(snapshot);
		} catch {
			sendError.value = true;
			sending.value = false;
			return;
		}
		sendError.value = false;
		// Once enqueued, transport errors belong to the pending message. They do
		// not mean the queue rejected the draft and must never reopen the keyboard.
		const settled = result.catch(() => false);
		try {
			invalidateEditingFocus();
			if (isCompact()) textareaEl.value?.blur();
			attachments.value = attachments.value.filter(attachment => !snapshotAttachments.includes(attachment));
			if (box.persistent.value) {
				if (textRevision === snapshotRevision) { text.value = ''; reply.value = null; }
			} else { retainedSnapshot = snapshot; retainedRevision = snapshotRevision; await settled; }
			saveDraft();
		} finally { sending.value = false; }
	} else if (props.room) {
		misskeyApi('chat/messages/create-to-room', {
			toRoomId: props.room.id,
			text: text.value ? text.value : undefined,
			fileId: file.value ? file.value.id : undefined,
		}).then(message => {
			clear();
		}).catch(err => {
			console.error(err);
		}).then(() => {
			sending.value = false;
		});
	}
}

function clear() {
	text.value = '';
	file.value = null;
	deleteDraft();
}

function saveDraft() {
	try {
	const drafts = JSON.parse(miLocalStorage.getItem('chatProMessageDrafts') || '{}');

	drafts[getDraftKey()] = {
		updatedAt: new Date(),
		data: {
			text: text.value,
			file: file.value,
		},
	};

	miLocalStorage.setItem('chatProMessageDrafts', JSON.stringify(drafts));
	} catch { /* Keep the live draft when browser storage is unavailable. */ }
}

function deleteDraft() {
	try {
	const drafts = JSON.parse(miLocalStorage.getItem('chatProMessageDrafts') || '{}');

	delete drafts[getDraftKey()];

	miLocalStorage.setItem('chatProMessageDrafts', JSON.stringify(drafts));
	} catch { /* Keep storage denial from affecting the composer. */ }
}

function rememberEmojiFocus(ev: PointerEvent | FocusEvent): void {
	emojiWasFocused = window.document.activeElement === textareaEl.value || (ev instanceof FocusEvent && ev.relatedTarget === textareaEl.value);
}

async function insertEmoji(ev: MouseEvent) {
	const restoreFocus = !props.user || emojiWasFocused || window.document.activeElement === textareaEl.value;
	emojiWasFocused = false;
	const generation = ++focusGeneration;
	textareaReadOnly.value = true;
	const target = ev.currentTarget ?? ev.target;
	if (target == null) {
		textareaReadOnly.value = false;
		return;
	}

	// emojiPickerはダイアログが閉じずにtextareaとやりとりするので、
	// focustrapをかけているとinsertTextAtCursorが効かない
	// そのため、投稿フォームのテキストに直接注入する
	// See: https://github.com/misskey-dev/misskey/pull/14282
	//      https://github.com/misskey-dev/misskey/issues/14274

	let pos = textareaEl.value?.selectionStart ?? 0;
	let posEnd = textareaEl.value?.selectionEnd ?? text.value.length;
	emojiPicker.show(
		target as HTMLElement,
		emoji => {
			if (props.user && (!active || generation !== focusGeneration)) return;
			const textBefore = text.value.substring(0, pos);
			const textAfter = text.value.substring(posEnd);
			text.value = textBefore + emoji + textAfter;
			pos += emoji.length;
			posEnd += emoji.length;
		},
		() => {
			if (props.user && generation !== focusGeneration) return;
			textareaReadOnly.value = false;
			nextTick(() => {
				if (active && generation === focusGeneration && restoreFocus && !window.document.hidden && window.document.hasFocus() && textareaEl.value?.isConnected) textareaEl.value.focus({ preventScroll: true });
			});
		},
	);
}

onMounted(() => {
	privateOutbox?.listeners.add(accepted);
	if (textareaEl.value != null) {
		autocompleteInstance = new Autocomplete(textareaEl.value, text);
	}
	activate();

	// 書きかけの投稿を復元
	try {
	const draft = JSON.parse(miLocalStorage.getItem('chatProMessageDrafts') || '{}')[getDraftKey()];
	if (draft) {
		text.value = draft.data.text;
		file.value = draft.data.file;
	}
	} catch { /* A malformed or unavailable local draft is not a send failure. */ }
});

onActivated(activate);
onDeactivated(deactivate);
onBeforeUnmount(() => {
	privateOutbox?.listeners.delete(accepted);
	if (autocompleteInstance) {
		autocompleteInstance.detach();
		autocompleteInstance = null;
	}
	deactivate();
});
</script>

<style lang="scss" module>
.reply { display: flex; align-items: flex-start; padding: 8px 12px 0; }
.cancelReply { flex: 0 0 44px; width: 44px; height: 44px; }
.root {
	position: relative;
	border-bottom: none;
	border-radius: 14px 14px 0 0;
	background: var(--MI_THEME-panel);
}

.textarea {
	cursor: auto;
	display: block;
	width: 100%;
	min-width: 100%;
	max-width: 100%;
	min-height: 80px;
	margin: 0;
	padding: 16px 16px 0 16px;
	resize: none;
	font-size: max(16px, 1em);
	font-family: inherit;
	line-height: 1.4;
	outline: none;
	border: none;
	border-radius: 14px 14px 0 0;
	box-shadow: none;
	box-sizing: border-box;
	appearance: none;
	-webkit-appearance: none;
	background: var(--MI_THEME-panel);
	color: var(--MI_THEME-fg);
	-webkit-text-fill-color: var(--MI_THEME-fg);
	caret-color: var(--MI_THEME-accent);
	max-height: min(200px, calc(var(--MI-chatViewportHeight, 100dvh) * 0.3));
	overflow-y: auto;
}

.footer {
	background: var(--MI_THEME-panel);
}

.sendError {
	padding: 0 12px 8px;
	color: var(--MI_THEME-error);
	font-size: 90%;
}

.file {
	padding: 8px;
	cursor: pointer;
}

.buttons {
	display: flex;
}

.privateButtons {
	align-items: center;
	flex-wrap: nowrap;
	min-width: 0;
	padding: 0 12px;
	box-sizing: border-box;

	> .button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 44px;
		width: 44px;
		height: 44px;
		line-height: 1;
	}

	> .send {
		margin-left: 0;
		margin-inline-start: auto;
	}
}

.button {
	height: 50px;
	aspect-ratio: 1;

	&:hover {
		color: var(--MI_THEME-accent);
	}
}
.send {
	margin-left: auto;
	color: var(--MI_THEME-accent);
}
</style>
