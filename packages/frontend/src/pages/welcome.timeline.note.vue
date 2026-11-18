<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :key="note.id" :class="[$style.note, { [$style.preview]: preview }]" :aria-hidden="duplicate ? true : undefined" :data-note-id="note.id">
	<div v-if="preview" class="_panel" :class="$style.content" data-testid="welcome-note-preview">
		<div class="_gaps_s" :class="$style.previewBody" inert aria-hidden="true">
			<div v-if="note.cw != null" :class="[$style.text, $style.previewCw]">
				<Mfm :text="note.cw" :author="note.user" :enableEmojiMenu="false"/>
				<div :class="$style.hiddenContent"><i class="ti ti-eye-off" aria-hidden="true"></i> {{ i18n.ts._cw.show }}</div>
			</div>
			<div v-else ref="noteTextEl" :class="[$style.text, { [$style.collapsed]: shouldCollapse }]">
				<i v-if="note.replyId" class="ti ti-arrow-back-up" aria-hidden="true"></i>
				<Mfm v-if="note.text" :text="note.text" :author="note.user" :enableEmojiMenu="false"/>
				<span v-if="note.renoteId">{{ i18n.ts.renote }}</span>
			</div>
			<div v-if="note.cw == null && previewFiles.length > 0" :class="$style.previewMedia">
				<div v-for="file in previewFiles" :key="file.id" :class="$style.previewAttachment">
					<img v-if="file.src" :src="file.src" alt="" loading="lazy" decoding="async" :class="$style.previewImage"/>
					<span v-else :class="$style.mediaPlaceholder"><i :class="file.hidden ? 'ti ti-eye-off' : 'ti ti-file'" aria-hidden="true"></i> {{ file.label }}</span>
					<i v-if="file.video && file.src" class="ti ti-player-play-filled" :class="$style.videoIndicator" aria-hidden="true"></i>
				</div>
			</div>
			<div v-if="note.reactionCount > 0" :class="$style.reactions">
				<MkReactionsViewer :noteId="note.id" :reactions="note.reactions" :reactionEmojis="note.reactionEmojis" :myReaction="note.myReaction" :maxNumber="16"/>
			</div>
		</div>
		<MkA
			:to="`/notes/${note.id}`"
			:class="$style.previewLink"
			:aria-label="previewLabel"
			:tabindex="duplicate ? -1 : undefined"
			data-testid="welcome-note-link"
			@mousedown="preventDuplicateFocus"
		/>
	</div>
	<div v-else class="_panel _gaps_s" :class="$style.content" :inert="duplicate || undefined">
		<div v-if="note.cw != null" :class="$style.richcontent">
			<div><Mfm :text="note.cw" :author="note.user"/></div>
			<MkCwButton v-model="showContent" :text="note.text" :renote="note.renote" :files="note.files" :poll="note.poll" style="margin: 4px 0;"/>
			<div v-if="showContent">
				<MkA v-if="note.replyId" class="reply" :to="`/notes/${note.replyId}`"><i class="ti ti-arrow-back-up"></i></MkA>
				<Mfm v-if="note.text" :text="note.text" :author="note.user"/>
				<MkA v-if="note.renoteId" class="rp" :to="`/notes/${note.renoteId}`">RN: ...</MkA>
			</div>
		</div>
		<div v-else ref="noteTextEl" :class="[$style.text, { [$style.collapsed]: shouldCollapse }]">
			<MkA v-if="note.replyId" class="reply" :to="`/notes/${note.replyId}`"><i class="ti ti-arrow-back-up"></i></MkA>
			<Mfm v-if="note.text" :text="note.text" :author="note.user"/>
			<MkA v-if="note.renoteId" class="rp" :to="`/notes/${note.renoteId}`">RN: ...</MkA>
		</div>
		<div v-if="note.files && note.files.length > 0 && (note.cw == null || showContent)" :class="$style.richcontent">
			<MkMediaList :mediaList="note.files.slice(0, 4)"/>
		</div>
		<div v-if="note.reactionCount > 0" :class="$style.reactions">
			<MkReactionsViewer :noteId="note.id" :reactions="note.reactions" :reactionEmojis="note.reactionEmojis" :myReaction="note.myReaction" :maxNumber="16"/>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, ref, useTemplateRef, onUpdated, onMounted } from 'vue';
import * as Misskey from 'misskey-js';
import MkReactionsViewer from '@/components/MkReactionsViewer.vue';
import MkMediaList from '@/components/MkMediaList.vue';
import MkCwButton from '@/components/MkCwButton.vue';
import { i18n } from '@/i18n.js';
import { shouldHideFileByDefault } from '@/utility/sensitive-file.js';
import { getStaticImageUrl } from '@/utility/media-proxy.js';

const props = withDefaults(defineProps<{
	note: Misskey.entities.Note;
	preview?: boolean;
	duplicate?: boolean;
}>(), {
	preview: false,
	duplicate: false,
});

const previewLabel = computed(() => `${i18n.ts.note} · ${props.note.user.name || props.note.user.username}: ${props.note.cw ?? props.note.text ?? i18n.ts.showMore}`);
const previewFiles = computed(() => (props.note.files ?? []).slice(0, 4).map(file => {
	const hidden = file.isSensitive || shouldHideFileByDefault(file);
	const video = file.type.startsWith('video/');
	const image = file.type.startsWith('image/');
	return {
		id: file.id,
		hidden,
		video,
		src: !hidden && (image || video) && file.thumbnailUrl ? getStaticImageUrl(file.thumbnailUrl) : null,
		label: hidden ? i18n.ts.sensitive : video ? i18n.ts.video : image ? i18n.ts.image : file.type.startsWith('audio/') ? i18n.ts.audio : i18n.ts.file,
	};
}));

function preventDuplicateFocus(event: MouseEvent) {
	if (props.duplicate) event.preventDefault();
}

const noteTextEl = useTemplateRef('noteTextEl');
const shouldCollapse = ref(false);
const showContent = ref(false);

function calcCollapse() {
	if (noteTextEl.value) {
		const height = noteTextEl.value.scrollHeight;
		shouldCollapse.value = height > 200;
	}
}

onMounted(() => {
	calcCollapse();
});

onUpdated(() => {
	calcCollapse();
});
</script>

<style lang="scss" module>
.note {
	margin-left: auto;
}

.text {
	position: relative;
	max-height: 200px;
	overflow: hidden;

	&.collapsed::after {
		content: '';
		position: absolute;
		bottom: 0;
		left: 0;
		width: 100%;
		height: 64px;
		background: linear-gradient(0deg, var(--MI_THEME-panel), color(from var(--MI_THEME-panel) srgb r g b / 0));
	}
}

.content {
	padding: 16px;
	margin: 0 0 0 auto;
	max-width: max-content;
	border-radius: 16px;
}

.reactions {
	box-sizing: border-box;
	margin: 8px -16px -8px;
	padding: 8px 16px 0;
	width: calc(100% + 32px);
	border-top: 1px solid var(--MI_THEME-divider);
}

.richcontent {
	min-width: 250px;
}

.preview {
	max-width: 100%;

	.content {
		position: relative;
		box-sizing: border-box;
		max-width: 100%;
	}

	.text {
		overflow-wrap: anywhere;
	}
}

.previewBody {
	pointer-events: none;
}

.previewLink {
	position: absolute;
	inset: 0;
	z-index: 1;
	border-radius: inherit;

	&:focus-visible {
		outline: 2px solid var(--MI_THEME-focus);
		outline-offset: -2px;
	}
}

.previewCw, .hiddenContent {
	white-space: normal;
}

.hiddenContent {
	margin-top: 8px;
	opacity: 0.7;
}

.previewMedia {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 8px;
	width: 100%;
	min-width: 240px;

	> :only-child {
		grid-column: 1 / -1;
	}
}

.previewAttachment {
	position: relative;
	overflow: hidden;
	min-width: 0;
	aspect-ratio: 16 / 9;
	border-radius: 8px;
	background: var(--MI_THEME-bg);
}

.previewImage {
	display: block;
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.mediaPlaceholder {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 4px;
	height: 100%;
	font-size: 0.9em;
	color: var(--MI_THEME-fg);
}

.videoIndicator {
	position: absolute;
	inset: auto 8px 8px auto;
	padding: 4px;
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-panel);
	color: var(--MI_THEME-fg);
}
</style>
