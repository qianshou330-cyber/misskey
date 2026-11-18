/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Manifest } from 'vite';
import type { ViteFiles } from './views/_.js';

/** Traverse static dependencies only; optional routes remain lazy. */
export function collectViteAssets(manifest: Manifest): ViteFiles {
	const entry = manifest['src/_boot_.ts'] ?? Object.values(manifest).find(chunk => chunk.isEntry);
	const modules = new Set<string>();
	const css = new Set<string>();
	const seen = new Set<string>();

	function visit(id: string, scripts: Set<string>, styles: Set<string>, visited: Set<string>) {
		if (visited.has(id)) return;
		visited.add(id);
		const chunk = manifest[id];
		if (!chunk) return;
		if (chunk.file.endsWith('.js')) scripts.add(chunk.file);
		chunk.css?.forEach(file => styles.add(file));
		chunk.imports?.forEach(child => visit(child, scripts, styles, visited));
	}

	if (entry) {
		modules.add(entry.file);
		entry.css?.forEach(file => css.add(file));
		entry.imports?.forEach(id => visit(id, modules, css, seen));
	}
	const welcomeModules = new Set<string>();
	const welcomeCss = new Set<string>();
	const welcomeSeen = new Set<string>();
	for (const id of ['src/ui/visitor.vue', 'src/pages/welcome.vue']) {
		visit(id, welcomeModules, welcomeCss, welcomeSeen);
	}
	const iconCss = manifest['../icons-subsetter/built/tabler-icons-frontend.css']?.file;
	return {
		entryJs: entry?.file ?? null,
		css: [...css],
		modulePreloads: [...modules],
		welcomePreloads: [...welcomeModules].filter(file => !modules.has(file)),
		welcomeCss: [...welcomeCss].filter(file => !css.has(file)),
		iconCss,
	};
}
