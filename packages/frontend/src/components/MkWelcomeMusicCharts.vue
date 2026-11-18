<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkMusicChartCard :chartKey="chartKey" :summary="summary" :loading="loading" :failed="failed" @update:chartKey="selectPlatform"/>
<MkError v-if="failed" @retry="refresh"/>
</template>

<script lang="ts" setup>
import MkMusicChartCard from '@/components/MkMusicChartCard.vue';
import MkError from '@/components/global/MkError.vue';
import { useKpopSummary } from '@/composables/use-kpop-charts.js';

const { summary, loading, failed, chartKey, selectPlatform, refresh } = useKpopSummary();
</script>
