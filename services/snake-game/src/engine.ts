/* SPDX-FileCopyrightText: 2025 m0Corut
 * SPDX-FileCopyrightText: 2026 PUBO contributors
 * SPDX-License-Identifier: MIT
 * Movement, growth, boost cost and collisions adapted from snake-io-multiplayer
 * commit 474db86fadce1bed2dbc8019b5c5415ce5a6d714. See UPSTREAM.json. */

import { randomUUID } from 'node:crypto';
import { MAX_HUMANS, WORLD } from './protocol.js';
import type { Dead, Food, FoodDelta, Input, Player, Point, Ready, State } from './protocol.js';

export const LIMITS = { initialFood: 300, maxFood: 360, maxSegments: 160, initialSegments: 10, speed: 6, spacing: 8, turn: Math.PI / 8 } as const;
type Internal = Player & { input: Input; nextBotLife: number; lastInputTick: number };
const wrap = (value: number, size: number): number => ((value % size) + size) % size;
const difference = (a: number, b: number, size: number): number => wrap(a - b + size / 2, size) - size / 2;
const angleDifference = (a: number, b: number): number => difference(a, b, Math.PI * 2);
const squareDistance = (a: Point, b: Point): number => difference(a.x, b.x, WORLD.width) ** 2 + difference(a.y, b.y, WORLD.height) ** 2;
const rounded = (value: number): number => Math.round(value * 10) / 10;

export function validInput(data: unknown): data is Input {
  if (!data || typeof data !== 'object') return false;
  const value = data as Partial<Input>;
  return Number.isSafeInteger(value.seq) && value.seq! >= 0 && typeof value.angle === 'number' &&
    Number.isFinite(value.angle) && Math.abs(value.angle) <= Math.PI * 2 && typeof value.boost === 'boolean';
}

export class Arena {
  readonly players = new Map<string, Internal>();
  readonly foods = new Map<string, Food>();
  tick = 0;
  foodVersion = 0;
  private foodId = 0;
  private pendingAdded = new Map<string, Food>();
  private pendingRemoved = new Set<string>();
  private deaths: { id: string; data: Dead }[] = [];
  constructor(private readonly random: () => number = Math.random, readonly maxHumans = MAX_HUMANS) {
    if (!Number.isInteger(maxHumans) || maxHumans < 1 || maxHumans > MAX_HUMANS) throw new Error('SNAKE_MAX_HUMANS must be an integer from 1 to 20');
  }

  get humans(): number { return [...this.players.values()].filter(player => !player.isBot).length; }
  get bots(): number { return [...this.players.values()].filter(player => player.isBot).length; }

  addHuman(name: string): string {
    if (this.humans >= this.maxHumans) throw new Error('FULL');
    if (this.humans === 0) this.fillFood();
    const id = randomUUID();
    this.players.set(id, this.createPlayer(id, name, false));
    this.reconcileBots();
    return id;
  }

  removeHuman(id: string): void {
    const player = this.players.get(id);
    if (!player || player.isBot) return;
    if (player.alive) this.dropFood(player);
    this.players.delete(id);
    this.reconcileBots();
    if (this.humans === 0) {
      this.players.clear(); this.foods.clear(); this.pendingAdded.clear(); this.pendingRemoved.clear();
      this.deaths = []; this.tick = 0; this.foodVersion = 0;
    }
  }

  restart(id: string): boolean {
    const player = this.players.get(id);
    if (!player || player.isBot || player.alive) return false;
    this.players.set(id, this.createPlayer(id, player.name, false));
    return true;
  }

  input(id: string, input: unknown): boolean {
    if (!validInput(input)) return false;
    const player = this.players.get(id);
    if (!player?.alive || input.seq <= player.input.seq) return false;
    player.input = input;
    player.lastInputTick = this.tick;
    return true;
  }

  step(): void {
    if (this.humans === 0) return;
    this.tick++;
    for (const player of this.players.values()) {
      if (!player.alive) {
        if (player.isBot && this.tick >= player.nextBotLife) this.players.set(player.id, this.createPlayer(player.id, player.name, true));
        continue;
      }
      if (player.isBot && this.tick % 3 === 0) this.botInput(player);
      if (!player.isBot && this.tick - player.lastInputTick >= 15) player.input.boost = false;
      const turn = angleDifference(player.input.angle, player.angle);
      player.angle = wrap(player.angle + Math.max(-LIMITS.turn, Math.min(LIMITS.turn, turn)), Math.PI * 2);
      player.boosting = player.input.boost && player.segments.length > 3;
      if (player.boosting && this.tick % 5 === 0) this.addFood(player.segments.pop()!, 1);
      const head = player.segments[0]!;
      for (let index = player.segments.length - 1; index > 0; index--) {
        const segment = player.segments[index]!;
        const target = player.segments[index - 1]!;
        const dx = difference(target.x, segment.x, WORLD.width);
        const dy = difference(target.y, segment.y, WORLD.height);
        const distance = Math.hypot(dx, dy);
        if (distance > LIMITS.spacing) {
          segment.x = wrap(target.x - dx * LIMITS.spacing / distance, WORLD.width);
          segment.y = wrap(target.y - dy * LIMITS.spacing / distance, WORLD.height);
        }
      }
      const speed = LIMITS.speed * (player.boosting ? 2 : 1);
      head.x = wrap(head.x + Math.cos(player.angle) * speed, WORLD.width);
      head.y = wrap(head.y + Math.sin(player.angle) * speed, WORLD.height);
      for (const food of this.foods.values()) {
        if (squareDistance(head, food) >= 24 ** 2) continue;
        player.score += food.value;
        if (player.segments.length < LIMITS.maxSegments) player.segments.push({ ...player.segments.at(-1)! });
        this.removeFood(food.id);
      }
    }
    this.collisions();
    this.fillFood();
  }

  takeDeaths(): { id: string; data: Dead }[] { const deaths = this.deaths; this.deaths = []; return deaths; }

  takeFoodDelta(): FoodDelta | null {
    if (this.pendingAdded.size === 0 && this.pendingRemoved.size === 0) return null;
    const delta = { version: ++this.foodVersion, add: [...this.pendingAdded.values()], remove: [...this.pendingRemoved] };
    this.pendingAdded.clear(); this.pendingRemoved.clear();
    return delta;
  }

  state(): State {
    const players = [...this.players.values()].map(player => ({
      id: player.id, name: player.name, isBot: player.isBot, alive: player.alive, score: player.score,
      boosting: player.boosting, angle: Math.round(player.angle * 1000) / 1000,
      segments: player.segments.map(point => ({ x: rounded(point.x), y: rounded(point.y) })),
    }));
    return {
      tick: this.tick, at: Date.now(), humans: this.humans, bots: this.bots, players,
      leaderboard: players.filter(player => player.alive).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 10)
        .map(({ id, name, isBot, score }) => ({ id, name, isBot, score })),
    };
  }

  ready(id: string): Ready {
    return { v: 1, selfId: id, world: WORLD, maxHumans: this.maxHumans, foodVersion: this.foodVersion, foods: [...this.foods.values()], state: this.state() };
  }

  private createPlayer(id: string, name: string, isBot: boolean): Internal {
    const angle = this.random() * Math.PI * 2;
    let head = this.randomPoint();
    // Bounded spawn search avoids spawning into an existing snake without blocking the loop.
    for (let attempt = 0; attempt < 30; attempt++) {
      if (![...this.players.values()].some(player => player.alive && player.segments.some(point => squareDistance(head, point) < 100 ** 2))) break;
      head = this.randomPoint();
    }
    const segments = Array.from({ length: LIMITS.initialSegments }, (_, index) => ({
      x: wrap(head.x - Math.cos(angle) * index * LIMITS.spacing, WORLD.width),
      y: wrap(head.y - Math.sin(angle) * index * LIMITS.spacing, WORLD.height),
    }));
    return {
      id, name: [...name.replace(/[\p{Cc}\p{Cf}]/gu, '').trim()].slice(0, 30).join('') || 'PUBO',
      isBot, alive: true, score: 0, boosting: false, angle, segments,
      input: { seq: -1, angle, boost: false }, nextBotLife: 0, lastInputTick: this.tick,
    };
  }

  private reconcileBots(): void {
    const desired = Math.min(5, Math.max(0, 6 - this.humans));
    for (let index = 0; index < 5; index++) {
      const id = `bot-${index}`;
      if (index < desired && !this.players.has(id)) this.players.set(id, this.createPlayer(id, `电脑 ${index + 1}`, true));
      else if (index >= desired) this.players.delete(id);
    }
  }

  private botInput(player: Internal): void {
    const head = player.segments[0]!;
    let nearest: Point | undefined;
    let best = Infinity;
    for (const other of this.players.values()) {
      if (other.id === player.id || !other.alive) continue;
      for (let index = 0; index < other.segments.length; index += 3) {
        const point = other.segments[index]!;
        if (squareDistance(head, point) < 110 ** 2) {
          player.input = { seq: player.input.seq + 1, angle: Math.atan2(difference(head.y, point.y, WORLD.height), difference(head.x, point.x, WORLD.width)), boost: false };
          return;
        }
      }
    }
    for (const food of this.foods.values()) {
      const distance = squareDistance(head, food);
      if (distance < best) { nearest = food; best = distance; }
    }
    if (nearest) player.input = { seq: player.input.seq + 1, angle: Math.atan2(difference(nearest.y, head.y, WORLD.height), difference(nearest.x, head.x, WORLD.width)), boost: false };
  }

  private collisions(): void {
    const grid = new Map<string, { id: string; point: Point }[]>();
    const cellSize = 64;
    const cells = Math.ceil(WORLD.width / cellSize);
    const key = (x: number, y: number): string => `${wrap(x, cells)},${wrap(y, cells)}`;
    for (const player of this.players.values()) {
      if (!player.alive) continue;
      for (let index = 3; index < player.segments.length; index++) {
        const point = player.segments[index]!;
        const cell = key(Math.floor(point.x / cellSize), Math.floor(point.y / cellSize));
        const items = grid.get(cell) ?? [];
        items.push({ id: player.id, point }); grid.set(cell, items);
      }
    }
    const dead = new Set<string>();
    const alive = [...this.players.values()].filter(player => player.alive);
    // Head-on collisions eliminate both participants in the same authoritative tick.
    for (let index = 0; index < alive.length; index++) for (let other = index + 1; other < alive.length; other++) {
      if (squareDistance(alive[index]!.segments[0]!, alive[other]!.segments[0]!) < 24 ** 2) {
        dead.add(alive[index]!.id); dead.add(alive[other]!.id);
      }
    }
    for (const player of this.players.values()) {
      if (!player.alive) continue;
      const head = player.segments[0]!;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const item of grid.get(key(Math.floor(head.x / cellSize) + dx, Math.floor(head.y / cellSize) + dy)) ?? []) {
          if (item.id !== player.id && squareDistance(head, item.point) < 24 ** 2) dead.add(player.id);
        }
      }
    }
    for (const id of dead) {
      const player = this.players.get(id)!;
      player.alive = false; player.boosting = false; player.nextBotLife = this.tick + 90;
      this.dropFood(player);
      if (!player.isBot) this.deaths.push({ id, data: { score: player.score, length: player.segments.length, reason: 'collision' } });
    }
  }

  private randomPoint(): Point { return { x: this.random() * WORLD.width, y: this.random() * WORLD.height }; }
  private fillFood(): void { while (this.foods.size < LIMITS.initialFood) this.addFood(this.randomPoint(), 1 + Math.floor(this.random() * 5)); }
  private addFood(point: Point, value: number): void {
    while (this.foods.size >= LIMITS.maxFood) this.removeFood(this.foods.keys().next().value!);
    const food = { id: String(++this.foodId), x: rounded(point.x), y: rounded(point.y), value };
    this.foods.set(food.id, food); this.pendingAdded.set(food.id, food);
  }
  private removeFood(id: string): void {
    this.foods.delete(id);
    this.pendingAdded.delete(id);
    // A new client may already have received this item in its initial snapshot.
    this.pendingRemoved.add(id);
  }
  private dropFood(player: Internal): void { for (let index = 0; index < player.segments.length; index += 3) this.addFood(player.segments[index]!, 5); }
}
