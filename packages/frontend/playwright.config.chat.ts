/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './test/e2e', testMatch: 'chat-pro.spec.ts', workers: 1, timeout: 120_000,
	outputDir: './test/e2e/chat-artifacts', reporter: [['list'], ['json', { outputFile: './test/e2e/chat-artifacts/results.json' }]],
	use: { baseURL: 'http://127.0.0.1:61819', channel: 'msedge', headless: true, locale: 'en-US', viewport: { width: 1280, height: 900 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
	webServer: { command: 'node test/e2e/chat-harness.mjs', url: 'http://127.0.0.1:61819', reuseExistingServer: false },
});
