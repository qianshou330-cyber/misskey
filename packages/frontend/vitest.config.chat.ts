/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
	plugins: [vue()],
	resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)), '@@': fileURLToPath(new URL('../frontend-shared', import.meta.url)) } },
	test: { include: ['test/unit/chat-*.test.ts'], environment: 'happy-dom' },
});
