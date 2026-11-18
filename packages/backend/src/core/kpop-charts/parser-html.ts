/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { parse, HTMLElement } from 'node-html-parser';

/** Small read-only selector facade for the reviewed chart parsers. No scripts,
 * networking, browser layout, generic DOM mutation, or extra HTML dependency. */
class Selection {
	constructor(private nodes: HTMLElement[], private previous?: Selection) {}
	get length(): number { return this.nodes.length; }
	text(): string { return this.nodes.map(node => node.rawTagName?.toLowerCase() === 'script' ? node.rawText : node.text).join(''); }
	html(): string | null { return this.nodes[0]?.innerHTML ?? null; }
	attr(name: string): string | undefined { return this.nodes[0]?.getAttribute(name); }
	val(): string | undefined { return this.attr('value'); }
	first(): Selection { return this.eq(0); }
	eq(index: number): Selection { return new Selection(this.nodes[index] ? [this.nodes[index]] : [], this); }
	find(selector: string): Selection { return new Selection([...new Set(this.nodes.flatMap(node => node.querySelectorAll(selector)))], this); }
	filter(callback: (index: number, element: HTMLElement) => boolean): Selection { return new Selection(this.nodes.filter((node, index) => callback(index, node)), this); }
	toArray(): HTMLElement[] { return [...this.nodes]; }
	each(callback: (index: number, element: HTMLElement) => void): Selection { this.nodes.forEach((node, index) => callback(index, node)); return this; }
	hasClass(name: string): boolean { return this.nodes.some(node => node.classList.contains(name)); }
	clone(): Selection { return new Selection(this.nodes.map(node => parse(node.outerHTML).firstChild as HTMLElement)); }
	children(): Selection { return new Selection(this.nodes.flatMap(node => node.childNodes.filter(child => child instanceof HTMLElement) as HTMLElement[]), this); }
	remove(): Selection { this.nodes.forEach(node => node.remove()); return this; }
	end(): Selection { return this.previous ?? new Selection([]); }
}
export type CheerioAPI = (input: string | HTMLElement) => Selection;
export function load(html: string): CheerioAPI {
	const root = parse(html, { comment: false, blockTextElements: { script: true, style: true, pre: true } });
	return (input: string | HTMLElement) => new Selection(typeof input === 'string' ? root.querySelectorAll(input) : [input]);
}
