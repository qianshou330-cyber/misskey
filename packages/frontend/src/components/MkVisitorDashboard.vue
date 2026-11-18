<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div v-if="instance" :class="$style.root">
	<div :class="[$style.main, $style.panel]">
		<img src="/static-assets/pubo-white-660-v1.webp" alt="PUBO" width="660" height="221" :class="$style.mainIcon"/>
		<button class="_button _acrylic" :class="$style.mainMenu" @click="showMenu"><i class="ti ti-dots"></i></button>
		<div :class="$style.mainFg">
			<h1 :class="$style.mainTitle">
				<!-- 背景色によってはロゴが見えなくなるのでとりあえず無効に -->
				<!-- <img class="logo" v-if="instance.logoImageUrl" :src="instance.logoImageUrl"><span v-else class="text">{{ instanceName }}</span> -->
				<MkA to="/">{{ instanceName }}</MkA>
			</h1>
			<div :class="$style.mainAbout">
				<!-- eslint-disable-next-line vue/no-v-html -->
				<div v-html="instance.description || i18n.ts.headlineMisskey"></div>
			</div>
			<div v-if="instance.disableRegistration || instance.federation !== 'all'" :class="$style.mainWarn" class="_gaps_s">
				<MkInfo v-if="instance.disableRegistration" warn>{{ i18n.ts.invitationRequiredToRegister }}</MkInfo>
				<MkInfo v-if="instance.federation === 'specified'" warn>{{ i18n.ts.federationSpecified }}</MkInfo>
				<MkInfo v-else-if="instance.federation === 'none'" warn>{{ i18n.ts.federationDisabled }}</MkInfo>
			</div>
			<div class="_gaps_s" :class="$style.mainActions">
				<MkButton :class="[$style.mainAction, $style.signupAction]" full rounded primary data-testid="signup" @click="signup()">注册</MkButton>
				<MkButton :class="$style.mainAction" full rounded data-testid="signin" @click="signin()">{{ i18n.ts.login }}</MkButton>
				<MkA to="/download/android" :class="$style.mainAction"><i class="ti ti-brand-android" aria-hidden="true"></i> {{ i18n.ts._androidApp.download }}</MkA>
			</div>
		</div>
	</div>
	<MkHomeAnnouncements v-if="showMusicCharts"/>
	<MkDeferredSection v-if="showMusicCharts" :loader="loadMusicCharts" :deferred="staged" :minHeight="240">
		<template #default="{ component }"><component :is="component"/></template>
	</MkDeferredSection>
	<div v-if="showTimeline && (instance.policies.gtlAvailable || instance.policies.ltlAvailable) && instance.clientOptions.showTimelineForVisitor !== false" :class="[$style.tl, $style.panel]">
		<div :class="$style.tlHeader">{{ i18n.ts.letsLookAtTimeline }}</div>
		<div :class="$style.tlBody">
			<MkDeferredSection :loader="loadTimeline" :deferred="staged" :minHeight="350">
				<template #default="{ component }"><component :is="component" :src="visitorTimeline" :forceRealtime="true"/></template>
			</MkDeferredSection>
		</div>
	</div>
	<div v-if="instance.clientOptions.showActivitiesForVisitor !== false" :class="$style.panel">
		<MkDeferredSection :loader="loadActivities" :deferred="staged" :nearViewport="staged" :minHeight="150">
			<template #default="{ component }"><component :is="component"/></template>
		</MkDeferredSection>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { instanceName } from '@@/js/config.js';
import XSigninDialog from '@/components/MkSigninDialog.vue';
import XSignupDialog from '@/components/MkSignupDialog.vue';
import MkButton from '@/components/MkButton.vue';
import MkDeferredSection from '@/components/MkDeferredSection.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkHomeAnnouncements from '@/components/MkHomeAnnouncements.vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { instance } from '@/instance.js';
import { openInstanceMenu } from '@/ui/_common_/common.js';

withDefaults(defineProps<{ showMusicCharts?: boolean; showTimeline?: boolean; staged?: boolean }>(), { showMusicCharts: false, showTimeline: true, staged: false });
const loadMusicCharts = () => import('@/components/MkWelcomeMusicCharts.vue');
const loadTimeline = () => import('@/components/MkStreamingNotesTimeline.vue');
const loadActivities = () => import('@/components/MkVisitorDashboard.ActiveUsersChart.vue');

const visitorTimeline = computed<'local' | 'global'>(() => instance.policies.gtlAvailable ? 'global' : 'local');

function signin() {
	const { dispose } = os.popup(XSigninDialog, {
		autoSet: true,
	}, {
		closed: () => dispose(),
	});
}

function signup() {
	const { dispose } = os.popup(XSignupDialog, {
		autoSet: true,
	}, {
		closed: () => dispose(),
	});
}

function showMenu(ev: PointerEvent) {
	openInstanceMenu(ev);
}
</script>

<style lang="scss" module>
.root {
	position: relative;
	display: flex;
	flex-direction: column;
	gap: 16px;
	padding: 32px 0 0 0;
}

.panel {
	position: relative;
	background: var(--MI_THEME-panel);
	border-radius: var(--MI-radius);
	box-shadow: 0 12px 32px rgb(0 0 0 / 25%);
}

.main {
	text-align: center;
}

.mainIcon {
	width: min(220px, 70%);
	height: auto;
	margin-top: -42px;
	vertical-align: bottom;
	filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.5));
	object-fit: contain;
}

.mainMenu {
	position: absolute;
	top: 16px;
	right: 16px;
	width: 32px;
	height: 32px;
	border-radius: 8px;
	font-size: 18px;
	z-index: 50;
}

.mainFg {
	position: relative;
	z-index: 1;
}

.mainTitle {
	display: block;
	margin: 0;
	padding: 16px 32px 24px 32px;
	font-size: 1.4em;
}

.mainLogo {
	vertical-align: bottom;
	max-height: 120px;
	max-width: min(100%, 300px);
}

.mainAbout {
	padding: 0 32px;
}

.mainWarn {
	padding: 32px 32px 0 32px;
}

.mainActions {
	padding: 32px;
}

.mainAction {
	line-height: 28px;
}

.signupAction {
	--MI_THEME-accent: #2dc100;
	--MI_THEME-fgOnAccent: #fff;
}

.tl {
	overflow: clip;
}

.tlHeader {
	padding: 12px 16px;
	border-bottom: solid 1px var(--MI_THEME-divider);
}

.tlBody {
	height: 350px;
	overflow: auto;
}
</style>
