/* SPDX-FileCopyrightText: 2026 PUBO contributors
 * SPDX-License-Identifier: MIT */

export const PROTOCOL_VERSION = 1;
export const SOCKET_PATH = '/games/snake/socket.io/';
export const WORLD = { width: 3000, height: 3000 } as const;
export const MAX_HUMANS = 20;
export type Point = { x: number; y: number };
export type Food = Point & { id: string; value: number };
export type Player = {
  id: string; name: string; isBot: boolean; alive: boolean; score: number;
  boosting: boolean; angle: number; segments: Point[];
};
export type State = {
  tick: number; at: number; humans: number; bots: number; players: Player[];
  leaderboard: { id: string; name: string; isBot: boolean; score: number }[];
};
export type FoodDelta = { version: number; add: Food[]; remove: string[] };
export type Ready = {
  v: 1; selfId: string; world: typeof WORLD; maxHumans: number;
  foodVersion: number; foods: Food[]; state: State;
};
export type Input = { seq: number; angle: number; boost: boolean };
export type Ack = { ok: boolean; code?: string };
export type Dead = { score: number; length: number; reason: 'collision' };
export interface ServerEvents {
  'game:ready': (data: Ready) => void;
  'game:state': (data: State) => void;
  'game:food': (data: FoodDelta) => void;
  'game:foodSnapshot': (data: { version: number; foods: Food[] }) => void;
  'game:dead': (data: Dead) => void;
  'game:closing': () => void;
}
export interface ClientEvents {
  'game:input': (data: Input) => void;
  'game:restart': (data: Record<string, never>, ack?: (data: Ack) => void) => void;
  'game:syncFood': (data: Record<string, never>) => void;
}
