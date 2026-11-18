<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader v-model:tab="tab" :actions="headerActions" :tabs="headerTabs" :swipable="true">
	<div v-if="tab === 'featured'">
		<XFeatured/>
	</div>
	<div v-else-if="tab === 'users'">
		<XUsers/>
	</div>
	<div v-else-if="tab === 'roles'">
		<XRoles/>
	</div>
	<div v-else-if="tab === 'topics'" class="_spacer" style="--MI_SPACER-w: 800px;">
		<div :class="$style.topicGrid">
			<MkA v-for="topic in topics" :key="topic.id" :to="`/topics/${topic.id}`" class="_panel" :class="$style.topic">
				<i :class="[topic.icon, $style.topicIcon]"></i>
				<div :class="$style.topicBody">
					<strong>{{ topic.name }}</strong>
					<span>{{ topic.description }}</span>
				</div>
			</MkA>
		</div>
		<MkButton type="routerLink" to="/topics" rounded primary :class="$style.topicMore">查看全部主题</MkButton>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, watch, ref, useTemplateRef } from 'vue';
import XFeatured from './explore.featured.vue';
import XUsers from './explore.users.vue';
import XRoles from './explore.roles.vue';
import MkButton from '@/components/MkButton.vue';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import { topics } from '@/topics.js';

const props = withDefaults(defineProps<{
	initialTab?: string;
}>(), {
	initialTab: 'featured',
});

const tab = ref(props.initialTab);

const headerActions = computed(() => []);

const headerTabs = computed(() => [{
	key: 'featured',
	icon: 'ti ti-bolt',
	title: i18n.ts.featured,
}, {
	key: 'users',
	icon: 'ti ti-users',
	title: i18n.ts.users,
}, {
	key: 'roles',
	icon: 'ti ti-badges',
	title: i18n.ts.roles,
}, {
	key: 'topics',
	icon: 'ti ti-hash',
	title: '主题',
}]);

definePage(() => ({
	title: i18n.ts.explore,
	icon: 'ti ti-hash',
}));
</script>

<style lang="scss" module>
.topicGrid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
	gap: var(--MI-margin);
}

.topic {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 16px;
	color: inherit;
	text-decoration: none;
}

.topicIcon {
	font-size: 1.4em;
	color: var(--MI_THEME-accent);
}

.topicBody {
	display: flex;
	flex-direction: column;
	gap: 4px;

	span {
		font-size: 0.9em;
		color: var(--MI_THEME-fgTransparent);
	}
}

.topicMore {
	display: block;
	margin: var(--MI-margin) auto 0;
}
</style>
