<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="[]" :tabs="[]">
	<div class="_spacer" style="--MI_SPACER-w: 800px;">
		<div class="_gaps">
			<div :class="$style.intro">
				<h2>{{ title }}</h2>
				<p>{{ description }}</p>
			</div>
			<div :class="$style.grid">
				<MkA v-for="topic in topics" :key="topic.id" :to="`/topics/${topic.id}`" class="_panel" :class="$style.topic">
					<i :class="[topic.icon, $style.icon]"></i>
					<div :class="$style.topicBody">
						<strong>{{ topic.name }}</strong>
						<span>{{ topic.description }}</span>
					</div>
					<i class="ti ti-chevron-right" :class="$style.chevron"></i>
				</MkA>
			</div>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { definePage } from '@/page.js';
import { topics } from '@/topics.js';

const title = '主题';
const description = '按主题浏览 PUBO 已接收的远端公开帖子。';

definePage(() => ({
	title,
	icon: 'ti ti-hash',
}));
</script>

<style lang="scss" module>
.intro {
	text-align: center;

	h2 {
		margin: 0;
	}

	p {
		margin: 8px 0 0;
		color: var(--MI_THEME-fgTransparent);
	}
}

.grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
	gap: var(--MI-margin);
}

.topic {
	display: flex;
	align-items: center;
	gap: 14px;
	padding: 18px;
	color: inherit;
	text-decoration: none;
	transition: transform 0.15s ease;

	&:hover {
		transform: translateY(-2px);
	}
}

.icon {
	font-size: 1.5em;
	color: var(--MI_THEME-accent);
}

.topicBody {
	display: flex;
	flex: 1;
	flex-direction: column;
	gap: 5px;

	span {
		font-size: 0.9em;
		color: var(--MI_THEME-fgTransparent);
	}
}

.chevron {
	color: var(--MI_THEME-fgTransparent);
}
</style>
