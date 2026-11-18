/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
	plugins: [vue({ template: { transformAssetUrls: false } })],
	define: { _LANGS_: JSON.stringify([['zh-CN', '简体中文']]), _VERSION_: JSON.stringify('loading-test'), _DEV_: true, _PERF_PREFIX_: JSON.stringify('Misskey:') },
	resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)), '@@': fileURLToPath(new URL('../frontend-shared', import.meta.url)) } },
	test: {
		include: ['test/unit/custom-emoji*.test.ts', 'test/unit/loading-*.test.ts'],
		environment: 'happy-dom',
	},
});
