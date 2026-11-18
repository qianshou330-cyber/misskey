/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const root = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const viteRoot = resolve(root, 'built/_frontend_vite_');
const assetRoot = resolve(root, 'packages/frontend/assets');
const manifest = JSON.parse(await readFile(resolve(viteRoot, 'manifest.json'), 'utf8'));
const entry = manifest['src/_boot_.ts'];
const css = new Set();
const visited = new Set();

function collect(key) {
	if (visited.has(key)) return;
	visited.add(key);
	for (const style of manifest[key]?.css ?? []) css.add(style);
	for (const dependency of manifest[key]?.imports ?? []) collect(dependency);
}

collect('src/_boot_.ts');
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta property="instance_url" content="http://127.0.0.1:61819"><meta property="og:site_name" content="Chat Pro QA">${[...css].map(style => `<link rel="stylesheet" href="/vite/${style}">`).join('')}<script type="module" src="/vite/${entry.file.replace('scripts/', 'en-US/')}"></script></head><body></body></html>`;
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
createServer(async (request, response) => {
	const pathname = new URL(request.url, 'http://127.0.0.1:61819').pathname;
	if (pathname === '/sw.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end('self.addEventListener("install", () => self.skipWaiting());'); return; }
	if (pathname.startsWith('/api/')) { response.writeHead(501); response.end('QA requires mocked API'); return; }
	const base = pathname.startsWith('/vite/') ? viteRoot : pathname.startsWith('/client-assets/') ? assetRoot : null;
	if (!base) { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(html); return; }
	const relative = decodeURIComponent(pathname.replace(/^\/(?:vite|client-assets)\//, ''));
	const target = resolve(base, relative);
	if (!target.startsWith(base + sep)) { response.writeHead(403); response.end(); return; }
	try { const body = await readFile(target); response.writeHead(200, { 'Content-Type': mime[extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }); response.end(body); } catch { response.writeHead(404); response.end(); }
}).listen(61819, '127.0.0.1');
