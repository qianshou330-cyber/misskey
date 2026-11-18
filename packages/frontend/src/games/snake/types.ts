/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export type Point = { x: number; y: number };
export type SnakeFood = Point & { id: string; value: number };
export type SnakePlayer = { id: string; name: string; isBot: boolean; alive: boolean; score: number; boosting: boolean; angle: number; segments: Point[] };
export type SnakeRank = Pick<SnakePlayer, 'id' | 'name' | 'isBot' | 'score'>;
export type SnakeState = { tick: number; at: number; humans: number; bots: number; players: SnakePlayer[]; leaderboard: SnakeRank[] };
export type SnakeReady = { v: 1; selfId: string; world: { width: number; height: number }; maxHumans: number; foodVersion: number; foods: SnakeFood[]; state: SnakeState };
export type SnakeFoodDelta = { version: number; add: SnakeFood[]; remove: string[] };
export type SnakeFoodSnapshot = { version: number; foods: SnakeFood[] };
export type SnakeTicket = { ticket: string; expiresAt: string; socketPath: string };
export type SnakeStatus = 'idle' | 'connecting' | 'playing' | 'dead' | 'disconnected' | 'error';
export type SnakeInput = { seq: number; angle: number; boost: boolean };

export interface SnakeSocket {
	connected: boolean;
	auth: Record<string, unknown>;
	on(event: string, handler: (...args: any[]) => void): SnakeSocket;
	emit(event: string, ...args: unknown[]): SnakeSocket;
	connect(): SnakeSocket;
	disconnect(): SnakeSocket;
	removeAllListeners(): SnakeSocket;
}

export type SnakeSocketFactory = (url: string, options: {
	path: string; auth: { ticket: string }; transports: ['websocket'];
	reconnection: false; autoConnect: false; forceNew: true; timeout: number;
}) => SnakeSocket;
