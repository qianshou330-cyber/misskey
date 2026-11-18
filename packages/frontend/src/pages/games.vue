<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader>
	<div class="_spacer" style="--MI_SPACER-w: 800px;">
		<div class="_gaps">
			<div v-if="snakeEnabled" class="_panel" :class="$style.link">
				<MkA to="/games/snake" :class="$style.snake" data-testid="snake-game-link"><i class="ti ti-device-gamepad" aria-hidden="true"></i><strong>{{ i18n.ts._snakeGame.title }}</strong><span>{{ i18n.ts._snakeGame.description }}</span></MkA>
			</div>
			<div class="_panel" :class="$style.link">
				<MkA to="/bubble-game">
					<img src="/client-assets/drop-and-fusion/logo.png" style="display: block; max-width: 100%; max-height: 200px; margin: auto;"/>
				</MkA>
			</div>
			<div class="_panel" :class="$style.link">
				<MkA to="/reversi">
					<img src="/client-assets/reversi/logo.png" style="display: block; max-width: 100%; max-height: 200px; margin: auto;"/>
				</MkA>
			</div>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { useSnakeAvailability } from '@/games/snake/availability.js';

const snakeEnabled = useSnakeAvailability();

definePage(() => ({
	title: 'Misskey Games',
	icon: 'ti ti-device-gamepad',
}));
</script>

<style lang="scss" module>
.link:focus-within {
	outline: 2px solid var(--MI_THEME-focus);
	outline-offset: -2px;
}

.snake { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 32px 16px; text-align: center; i { font-size: 2.5em; color: var(--MI_THEME-accent); } strong { font-size: 1.5em; } span { opacity: .75; } }
</style>
