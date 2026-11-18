/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Point } from './types.js';

export const wrap = (value: number, size: number): number => ((value % size) + size) % size;
export const wrappedDelta = (from: number, to: number, size: number): number => wrap(to - from + size / 2, size) - size / 2;

/** Keep adjacent body points continuous even when their authoritative coordinates cross a seam. */
export function unwrapSegments(points: Point[], camera: Point, world: { width: number; height: number }): Point[] {
	const result: Point[] = [];
	for (let index = 0; index < points.length; index++) {
		const previous = index ? points[index - 1] : camera;
		const offset = index ? result[index - 1] : { x: 0, y: 0 };
		result.push({ x: offset.x + wrappedDelta(previous.x, points[index].x, world.width), y: offset.y + wrappedDelta(previous.y, points[index].y, world.height) });
	}
	return result;
}
