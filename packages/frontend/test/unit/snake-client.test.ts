/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SnakeClient } from '@/games/snake/client.js';
import { SnakeScene } from '@/games/snake/scene.js';
import { SnakeControls } from '@/games/snake/input.js';
import { unwrapSegments, wrappedDelta } from '@/games/snake/geometry.js';
import type { SnakeReady, SnakeState, SnakeTicket } from '@/games/snake/types.js';

class Socket {
	connected = false;
	auth: Record<string, unknown> = {};
	handlers = new Map<string, (...args: any[]) => void>();
	on = vi.fn((event: string, handler: (...args: any[]) => void) => { this.handlers.set(event, handler); return this; });
	emit = vi.fn(() => this);
	connect = vi.fn(() => this);
	disconnect = vi.fn(() => { this.connected = false; return this; });
	removeAllListeners = vi.fn(() => { this.handlers.clear(); return this; });
	receive(event: string, value?: unknown): void { this.handlers.get(event)?.(value); }
}

function state(tick = 1, x = 100): SnakeState {
	return { tick, at: tick * 100, humans: 1, bots: 1, players: [{ id: 'human', name: '<img src=x onerror=alert(1)>', isBot: false, alive: true, score: 4, boosting: false, angle: 0, segments: [{ x, y: 100 }, { x: x - 10, y: 100 }] }], leaderboard: [{ id: 'human', name: 'Human', isBot: false, score: 4 }, { id: 'bot', name: 'Computer', isBot: true, score: 2 }] };
}

const ready = (): SnakeReady => ({ v: 1, selfId: 'human', world: { width: 3000, height: 3000 }, maxHumans: 20, foodVersion: 1, foods: [{ id: 'food', x: 40, y: 60, value: 1 }], state: state() });

describe('snake transport session safety', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	function setup() {
		const socket = new Socket();
		const io = vi.fn(() => socket);
		const ticket = vi.fn(async (): Promise<SnakeTicket> => ({ ticket: 'ephemeral-game-ticket', expiresAt: new Date(Date.now() + 60_000).toISOString(), socketPath: '/games/snake/socket.io/' }));
		const client = new SnakeClient({ ticket, factory: async () => io, origin: 'https://pubo.example', changed: vi.fn(), now: () => 0 });
		return { client, socket, io, ticket };
	}

	it('starts only on request and sends an ephemeral ticket with reconnect disabled, then clears it', async () => {
		const { client, socket, io, ticket } = setup();
		expect(ticket).not.toHaveBeenCalled();
		await client.start();
		expect(io).toHaveBeenCalledWith('https://pubo.example', { path: '/games/snake/socket.io/', auth: { ticket: 'ephemeral-game-ticket' }, transports: ['websocket'], reconnection: false, autoConnect: false, forceNew: true, timeout: 8000 });
		expect(socket.connect).toHaveBeenCalledOnce();
		socket.auth = { ticket: 'ephemeral-game-ticket' };
		socket.receive('connect');
		expect(socket.auth).toEqual({});
		socket.receive('game:ready', ready());
		expect(client.status).toBe('playing');
		client.close();
	});

	it('clears life on disconnect and requests a fresh ticket only after an explicit new start', async () => {
		const { client, socket, ticket } = setup();
		await client.start();
		socket.connected = true;
		socket.receive('game:ready', ready());
		socket.receive('disconnect');
		expect(client.status).toBe('disconnected');
		expect(client.scene.current).toBeNull();
		expect(client.scene.foods.size).toBe(0);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(ticket).toHaveBeenCalledOnce();
		await client.start();
		expect(ticket).toHaveBeenCalledTimes(2);
		client.close();
	});

	it('restarts a dead connected life manually without replaying the one-use ticket', async () => {
		const { client, socket, ticket } = setup();
		await client.start();
		socket.connected = true;
		socket.receive('game:ready', ready());
		socket.receive('game:dead', { score: 12 });
		expect(client.status).toBe('dead');
		expect(socket.emit).not.toHaveBeenCalled();
		await client.start();
		expect(socket.emit).toHaveBeenCalledWith('game:restart', {}, expect.any(Function));
		expect(ticket).toHaveBeenCalledOnce();
		socket.receive('game:ready', ready());
		expect(client.score).toBe(0);
		client.close();
	});

	it('limits a lost restart acknowledgement and a stalled ticket request', async () => {
		const { client, socket } = setup();
		await client.start();
		socket.connected = true;
		socket.receive('game:ready', ready());
		socket.receive('game:dead', { score: 2 });
		await client.start();
		await vi.advanceTimersByTimeAsync(10_000);
		expect(client.status).toBe('disconnected');
		expect(client.scene.current).toBeNull();
		const stuck = new SnakeClient({ ticket: () => new Promise(() => undefined), factory: async () => vi.fn(() => new Socket()), origin: 'https://pubo.example', changed: vi.fn() });
		void stuck.start();
		await vi.advanceTimersByTimeAsync(15_000);
		expect(stuck.status).toBe('error');
		expect(stuck.code).toBe('TIMEOUT');
		stuck.close();
	});

	it('never opens a socket from a ticket arriving after page leave', async () => {
		let resolve!: (ticket: SnakeTicket) => void;
		let signal!: AbortSignal;
		const io = vi.fn();
		const client = new SnakeClient({ ticket: value => { signal = value; return new Promise(done => { resolve = done; }); }, factory: async () => io, origin: 'https://pubo.example', changed: vi.fn() });
		const start = client.start();
		client.close();
		expect(signal.aborted).toBe(true);
		resolve({ ticket: 'late', expiresAt: new Date(Date.now() + 60_000).toISOString(), socketPath: '/games/snake/socket.io/' });
		await start;
		expect(io).not.toHaveBeenCalled();
	});

	it('handles server restart/invalid tickets as explicit retry without reconnecting automatically', async () => {
		const { client, socket, ticket } = setup();
		await client.start();
		socket.receive('connect_error', { data: { code: 'TICKET_BEFORE_BOOT' } });
		expect(client.status).toBe('error');
		expect(client.code).toBe('TICKET_BEFORE_BOOT');
		await vi.advanceTimersByTimeAsync(2000);
		expect(ticket).toHaveBeenCalledOnce();
	});

	it('requests a full food snapshot once after a delta gap and resumes reliable deltas', async () => {
		const { client, socket } = setup();
		await client.start();
		socket.receive('game:ready', ready());
		socket.receive('game:food', { version: 3, add: [], remove: [] });
		socket.receive('game:food', { version: 4, add: [], remove: [] });
		expect(socket.emit).toHaveBeenCalledExactlyOnceWith('game:syncFood', {});
		socket.receive('game:foodSnapshot', { version: 4, foods: [{ id: 'fresh', x: 1, y: 2, value: 1 }] });
		socket.receive('game:food', { version: 5, add: [], remove: ['fresh'] });
		expect(client.scene.foods.size).toBe(0);
		expect(client.scene.foodVersion).toBe(5);
		client.close();
	});
});

describe('snake authoritative interpolation', () => {
	it('interpolates the shortest path through both wrapped world seams', () => {
		const scene = new SnakeScene();
		const initial = ready(); initial.state = state(1, 2998); initial.state.players[0].segments[0].y = 4;
		scene.ready(initial, 0);
		const next = state(2, 4); next.players[0].segments[0].y = 2998;
		scene.state(next, 100);
		expect(scene.players(150)[0].segments[0]).toEqual({ x: 1, y: 1 });
		expect(scene.players(200)[0].segments[0]).toEqual({ x: 4, y: 2998 });
	});

	it('projects nearby food and continuous snake bodies across the wrap instead of across the arena', () => {
		expect(wrappedDelta(4, 2998, 3000)).toBe(-6);
		expect(unwrapSegments([{ x: 4, y: 2998 }, { x: 2998, y: 4 }, { x: 2990, y: 12 }], { x: 4, y: 2998 }, { width: 3000, height: 3000 })).toEqual([{ x: 0, y: 0 }, { x: -6, y: 6 }, { x: -14, y: 14 }]);
	});

	it('interpolates positions without inventing scores or resurrecting dead players and rejects old ticks', () => {
		const scene = new SnakeScene();
		scene.ready(ready(), 0);
		scene.state(state(2, 200), 100);
		expect(scene.players(150)[0].segments[0].x).toBe(150);
		expect(scene.players(150)[0].score).toBe(4);
		scene.state(state(1, 900), 200);
		expect(scene.current?.tick).toBe(2);
		const dead = state(3); dead.players[0].alive = false;
		scene.state(dead, 200);
		expect(scene.players(210)).toEqual([]);
	});
});

describe('snake scoped input and mobile controls', () => {
	function setup() {
		const surface = document.createElement('div'); surface.tabIndex = 0;
		const boost = document.createElement('button');
		document.body.append(surface, boost);
		vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, width: 400, height: 400 } as DOMRect);
		surface.setPointerCapture = boost.setPointerCapture = vi.fn();
		return { surface, boost, input: new SnakeControls(surface, boost) };
	}

	function pointer(element: HTMLElement, type: string, extra: Record<string, unknown> = {}): void {
		const event = new Event(type, { bubbles: true, cancelable: true });
		Object.assign(event, { pointerType: 'touch', isPrimary: true, pointerId: 1, button: 0, clientX: 210, clientY: 420 }, extra);
		element.dispatchEvent(event);
	}

	afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

	it('touch steers without boosting, separate held boost works and pointer cancellation releases it', () => {
		const { surface, boost, input } = setup();
		pointer(surface, 'pointerdown');
		expect(input.angle).toBeCloseTo(Math.PI / 2);
		expect(input.boost).toBe(false);
		pointer(boost, 'pointerdown'); expect(input.boost).toBe(true);
		pointer(boost, 'pointercancel'); expect(input.boost).toBe(false);
		input.dispose();
	});

	it('mouse/Space boost is scoped, release and blur stop boost, and at most 20 inputs per second are sent', () => {
		const { surface, input } = setup();
		window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })); expect(input.boost).toBe(false);
		surface.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', cancelable: true })); expect(input.boost).toBe(true);
		surface.dispatchEvent(new Event('blur')); expect(input.boost).toBe(false);
		pointer(surface, 'pointerdown', { pointerType: 'mouse' }); expect(input.boost).toBe(true);
		pointer(surface, 'pointerup'); expect(input.boost).toBe(false);
		const packets = Array.from({ length: 100 }, (_, i) => input.frame(i * 10)).filter(Boolean);
		expect(packets).toHaveLength(20);
		expect(packets[19]?.seq).toBe(20);
		input.dispose();
	});

	it('allows a second finger to steer after boost was pressed first, including replacement steering fingers', () => {
		const { surface, boost, input } = setup();
		pointer(boost, 'pointerdown', { pointerId: 1 });
		pointer(surface, 'pointerdown', { pointerId: 2, isPrimary: false });
		expect(input.angle).toBeCloseTo(Math.PI / 2);
		expect(input.boost).toBe(true);
		pointer(surface, 'pointermove', { pointerId: 3, isPrimary: false, clientX: 410, clientY: 220 });
		expect(input.angle).toBeCloseTo(Math.PI / 2);
		pointer(surface, 'pointerup', { pointerId: 2, isPrimary: false });
		pointer(surface, 'pointerdown', { pointerId: 3, isPrimary: false, clientX: 410, clientY: 220 });
		expect(input.angle).toBe(0);
		expect(input.boost).toBe(true);
		pointer(boost, 'pointerup', { pointerId: 1 });
		expect(input.boost).toBe(false);
		input.dispose();
	});

	it('removes all input handlers when the page releases its surface', () => {
		const { surface, boost, input } = setup();
		input.dispose();
		pointer(surface, 'pointerdown'); pointer(boost, 'pointerdown');
		surface.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
		expect(input.angle).toBe(0);
		expect(input.boost).toBe(false);
	});
});
