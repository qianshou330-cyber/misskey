/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { SnakeScene } from './scene.js';
import { unwrapSegments, wrap, wrappedDelta } from './geometry.js';

export function drawSnake(canvas: HTMLCanvasElement, scene: SnakeScene, now: number, computerLabel: string): void {
	const context = canvas.getContext('2d');
	if (!context) return;
	const width = canvas.clientWidth;
	const height = canvas.clientHeight;
	if (!width || !height) return;
	const ratio = Math.min(2, window.devicePixelRatio || 1);
	if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
		canvas.width = Math.round(width * ratio);
		canvas.height = Math.round(height * ratio);
	}
	context.setTransform(ratio, 0, 0, ratio, 0, 0);
	const style = getComputedStyle(canvas);
	const color = (name: string): string => style.getPropertyValue(`--MI_THEME-${name}`).trim() || style.color;
	const bg = color('bg');
	const fg = color('fg');
	const accent = color('accent');
	const other = color('link');
	const computer = color('warn');
	context.fillStyle = bg;
	context.fillRect(0, 0, width, height);
	const players = scene.players(now);
	const self = players.find(player => player.id === scene.selfId);
	const target = self?.segments[0] ?? { x: scene.world.width / 2, y: scene.world.height / 2 };
	const scale = width < 600 ? 0.8 : 1;
	const x = (value: number): number => wrappedDelta(target.x, value, scene.world.width) * scale + width / 2;
	const y = (value: number): number => wrappedDelta(target.y, value, scene.world.height) * scale + height / 2;
	context.strokeStyle = color('divider');
	context.lineWidth = 1;
	context.beginPath();
	const grid = 100 * scale;
	for (let column = wrap(width / 2 - target.x * scale, grid); column <= width; column += grid) {
		context.moveTo(column, 0); context.lineTo(column, height);
	}
	for (let row = wrap(height / 2 - target.y * scale, grid); row <= height; row += grid) {
		context.moveTo(0, row); context.lineTo(width, row);
	}
	context.stroke();
	for (const food of scene.foods.values()) {
		const fx = x(food.x), fy = y(food.y);
		if (fx < -8 || fy < -8 || fx > width + 8 || fy > height + 8) continue;
		context.beginPath();
		context.fillStyle = food.value > 1 ? computer : accent;
		context.arc(fx, fy, (food.value > 1 ? 4 : 2.5) * scale, 0, Math.PI * 2);
		context.fill();
	}
	context.lineCap = 'round';
	context.lineJoin = 'round';
	for (const player of players) {
		const head = player.segments[0];
		if (!head) continue;
		const hue = player.id === scene.selfId ? accent : player.isBot ? computer : other;
		context.strokeStyle = hue;
		context.lineWidth = 14 * scale;
		context.globalAlpha = player.isBot ? 0.72 : 1;
		context.shadowColor = hue;
		context.shadowBlur = player.boosting ? 12 : 0;
		const segments = unwrapSegments(player.segments, target, scene.world);
		const minX = Math.min(...segments.map(point => point.x));
		const maxX = Math.max(...segments.map(point => point.x));
		const minY = Math.min(...segments.map(point => point.y));
		const maxY = Math.max(...segments.map(point => point.y));
		// A long body can be visible across a seam even when its head is off screen.
		for (const shiftX of [-scene.world.width, 0, scene.world.width]) {
			for (const shiftY of [-scene.world.height, 0, scene.world.height]) {
				if ((maxX + shiftX) * scale + width / 2 < -16 || (minX + shiftX) * scale + width / 2 > width + 16 || (maxY + shiftY) * scale + height / 2 < -16 || (minY + shiftY) * scale + height / 2 > height + 16) continue;
				context.beginPath();
				segments.forEach((point, index) => {
					const sx = (point.x + shiftX) * scale + width / 2;
					const sy = (point.y + shiftY) * scale + height / 2;
					if (index === 0) context.moveTo(sx, sy); else context.lineTo(sx, sy);
				});
				context.stroke();
			}
		}
		context.shadowBlur = 0;
		context.globalAlpha = 1;
		context.fillStyle = hue;
		context.beginPath(); context.arc(x(head.x), y(head.y), 8 * scale, 0, Math.PI * 2); context.fill();
		for (const side of [-1, 1]) {
			const angle = player.angle + side * 0.6;
			context.fillStyle = bg;
			context.beginPath(); context.arc(x(head.x) + Math.cos(angle) * 5 * scale, y(head.y) + Math.sin(angle) * 5 * scale, 2 * scale, 0, Math.PI * 2); context.fill();
		}
		context.fillStyle = fg;
		context.textAlign = 'center';
		context.font = '12px sans-serif';
		context.fillText(`${player.name}${player.isBot ? ` · ${computerLabel}` : ''}`, x(head.x), y(head.y) - 18, 180);
	}
}
