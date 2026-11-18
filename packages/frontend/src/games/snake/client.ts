/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import socketModuleUrl from '/client-assets/snake/socket.io-client-4.8.3.esm.min.js?url';
import { SnakeScene } from './scene.js';
import type { SnakeReady, SnakeSocket, SnakeSocketFactory, SnakeState, SnakeStatus, SnakeTicket, SnakeFoodDelta, SnakeFoodSnapshot, SnakeInput } from './types.js';

export class SnakeClient {
	scene = new SnakeScene();
	status: SnakeStatus = 'idle';
	code = '';
	score = 0;
	maxHumans = 20;
	private socket: SnakeSocket | null = null;
	private abort: AbortController | null = null;
	private generation = 0;
	private timeout: number | null = null;

	constructor(private options: {
		ticket: (signal: AbortSignal) => Promise<SnakeTicket>;
		factory: () => Promise<SnakeSocketFactory>;
		origin: string;
		changed: () => void;
		now?: () => number;
	}) {}

	private now(): number { return this.options.now?.() ?? performance.now(); }
	private changed(status?: SnakeStatus, code = ''): void {
		if (status) this.status = status;
		this.code = code;
		this.options.changed();
	}
	private clearTimeout(): void { if (this.timeout) window.clearTimeout(this.timeout); this.timeout = null; }

	async start(): Promise<void> {
		if (this.status === 'connecting' || this.status === 'playing') return;
		if (this.status === 'dead' && this.socket?.connected) {
			const generation = this.generation;
			this.changed('connecting');
			this.timeout = window.setTimeout(() => this.close('disconnected', 'TIMEOUT'), 10_000);
			this.socket.emit('game:restart', {}, (response: { ok: boolean; code?: string }) => {
				if (generation !== this.generation) return;
				if (!response.ok) { this.clearTimeout(); this.changed('dead', response.code ?? 'RESTART_FAILED'); }
			});
			return;
		}
		this.close('connecting');
		const generation = this.generation;
		const abort = this.abort = new AbortController();
		const valid = (): boolean => generation === this.generation && !abort.signal.aborted;
		this.timeout = window.setTimeout(() => { if (valid()) this.close('error', 'TIMEOUT'); }, 15_000);
		try {
			const [ticket, io] = await Promise.all([this.options.ticket(abort.signal), this.options.factory()]);
			if (!valid()) return;
			if (ticket.socketPath !== '/games/snake/socket.io/' || !ticket.ticket || !Number.isFinite(Date.parse(ticket.expiresAt)) || Date.parse(ticket.expiresAt) <= Date.now()) throw new Error('TICKET_INVALID');
			const socket = this.socket = io(this.options.origin, { path: ticket.socketPath, auth: { ticket: ticket.ticket }, transports: ['websocket'], reconnection: false, autoConnect: false, forceNew: true, timeout: 8000 });
			socket.on('connect', () => { socket.auth = {}; });
			socket.on('game:ready', (ready: SnakeReady) => {
				if (!valid() || ready.v !== 1) return;
				this.clearTimeout();
				this.scene.ready(ready, this.now());
				this.maxHumans = ready.maxHumans;
				this.score = 0;
				this.changed('playing');
			});
			socket.on('game:state', (state: SnakeState) => {
				if (!valid() || !this.scene.selfId) return;
				this.scene.state(state, this.now());
				this.score = this.scene.current?.players.find(player => player.id === this.scene.selfId)?.score ?? this.score;
				this.options.changed();
			});
			socket.on('game:food', (delta: SnakeFoodDelta) => { if (valid() && this.scene.delta(delta)) socket.emit('game:syncFood', {}); });
			socket.on('game:foodSnapshot', (snapshot: SnakeFoodSnapshot) => { if (valid()) this.scene.snapshot(snapshot); });
			socket.on('game:dead', (value: { score: number }) => { if (valid()) { this.score = value.score; this.changed('dead'); } });
			socket.on('disconnect', () => { if (valid()) this.close('disconnected'); });
			socket.on('game:closing', () => { if (valid()) this.close('disconnected'); });
			socket.on('connect_error', (error: { data?: { code?: string } }) => { if (valid()) this.close('error', error.data?.code ?? 'CONNECTION_FAILED'); });
			socket.connect();
		} catch (error) {
			if (valid()) this.close('error', typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : 'CONNECTION_FAILED');
		}
	}

	input(value: SnakeInput): void { if (this.status === 'playing' && this.socket?.connected) this.socket.emit('game:input', value); }
	close(status: SnakeStatus = 'idle', code = ''): void {
		this.generation++;
		this.clearTimeout();
		this.abort?.abort();
		this.abort = null;
		this.socket?.removeAllListeners();
		this.socket?.disconnect();
		this.socket = null;
		this.scene.clear();
		this.changed(status, code);
	}
}

export async function loadSnakeSocket(): Promise<SnakeSocketFactory> {
	// Versioned official MIT bundle, hosted by PUBO. No CDN or account token enters this module.
	const module = await import(/* @vite-ignore */ socketModuleUrl) as { io: SnakeSocketFactory };
	return module.io;
}
