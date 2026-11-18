/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { SnakeFood, SnakeFoodDelta, SnakeFoodSnapshot, SnakeReady, SnakeState, SnakePlayer } from './types.js';
import { wrap, wrappedDelta } from './geometry.js';

/** Only authoritative server states are rendered; interpolation never decides a collision or score. */
export class SnakeScene {
	selfId = '';
	world = { width: 3000, height: 3000 };
	foods = new Map<string, SnakeFood>();
	foodVersion = -1;
	previous: SnakeState | null = null;
	current: SnakeState | null = null;
	arrivedAt = 0;
	awaitingFood = false;

	clear(): void {
		this.selfId = '';
		this.foods.clear();
		this.foodVersion = -1;
		this.previous = this.current = null;
		this.awaitingFood = false;
	}

	ready(value: SnakeReady, now: number): void {
		this.clear();
		this.selfId = value.selfId;
		this.world = value.world;
		this.snapshot({ version: value.foodVersion, foods: value.foods });
		this.state(value.state, now);
	}

	state(value: SnakeState, now: number): void {
		if (this.current && value.tick <= this.current.tick) return;
		this.previous = this.current;
		this.current = value;
		this.arrivedAt = now;
	}

	delta(value: SnakeFoodDelta): boolean {
		if (value.version <= this.foodVersion) return false;
		if (this.awaitingFood) return false;
		if (value.version !== this.foodVersion + 1) {
			this.awaitingFood = true;
			return true;
		}
		for (const id of value.remove) this.foods.delete(id);
		for (const food of value.add) this.foods.set(food.id, food);
		this.foodVersion = value.version;
		return false;
	}

	snapshot(value: SnakeFoodSnapshot): void {
		if (value.version < this.foodVersion) return;
		this.foods = new Map(value.foods.map(food => [food.id, food]));
		this.foodVersion = value.version;
		this.awaitingFood = false;
	}

	players(now: number): SnakePlayer[] {
		if (!this.current) return [];
		const span = this.previous ? Math.min(150, Math.max(30, this.current.at - this.previous.at)) : 1;
		const t = Math.min(1, Math.max(0, (now - this.arrivedAt) / span));
		const previous = new Map(this.previous?.players.map(player => [player.id, player]) ?? []);
		return this.current.players.filter(player => player.alive).map(player => {
			const old = previous.get(player.id);
			if (!old?.alive) return player;
			return { ...player, segments: player.segments.map((point, index) => {
				const before = old.segments[index] ?? point;
				return { x: wrap(before.x + wrappedDelta(before.x, point.x, this.world.width) * t, this.world.width), y: wrap(before.y + wrappedDelta(before.y, point.y, this.world.height) * t, this.world.height) };
			}) };
		});
	}
}
