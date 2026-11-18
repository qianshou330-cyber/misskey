/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineConfig, mergeConfig } from 'vitest/config';
import { baseConfig } from './vitest.config.js';

// This suite owns one isolated DB connection and its schema lifecycle. Do not
// bootstrap the normal Nest unit environment alongside the maintenance test.
export default mergeConfig(baseConfig, defineConfig({
	test: { include: ['test/unit/ChatPrivateAttachments.ts'] },
}));
