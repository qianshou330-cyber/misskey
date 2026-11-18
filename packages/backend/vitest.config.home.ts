/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
	test: { include: ['test/unit/first-visit.test.ts'], environment: 'node' },
});
