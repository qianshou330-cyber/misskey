<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<section
	v-if="announcements.length"
	ref="root"
	class="_panel"
	:class="[$style.root, { [$style.static]: staticList, [$style.paused]: hovered || focused || editing || !active }]"
	:aria-label="i18n.ts._homeAnnouncements.label"
	data-testid="home-announcements"
	:data-paused="hovered || focused || editing || !active"
	:data-static="staticList"
	@pointerenter="hovered = $event.pointerType === 'mouse'"
	@pointerleave="hovered = false"
	@focusin="onFocus"
	@focusout="onBlur"
>
	<div :class="$style.label"><i class="ti ti-speakerphone" aria-hidden="true"></i><span>{{ i18n.ts._homeAnnouncements.label }}</span></div>
	<div ref="viewport" :class="$style.viewport" data-testid="marquee-viewport">
		<div :class="$style.track" :style="{ '--announcement-distance': `${distance}px`, '--announcement-duration': `${Math.max(8, distance / 32)}s` }" data-testid="marquee-track">
			<ul ref="firstGroup" :class="$style.group">
				<li v-for="announcement in announcements" :key="announcement.id" :class="$style.item">
					<MkA :to="`/announcements/${announcement.id}`" :class="$style.link" :data-announcement-id="announcement.id">{{ announcement.title }}</MkA>
				</li>
			</ul>
			<ul v-for="copy in copies - 1" :key="copy" :class="[$style.group, $style.copy]" aria-hidden="true">
				<li v-for="announcement in announcements" :key="announcement.id" :class="$style.item">
					<MkA :to="`/announcements/${announcement.id}`" :class="$style.link" tabindex="-1" @mousedown.prevent>{{ announcement.title }}</MkA>
				</li>
			</ul>
		</div>
	</div>
	<button
		v-if="canEdit"
		ref="editButton"
		class="_button"
		:class="$style.toggle"
		type="button"
		:aria-label="i18n.ts._homeAnnouncements.edit"
		:title="i18n.ts._homeAnnouncements.edit"
		data-testid="marquee-edit"
		@click="openEditor"
	>
		<i class="ti ti-pencil" aria-hidden="true"></i> {{ i18n.ts._homeAnnouncements.edit }}
	</button>
</section>
<Teleport to="body">
	<MkHomeAnnouncementEditor v-if="editing && canEdit" :initialId="initialEditId" @saved="refresh" @closed="closeEditor"/>
</Teleport>
</template>

<script lang="ts" setup>
import { computed, defineAsyncComponent, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue';
import { useHomeAnnouncements } from '@/composables/use-home-announcements.js';
import { i18n } from '@/i18n.js';
import { prefer } from '@/preferences.js';
import { $i } from '@/i.js';

const MkHomeAnnouncementEditor = defineAsyncComponent(() => import('@/components/MkHomeAnnouncementEditor.vue'));
const { announcements, refresh } = useHomeAnnouncements();
const root = useTemplateRef('root');
const editButton = useTemplateRef('editButton');
const viewport = useTemplateRef('viewport');
const firstGroup = useTemplateRef('firstGroup');
const canEdit = computed(() => $i?.isAdmin === true);
const editing = ref(false);
const initialEditId = ref<string | null>(null);
const hovered = ref(false);
const focused = ref(false);
const focusedLink = ref(false);
const active = ref(false);
const systemReducedMotion = ref(false);
const reducedMotion = computed(() => systemReducedMotion.value || !prefer.r.animation.value);
const staticList = computed(() => reducedMotion.value || focusedLink.value);
const distance = ref(200);
const copies = ref(2);
let media: MediaQueryList | null = null;
let observer: ResizeObserver | null = null;

function openEditor(): void {
	if (!canEdit.value || editing.value) return;
	initialEditId.value = announcements.value.length === 1 ? announcements.value[0].id : null;
	editing.value = true;
}

function closeEditor(): void {
	editing.value = false;
	void nextTick(() => editButton.value?.focus({ preventScroll: true }));
}

function measure(): void {
	const width = firstGroup.value?.getBoundingClientRect().width ?? 0;
	if (width <= 0) return;
	distance.value = width;
	copies.value = Math.max(2, Math.ceil((viewport.value?.clientWidth ?? 0) / width) + 1);
}

function observe(): void {
	observer?.disconnect();
	if (!active.value) return;
	if (viewport.value) observer?.observe(viewport.value);
	if (firstGroup.value) observer?.observe(firstGroup.value);
	measure();
}

function motionChanged(): void { systemReducedMotion.value = media?.matches ?? false; }

function activate(): void {
	if (active.value) return;
	active.value = true;
	media = window.matchMedia('(prefers-reduced-motion: reduce)');
	motionChanged();
	media.addEventListener('change', motionChanged);
	observer = new ResizeObserver(measure);
	observe();
}

function deactivate(): void {
	active.value = false;
	editing.value = false;
	hovered.value = false;
	focused.value = false;
	focusedLink.value = false;
	observer?.disconnect();
	observer = null;
	media?.removeEventListener('change', motionChanged);
	media = null;
}

async function onFocus(event: FocusEvent): Promise<void> {
	const target = event.target;
	// Touch/mouse focus on the control must not keep a resumed marquee paused.
	focused.value = target instanceof HTMLElement && target.matches(':focus-visible');
	focusedLink.value = focused.value && target instanceof Node && !!firstGroup.value?.contains(target);
	await nextTick();
	// Stop the transform before exposing the focused original; later titles remain keyboard-reachable.
	if (focusedLink.value && target instanceof HTMLElement) target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
}

function releaseFocusPause(): void {
	focused.value = false;
	focusedLink.value = false;
	if (viewport.value) viewport.value.scrollLeft = 0;
}

function onBlur(event: FocusEvent): void {
	if (event.relatedTarget instanceof Node && root.value?.contains(event.relatedTarget)) return;
	releaseFocusPause();
}

watch([viewport, firstGroup], observe, { flush: 'post' });
watch(announcements, () => {
	void nextTick(() => {
		measure();
		// A background edit may remove the currently focused announcement.
		if (!root.value?.contains(window.document.activeElement)) releaseFocusPause();
	});
});
watch(staticList, value => { if (!value && viewport.value) viewport.value.scrollLeft = 0; });
watch(() => [$i?.id, canEdit.value], () => { editing.value = false; }, { flush: 'sync' });
onMounted(activate);
onActivated(activate);
onDeactivated(deactivate);
onUnmounted(deactivate);
</script>

<style lang="scss" module>
@keyframes scroll {
	from { transform: translateX(0); }
	to { transform: translateX(calc(-1 * var(--announcement-distance))); }
}

.root {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 1px 8px 1px 12px;
	min-width: 0;
	color: var(--MI_THEME-fg);
}

.label {
	display: flex;
	align-items: center;
	gap: 6px;
	flex-shrink: 0;
	font-size: 90%;
	font-weight: bold;
	white-space: nowrap;
	color: var(--MI_THEME-accent);
}

.viewport {
	flex: 1;
	min-width: 0;
	overflow: hidden;
}

.track {
	display: flex;
	width: max-content;
	animation: scroll var(--announcement-duration) linear infinite;
}

.group {
	display: flex;
	align-items: center;
	flex-shrink: 0;
	gap: 40px;
	margin: 0;
	padding: 0 40px 0 0;
	list-style: none;
}

.item { flex-shrink: 0; }

.link {
	display: block;
	padding: 2px 2px;
	white-space: nowrap;
	line-height: 1.4;
	text-decoration: none;

	&:hover { text-decoration: underline; }
	&:focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: -2px; }
}

.toggle {
	flex-shrink: 0;
	min-width: 44px;
	padding: 0 8px;
	height: 24px;
	white-space: nowrap;
	border-radius: var(--MI-radius);
	color: var(--MI_THEME-fg);
	&:hover { background: var(--MI_THEME-buttonHoverBg); }
	&:focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: -2px; }
}

.paused .track { animation-play-state: paused; }

.static {
	.viewport { overflow-x: auto; }
	.track { animation: none; transform: none; }
	.copy { display: none; }
}

@media (max-width: 400px) {
	.root { gap: 4px; padding-left: 8px; }
	.label { gap: 4px; font-size: 85%; }
}
</style>
