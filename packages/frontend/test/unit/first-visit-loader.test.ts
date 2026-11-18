/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

function readSource(path: string) { return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8'); }

const source = readSource('../../public/loader/boot.js');

async function boot({ path = '/', account = '', style = 'simple', setup = false, lang = 'zh-CN', safe = false } = {}) {
	const storage = new Map(Object.entries({ lang, account, puboDefaultLanguageVersion: '1', customCss: 'body{color:red}', isSafeMode: String(safe) }));
	const links: Record<string, string>[] = [];
	const imports: string[] = [];
	const domCallbacks: (() => void)[] = [];
	const pageUrl = new URL(`https://pubo.example${path}`);
	await runInNewContext(source.replace(/\bimport\(/g, '__importApp('), {
		window: { location: pageUrl, addEventListener: (event: string, cb: () => void) => { if (event === 'DOMContentLoaded') domCallbacks.push(cb); } },
		document: { readyState: 'loading', head: { children: [], appendChild: (link: Record<string, string>) => links.push(link) }, createElement: (tag: string) => ({ tag }), getElementById: () => ({ textContent: JSON.stringify({ requireSetup: setup, clientOptions: { entrancePageStyle: style } }) }), documentElement: { style: { setProperty() {} }, classList: { add() {} } } },
		localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
		LANGS: ['zh-CN', 'ja-JP'], CLIENT_ENTRY: 'scripts/entry.js', CLIENT_PRELOADS: ['scripts/entry.js', 'scripts/shared.js'], WELCOME_PRELOADS: ['scripts/welcome.js'], WELCOME_CSS: ['assets/welcome.css'], ICON_CSS: 'assets/icon.css', URLSearchParams, console,
		__importApp: async (path: string) => { imports.push(path); },
	});
	return { links, imports, ready: () => domCallbacks.forEach(cb => cb()) };
}

describe('early boot hints', () => {
	it('uses the selected language, fetches once and defers execution and custom styles until DOM ready', async () => {
		const result = await boot({ lang: 'ja-JP' });
		expect(result.links.filter(x => x.rel === 'modulepreload').map(x => x.href)).toEqual(['/vite/ja-JP/entry.js', '/vite/ja-JP/shared.js', '/vite/ja-JP/welcome.js']);
		expect(result.links.find(x => x.as === 'style')?.href).toBe('/vite/assets/icon.css');
		expect(result.imports).toEqual([]);
		expect(result.links.some(x => x.tag === 'style')).toBe(false);
		result.ready();
		expect(result.imports).toEqual(['/vite/ja-JP/entry.js']);
		expect(result.links.some(x => x.tag === 'style')).toBe(true);
	});
	it.each([{ path: '/settings' }, { account: '{}' }, { style: 'classic' }, { setup: true }])('does not preload welcome for %j', async options => {
		const result = await boot(options);
		expect(result.links.some(x => x.href?.includes('welcome'))).toBe(false);
	});
	it('preserves safe mode without applying custom CSS', async () => {
		const result = await boot({ safe: true });
		result.ready();
		expect(result.links.some(x => x.tag === 'style')).toBe(false);
	});
});
