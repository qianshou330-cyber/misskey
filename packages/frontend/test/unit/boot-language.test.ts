/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const migrationKey = 'puboDefaultLanguageVersion';
const supportedLangs = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'fr-FR'];

function readSource(relativePath: string) {
	return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

const loaders = [
	{ name: 'main', file: '../../public/loader/boot.js', prefix: '/vite/' },
	{ name: 'embed', file: '../../../frontend-embed/public/loader/boot.js', prefix: '/embed_vite/' },
].map(loader => ({ ...loader, source: readSource(loader.file) }));

function storage(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	const writes: [string, string][] = [];
	return {
		values,
		writes,
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			writes.push([key, value]);
			values.set(key, value);
		},
	};
}

async function boot(loader: typeof loaders[number], localStore: ReturnType<typeof storage>, language = 'en-US', ready = true) {
	const imports: { path: string; lang: string | null; migration: string | null }[] = [];
	const callbacks = new Map<string, () => void>();
	const pageUrl = new URL('https://pubo.example/music-charts/a2o-lite');
	const fakeWindow = { location: pageUrl, addEventListener: (name: string, callback: () => void) => callbacks.set(name, callback) };
	const fakeDocument = {
		readyState: ready ? 'complete' : 'loading',
		documentElement: { style: { setProperty() {} }, classList: { add() {} } },
		head: { children: [] },
	};
	// Execute the actual full loader. Only intercept its dynamic module import;
	// no language-selection code is copied or replaced in this harness.
	expect(loader.source.match(/\bimport\(/g)).toHaveLength(1);
	const execution = runInNewContext(loader.source.replace(/\bimport\(/g, '__importApp('), {
		window: fakeWindow,
		document: fakeDocument,
		location: pageUrl,
		localStorage: localStore,
		navigator: { language, languages: [language, 'zh-CN'] },
		LANGS: supportedLangs,
		CLIENT_ENTRY: 'scripts/entry.js',
		URLSearchParams,
		console,
		__importApp: async (path: string) => {
			imports.push({ path, lang: localStore.getItem('lang'), migration: localStore.getItem(migrationKey) });
		},
	});
	await execution;
	return { imports, loadDocument: async () => { callbacks.get('DOMContentLoaded')?.(); await Promise.resolve(); } };
}

// Read and execute the real settings watcher, without mounting its unrelated
// account/settings controls or reimplementing the manual-language persistence.
function chooseLanguage(localStore: ReturnType<typeof storage>, value: string) {
	const component = readSource('../../src/pages/settings/preferences.vue');
	const script = component.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1];
	expect(script).toBeDefined();
	const ast = ts.createSourceFile('preferences.ts', script!, ts.ScriptTarget.Latest, true);
	let watcher: ts.CallExpression | undefined;

	function visit(node: ts.Node) {
		if (ts.isCallExpression(node) && node.expression.getText(ast) === 'watch' && node.arguments[0]?.getText(ast) === 'lang') watcher = node;
		ts.forEachChild(node, visit);
	}

	visit(ast);
	expect(watcher).toBeDefined();
	const code = ts.transpileModule(watcher!.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
	runInNewContext(code, { watch: (_value: unknown, callback: () => void) => callback(), lang: { value }, miLocalStorage: localStore });
}

describe.each(loaders)('$name early language selection', loader => {
	it.each(['en-US', 'en-GB', 'zh-Hans', 'zh-Hans-CN', 'zh-TW', 'ja-JP'])('defaults a new %s browser to Chinese before importing', async browserLanguage => {
		const result = await boot(loader, storage(), browserLanguage);
		expect(result.imports).toEqual([{ path: `${loader.prefix}zh-CN/entry.js`, lang: 'zh-CN', migration: '1' }]);
	});

	it.each(['', 'null', 'not-a-language', 'zh-Hans-CN', 'en-GB'])('repairs invalid stored language %j', async value => {
		const localStore = storage({ lang: value, [migrationKey]: '1' });
		await boot(loader, localStore);
		expect(localStore.getItem('lang')).toBe('zh-CN');
	});

	it('migrates legacy English exactly once and preserves later manual English', async () => {
		const localStore = storage({ lang: 'en-US' });
		expect((await boot(loader, localStore)).imports[0].lang).toBe('zh-CN');
		chooseLanguage(localStore, 'en-US');
		expect((await boot(loader, localStore)).imports[0].lang).toBe('en-US');
		expect((await boot(loader, localStore)).imports[0].lang).toBe('en-US');
	});

	it.each(['zh-CN', 'zh-TW', 'ja-JP', 'fr-FR'])('preserves and marks existing %s before any later English choice', async value => {
		const localStore = storage({ lang: value });
		expect((await boot(loader, localStore)).imports[0].lang).toBe(value);
		expect(localStore.getItem(migrationKey)).toBe('1');
		localStore.setItem('lang', 'en-US');
		expect((await boot(loader, localStore)).imports[0].lang).toBe('en-US');
	});

	it('protects an explicit settings choice even before a migrated loader has run', async () => {
		const localStore = storage({ lang: 'ja-JP' });
		chooseLanguage(localStore, 'en-US');
		expect(localStore.writes).toEqual([[migrationKey, '1'], ['lang', 'en-US']]);
		expect((await boot(loader, localStore)).imports[0].lang).toBe('en-US');
	});

	it('persists the selection before deferred DOM startup without altering other storage', async () => {
		const localStore = storage({ lang: 'en-US', account: 'synthetic-account', preferences: 'synthetic-preferences' });
		const result = await boot(loader, localStore, 'en-US', false);
		expect(result.imports).toEqual([]);
		expect(localStore.getItem('lang')).toBe('zh-CN');
		expect(localStore.getItem(migrationKey)).toBe('1');
		await result.loadDocument();
		expect(result.imports[0].path).toBe(`${loader.prefix}zh-CN/entry.js`);
		expect(localStore.getItem('account')).toBe('synthetic-account');
		expect(localStore.getItem('preferences')).toBe('synthetic-preferences');
		expect([...new Set(localStore.writes.map(([key]) => key))].sort()).toEqual(['lang', migrationKey].sort());
	});
});

describe('shared language policy', () => {
	it.each([[0, 1], [1, 0]])('shares the migration across loader order %s then %s', async (first, second) => {
		const localStore = storage({ lang: 'en-US' });
		await boot(loaders[first], localStore);
		expect(localStore.getItem('lang')).toBe('zh-CN');
		chooseLanguage(localStore, 'en-US');
		const result = await boot(loaders[second], localStore);
		expect(result.imports[0].lang).toBe('en-US');
	});

	it('uses Chinese as the shared runtime fallback without writing account storage', () => {
		const source = readSource('../../../frontend-shared/js/config.ts');
		const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
		const exports: Record<string, unknown> = {};
		const localStore = storage();
		runInNewContext(code, {
			exports,
			URL,
			localStorage: localStore,
			_LANGS_: supportedLangs,
			_VERSION_: 'test',
			window: { document: { querySelector: () => null }, location: new URL('https://pubo.example'), matchMedia: () => ({ matches: false }) },
		});
		expect(exports.lang).toBe('zh-CN');
		expect(localStore.writes).toEqual([]);
	});
});
