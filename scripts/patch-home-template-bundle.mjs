/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Compatibility overlay for the exact deployed backend bundle. A normal full
// backend build compiles the same canonical template sources without this shim.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(new URL('../packages/frontend/package.json', import.meta.url));
const ts = require('typescript');
const sha = value => createHash('sha256').update(value).digest('hex');
export const parentSha256 = '6a28aac4e85e6e7662c1d676dc7ce2814cf1a801e5bf5dc7b0c4151231e97546';
export const bundleName = 'ServerService-DH5X58B1.js';
const prefix = 'import { Layout as __puboFirstVisitLayout } from "./server/web/views/base.js";\nimport { collectViteAssets as __puboFirstVisitCollect } from "./server/web/vite-assets.js";\n';

function sites(text) {
	const source = ts.createSourceFile(bundleName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
	const found = [];
	function visit(node) {
		const layout = ts.isFunctionDeclaration(node) && node.name?.text === 'Layout';
		const collector = ts.isMethodDeclaration(node) && node.name.getText(source) === 'collectViteAssetFiles' && node.parent.name?.text === 'HtmlTemplateService';
		if (layout || collector) {
			if (node.parameters.length !== 1 || !ts.isIdentifier(node.parameters[0].name) || !node.body) throw new Error('UNEXPECTED_TEMPLATE_SIGNATURE');
			found.push({ name: layout ? 'Layout' : 'HtmlTemplateService.collectViteAssetFiles', start: node.body.getStart(source), end: node.body.end, parameter: node.parameters[0].name.text });
		}
		ts.forEachChild(node, visit);
	}
	visit(source);
	if (found.length !== 2 || new Set(found.map(item => item.name)).size !== 2) throw new Error('TEMPLATE_SITES_NOT_UNIQUE');
	return found.sort((a, b) => a.start - b.start);
}

function outside(text, ranges) {
	let offset = 0;
	const parts = [];
	for (const site of ranges) { parts.push(text.slice(offset, site.start)); offset = site.end; }
	parts.push(text.slice(offset));
	return parts.join('/* canonical template body */');
}

export function patchTemplateBundle(original) {
	if (sha(original) !== parentSha256) throw new Error('PARENT_BUNDLE_HASH_MISMATCH');
	if (original.includes('__puboFirstVisit')) throw new Error('ALREADY_PATCHED');
	const ranges = sites(original);
	let text = original;
	for (const site of [...ranges].reverse()) {
		const helper = site.name === 'Layout' ? '__puboFirstVisitLayout' : '__puboFirstVisitCollect';
		text = text.slice(0, site.start) + `{return ${helper}(${site.parameter});}` + text.slice(site.end);
	}
	const untouched = outside(original, ranges);
	if (outside(text, sites(text)) !== untouched) throw new Error('NON_TEMPLATE_BYTES_CHANGED');
	const patched = prefix + text;
	return { text: patched, proof: { status: 'PASS', bundle: bundleName, parentSha256, outputSha256: sha(patched),
		unchangedOutsideTemplatesSha256: sha(untouched), replacedBodies: ranges.map(site => site.name),
		imports: ['./server/web/views/base.js', './server/web/vite-assets.js'], businessCodeByteIdentical: true } };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
	if (process.argv.length !== 4) throw new Error('EXPECTED_PARENT_BUNDLE_AND_PROOF_PATH');
	const result = patchTemplateBundle(readFileSync(process.argv[2], 'utf8'));
	const target = fileURLToPath(new URL(`../packages/backend/built/${bundleName}`, import.meta.url));
	writeFileSync(target, result.text, { flag: 'wx' });
	writeFileSync(process.argv[3], JSON.stringify(result.proof, null, 2), { flag: 'wx' });
	console.log(JSON.stringify(result.proof));
}
