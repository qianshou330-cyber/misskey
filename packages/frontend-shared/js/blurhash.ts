/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { decode, isBlurhashValid } from 'blurhash';

export const BLURHASH_DECODE_EDGE = 32;
export const BLURHASH_DISPLAY_EDGE = 64;

export type BlurhashRequest = { id: number; hash: string; width: number; height: number };
export type BlurhashPixels = { width: number; height: number; pixels: ArrayBuffer };
export type BlurhashResponse = { id: number; result: BlurhashPixels | null };

export function isValidBlurhash(hash: unknown): hash is string {
	return typeof hash === 'string' && hash.length >= 6 && hash.length <= 166
		&& /^[0-9A-Za-z#$%*+,\-.:;=?@\[\]^_{|}~]+$/.test(hash) && isBlurhashValid(hash).result;
}

/** Both decode cost and display backing stores are independent of remote dimensions. */
export function getBlurhashSize(width: number, height: number, edge: number): { width: number; height: number } | null {
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
	const ratio = Math.min(8, Math.max(1 / 8, width / height));
	return ratio >= 1
		? { width: edge, height: Math.max(1, Math.round(edge / ratio)) }
		: { width: Math.max(1, Math.round(edge * ratio)), height: edge };
}

/** Pure CPU decoding: no canvas, WebGL context, GPU objects or ImageBitmaps. */
export function decodeBlurhash(request: BlurhashRequest): BlurhashResponse {
	const { id, hash, width, height } = request;
	if (!isValidBlurhash(hash) || !Number.isInteger(width) || !Number.isInteger(height)
		|| width < 1 || height < 1 || width > BLURHASH_DECODE_EDGE || height > BLURHASH_DECODE_EDGE) {
		return { id, result: null };
	}
	try {
		const pixels = decode(hash, width, height);
		return { id, result: { width, height, pixels: pixels.buffer as ArrayBuffer } };
	} catch {
		return { id, result: null };
	}
}
