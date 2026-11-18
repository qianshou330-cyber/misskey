/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { mergeConfig } from 'vitest/config';
import loading from './vitest.config.loading.js';

export default mergeConfig(loading, { test: { include: ['test/unit/first-visit-*.test.ts', 'test/unit/boot-language.test.ts'] } });
