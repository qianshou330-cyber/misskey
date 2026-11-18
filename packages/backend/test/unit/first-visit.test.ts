/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import { collectViteAssets } from '@/server/web/vite-assets.js';
import { Layout } from '@/server/web/views/base.js';
import type { Manifest } from 'vite';
import type { CommonProps } from '@/server/web/views/_.js';

const manifest: Manifest = {
	'src/i18n.ts': { file: 'scripts/i18n.js', isEntry: true },
	'src/_boot_.ts': { file: 'scripts/boot.js', isEntry: true, imports: ['shared', 'missing', 'second'], css: ['assets/base.css'] },
	shared: { file: 'scripts/shared.js', imports: ['deep'], css: ['assets/shared.css'] },
	deep: { file: 'scripts/deep.js', imports: ['shared'] },
	second: { file: 'scripts/second.js' },
	'src/ui/visitor.vue': { file: 'scripts/visitor.js', imports: ['shared'] },
	'src/pages/welcome.vue': { file: 'scripts/welcome.js', imports: ['shared'], css: ['assets/welcome.css'], dynamicImports: ['classic', 'charts'] },
	classic: { file: 'scripts/classic.js' },
	charts: { file: 'scripts/charts.js' },
	'../icons-subsetter/built/tabler-icons-frontend.css': { file: 'assets/icons.css' },
};

describe('manifest-driven first visit hints', () => {
	it('selects the actual boot entry and traverses all static dependencies once, not optional features', () => {
		const files = collectViteAssets(manifest);
		expect(files.entryJs).toBe('scripts/boot.js');
		expect(files.modulePreloads).toEqual(['scripts/boot.js', 'scripts/shared.js', 'scripts/deep.js', 'scripts/second.js']);
		expect(files.welcomePreloads).toEqual(['scripts/visitor.js', 'scripts/welcome.js']);
		expect(files.welcomeCss).toEqual(['assets/welcome.css']);
		expect(files.iconCss).toBe('assets/icons.css');
	});
	it('supports missing manifests and embed entries without guessing filenames', () => {
		expect(collectViteAssets({}).entryJs).toBeNull();
		expect(collectViteAssets({ embed: { file: 'scripts/embed.js', isEntry: true } }).entryJs).toBe('scripts/embed.js');
	});
	it('places metadata and language loader before blocking CSS, keeps DOM startup and removes image prefetches', async () => {
		const props = { version: 'test', config: { url: 'https://example.test' }, langs: ['zh-CN'], frontendViteFiles: collectViteAssets(manifest), frontendBootloaderJs: '/* EARLY_BOOT */', frontendBootloaderCss: '#splash{}', metaJson: '{}', serverErrorImageUrl: 'https://external.test/error.jpg', infoImageUrl: 'https://external.test/info.jpg', notFoundImageUrl: 'https://external.test/not-found.jpg' } as unknown as CommonProps;
		const html = String(await Layout(props));
		expect(html.indexOf('EARLY_BOOT')).toBeLessThan(html.indexOf('rel="stylesheet"'));
		expect(html.indexOf('id="misskey_meta"')).toBeLessThan(html.indexOf('EARLY_BOOT'));
		expect(html).not.toContain('rel="prefetch"');
		expect(html).toContain('pubo-white-660-v1.webp');
		expect(html).toContain('width="660"');
	});
});
