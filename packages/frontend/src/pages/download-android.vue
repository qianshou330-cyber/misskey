<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader>
	<div class="_spacer" style="--MI_SPACER-w: 760px; --MI_SPACER-min: 16px;">
		<div :class="$style.root" class="_gaps_m">
			<section :class="$style.hero" class="_panel">
				<img src="/static-assets/icons/192.png?brand=pubo" alt="PUBO" width="88" height="88" :class="$style.icon"/>
				<h1>{{ i18n.ts._androidApp.title }}</h1>
				<p>{{ i18n.ts._androidApp.description }}</p>
				<a v-if="androidRelease.ready" :href="androidRelease.apkUrl" download class="_buttonPrimary" :class="$style.download"><i class="ti ti-brand-android" aria-hidden="true"></i> {{ i18n.ts._androidApp.download }}</a>
				<p v-else>{{ i18n.ts._androidApp.preparing }}</p>
			</section>
		</div>
	</div>
</PageWithHeader>
</template>

<script setup lang="ts">
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { androidRelease } from '@/utility/android-release.js';

definePage(() => ({ title: i18n.ts._androidApp.title, icon: 'ti ti-brand-android' }));
</script>

<style lang="scss" module>
.root { line-height: 1.7; }
.hero { padding: 32px var(--MI-margin); text-align: center; }
.hero h1 { margin: 12px 0 8px; font-size: 1.5em; }
.icon { border-radius: var(--MI-radius); }
.download { display: inline-flex; align-items: center; gap: 8px; padding: 12px 24px; border-radius: var(--MI-radius); font-weight: bold; }
</style>
