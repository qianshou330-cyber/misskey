<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div v-if="instance">
	<XSetup v-if="instance.requireSetup"/>
	<XEntranceClassic v-else-if="(instance.clientOptions.entrancePageStyle ?? 'classic') === 'classic'"/>
	<XEntranceSimple v-else/>
</div>
<MkError v-else-if="failed" @retry="refreshInstance"/>
<MkLoading v-else/>
</template>

<script lang="ts" setup>
import { computed, defineAsyncComponent, ref } from 'vue';
import { instanceName } from '@@/js/config.js';
import XEntranceSimple from './welcome.entrance.simple.vue';
import { definePage } from '@/page.js';
import { refreshEntranceInstance, instance as sharedInstance, isValidInstanceMeta } from '@/instance.js';
import MkError from '@/components/global/MkError.vue';

const XSetup = defineAsyncComponent(() => import('./welcome.setup.vue'));
const XEntranceClassic = defineAsyncComponent(() => import('./welcome.entrance.classic.vue'));
const instance = computed(() => isValidInstanceMeta(sharedInstance) ? sharedInstance : null);
const failed = ref(false);
const refreshing = ref(false);

async function refreshInstance() {
	if (refreshing.value) return;
	refreshing.value = true;
	failed.value = false;
	try {
		await refreshEntranceInstance();
	} catch {
		failed.value = true;
	} finally {
		refreshing.value = false;
	}
}

void refreshInstance();

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: instanceName,
	icon: null,
}));
</script>
