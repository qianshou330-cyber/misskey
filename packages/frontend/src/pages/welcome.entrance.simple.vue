<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div v-if="meta" :class="$style.root">
	<MkFeaturedPhotos :class="$style.bg"/>
	<div :class="[$style.layout, { [$style.columns]: showRightTimeline }]" data-testid="welcome-layout" :data-columns="showRightTimeline">
		<div :class="$style.contents">
			<MkVisitorDashboard :showMusicCharts="true" :showTimeline="pageActive && !showRightTimeline" staged/>
		</div>
		<aside v-if="showRightTimeline" :class="$style.timeline" data-testid="welcome-right-timeline" :aria-label="i18n.ts.letsLookAtTimeline">
			<MkDeferredSection :loader="loadTimeline" deferred :class="$style.timelineContent">
				<template #default="{ component }"><component :is="component" preview @unavailable="timelineUnavailable = true"/></template>
			</MkDeferredSection>
		</aside>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue';
import MkFeaturedPhotos from '@/components/MkFeaturedPhotos.vue';
import MkVisitorDashboard from '@/components/MkVisitorDashboard.vue';
import MkDeferredSection from '@/components/MkDeferredSection.vue';
import { instance as meta } from '@/instance.js';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';

const desktopQuery = window.matchMedia('(min-width: 1201px)');
const loadTimeline = () => import('@/pages/welcome.timeline.vue');
const desktop = ref(desktopQuery.matches);
const pageActive = ref(true);
let listening = false;
// An empty or unavailable feed falls back for this visit, including later resizes.
const timelineUnavailable = ref(false);
const showRightTimeline = computed(() => pageActive.value && !$i && desktop.value && !timelineUnavailable.value &&
	meta.clientOptions.showTimelineForVisitor !== false &&
	(meta.policies.gtlAvailable || meta.policies.ltlAvailable));

function updateDesktop() {
	desktop.value = desktopQuery.matches;
}

function activate() {
	updateDesktop();
	pageActive.value = true;
	if (!listening) desktopQuery.addEventListener('change', updateDesktop);
	listening = true;
}

function deactivate() {
	pageActive.value = false;
	desktopQuery.removeEventListener('change', updateDesktop);
	listening = false;
}

onMounted(activate);
onActivated(activate);
onDeactivated(deactivate);
onBeforeUnmount(deactivate);
</script>

<style lang="scss" module>
.root {
	height: 100cqh;
	overflow: auto;
	overscroll-behavior: contain;
}

.bg {
	position: fixed;
	top: 0;
	right: 0;
	width: 100vw;
	height: 100vh;
	// 固定レイヤがホイール操作を奪い、コンテンツ列以外の上でページをスクロールできなくなるのを防ぐ (issue #17680)
	pointer-events: none;
}

.contents {
	position: relative;
	width: min(430px, calc(100% - 32px));
	margin: auto;
	padding: 100px 0 100px 0;
}

.layout {
	position: relative;
}

.columns {
	display: grid;
	grid-template-columns: 430px 500px;
	align-items: start;
	gap: 64px;
	width: 994px;
	margin: auto;

	> .contents {
		width: 430px;
		margin: 0;
	}
}

.timeline {
	position: sticky;
	top: 0;
	height: 100dvh;
	min-height: 0;
	box-sizing: border-box;
	padding: 32px 0;
	overflow: hidden;
}

.timelineContent {
	height: 100%;
}
</style>
