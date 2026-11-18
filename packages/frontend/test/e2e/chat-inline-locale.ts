/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { resolve } from 'node:path';
import locales from 'i18n';
import { LocaleInliner } from '../../../frontend-builder/locale-inliner.js';
import { createLogger } from '../../../frontend-builder/logger.js';

const logger = createLogger();
const inliner = await LocaleInliner.create({ outputDir: resolve('../../built/_frontend_vite_'), logger, scriptsDir: 'scripts', i18nFile: 'src/i18n.ts' });
await inliner.loadFiles();
inliner.collectsModifications();
await inliner.saveLocale('en-US', locales['en-US']);
if (logger.errorCount > 0) throw new Error('Chat QA locale build failed');
