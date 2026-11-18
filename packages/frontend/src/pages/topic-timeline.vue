<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :tabs="[]">
	<div class="_spacer" style="--MI_SPACER-w: 800px;">
		<MkResult v-if="topic == null" type="notFound" text="未找到该主题"/>
		<template v-else>
			<div :class="$style.heading">
				<i :class="[topic.icon, $style.icon]"></i>
				<div>
					<h2>{{ topic.name }}</h2>
					<p>{{ topic.description }}</p>
				</div>
			</div>
			<MkStreamingNotesTimeline
				ref="tlComponent"
				:key="topic.id"
				:class="$style.tl"
				src="topic"
				:topic="topic.id"
				:withRenotes="true"
				:withSensitive="true"
				sound
			/>
		</template>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, useTemplateRef } from 'vue';
import type { PageHeaderItem } from '@/types/page-header.js';
import MkStreamingNotesTimeline from '@/components/MkStreamingNotesTimeline.vue';
import { definePage } from '@/page.js';
import { getTopic } from '@/topics.js';

const props = defineProps<{
	topicId: string;
}>();

const topic = computed(() => getTopic(props.topicId));
const tlComponent = useTemplateRef('tlComponent');

const headerActions = computed<PageHeaderItem[]>(() => [{
	icon: 'ti ti-refresh',
	text: '刷新',
	handler: () => {
		tlComponent.value?.reloadTimeline();
	},
}]);

definePage(() => ({
	title: topic.value?.name ?? '主题',
	icon: topic.value?.icon ?? 'ti ti-hash',
}));
</script>

<style lang="scss" module>
.heading {
	display: flex;
	align-items: center;
	gap: 12px;
	margin-bottom: var(--MI-margin);
	padding: 0 4px;

	h2 {
		margin: 0;
	}

	p {
		margin: 4px 0 0;
		color: var(--MI_THEME-fgTransparent);
	}
}

.icon {
	font-size: 1.6em;
	color: var(--MI_THEME-accent);
}

.tl {
	background: var(--MI_THEME-bg);
	border-radius: var(--MI-radius);
	overflow: clip;
}
</style>
