/* SPDX-FileCopyrightText: 2026 PUBO contributors
 * SPDX-License-Identifier: MIT */

import { createServer } from 'node:http';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { Server } from 'socket.io';
import type { Socket } from 'socket.io';
import { Arena, LIMITS, validInput } from './engine.js';
import { TicketError, TicketVerifier } from './ticket.js';
import { MAX_HUMANS, SOCKET_PATH } from './protocol.js';
import type { Claims } from './ticket.js';
import type { ClientEvents, ServerEvents } from './protocol.js';

type Data = { claims: Claims; playerId: string };
type GameSocket = Socket<ClientEvents, ServerEvents, Record<string, never>, Data>;
export type Options = { secret: Buffer; origin: string; host?: string; port?: number; bootCutoff?: number; maxHumans?: number };

class RateLimit {
  private times: number[] = [];
  constructor(private readonly count: number, private readonly interval: number) {}
  allow(now = performance.now()): boolean {
    this.times = this.times.filter(time => now - time < this.interval);
    if (this.times.length >= this.count) return false;
    this.times.push(now); return true;
  }
}

export function createGameService(options: Options) {
  const url = new URL(options.origin);
  if (url.origin !== options.origin || !['https:', 'http:'].includes(url.protocol)) throw new Error('SNAKE_PUBLIC_ORIGIN must be an exact HTTP(S) origin');
  const started = Date.now();
  const bootCutoff = options.bootCutoff ?? Math.floor(started / 1000);
  const verifier = new TicketVerifier(options.secret, bootCutoff);
  const arena = new Arena(Math.random, options.maxHumans ?? MAX_HUMANS);
  const accounts = new Map<string, string>();
  const sockets = new Map<string, GameSocket>();
  const blockedSince = new WeakMap<GameSocket, number>();
  let closing = false;
  let loop: NodeJS.Timeout | null = null;
  let maxTickMs = 0;
  let inputAccepted = 0;
  let inputRejected = 0;
  let stateFrames = 0;
  let stateBytes = 0;
  let ticksTotal = 0;
  let metricIndex = 0;
  const tickDurations: number[] = [];
  const eventLoop = monitorEventLoopDelay({ resolution: 20 });
  eventLoop.enable();
  const cpuStart = process.cpuUsage();
  const metrics = () => {
    const sorted = [...tickDurations].sort((a, b) => a - b);
    const cpu = process.cpuUsage(cpuStart);
    return {
      ok: !closing, protocol: 1, uptimeMs: Date.now() - started, bootCutoff,
      humans: arena.humans, bots: arena.bots, maxHumans: arena.maxHumans, running: loop !== null,
      tick: arena.tick, ticksTotal, tickP95Ms: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0,
      maxTickMs, eventLoopP95Ms: eventLoop.percentile(95) / 1e6,
      rssBytes: process.memoryUsage().rss, heapUsedBytes: process.memoryUsage().heapUsed,
      cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000,
      inputAccepted, inputRejected, stateFrames, stateBytes, foods: arena.foods.size,
      maxFood: LIMITS.maxFood, maxSegments: LIMITS.maxSegments,
      largestSnake: Math.max(0, ...[...arena.players.values()].map(player => player.segments.length)),
      ticketReplayEntries: verifier.size,
    };
  };
  const http = createServer((request, response) => {
    if (request.method !== 'GET' || !['/health', '/metrics'].includes(request.url ?? '')) {
      response.writeHead(404).end(); return;
    }
    response.writeHead(closing ? 503 : 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(metrics()));
  });
  const io = new Server<ClientEvents, ServerEvents, Record<string, never>, Data>(http, {
    path: SOCKET_PATH,
    serveClient: false,
    transports: ['websocket'],
    maxHttpBufferSize: 4096,
    connectTimeout: 5000,
    pingInterval: 10_000,
    pingTimeout: 10_000,
    perMessageDeflate: false,
    cors: { origin: options.origin, methods: ['GET', 'POST'], credentials: false },
    allowRequest: (request, callback) => callback(null, !closing && request.headers.origin === options.origin && io.engine.clientsCount < 64),
  });

  io.use((socket, next) => {
    try {
      if (closing) throw new TicketError('CLOSING');
      if (socket.handshake.headers.origin !== options.origin) throw new TicketError('ORIGIN_REJECTED');
      const claims = verifier.verify(socket.handshake.auth.ticket);
      if (accounts.has(claims.sub)) throw new TicketError('DUPLICATE');
      if (accounts.size >= arena.maxHumans) throw new TicketError('FULL');
      socket.data.claims = claims;
      accounts.set(claims.sub, socket.id);
      socket.conn.once('close', () => { if (accounts.get(claims.sub) === socket.id) accounts.delete(claims.sub); });
      next();
    } catch (error) {
      const failure = new Error('Game connection rejected') as Error & { data: { code: string } };
      failure.data = { code: error instanceof TicketError ? error.code : 'TICKET_INVALID' };
      next(failure);
    }
  });

  const publish = (): void => {
    for (const socket of sockets.values()) {
      // Reliable food updates must not accumulate indefinitely on a slow or disconnected reader.
      if (!socket.conn.transport.writable) {
        const blocked = blockedSince.get(socket) ?? performance.now();
        blockedSince.set(socket, blocked);
        if (performance.now() - blocked > 5000) socket.disconnect(true);
      } else blockedSince.delete(socket);
    }
    const state = arena.state();
    stateFrames++;
    stateBytes += Buffer.byteLength(JSON.stringify(state)) * sockets.size;
    io.volatile.emit('game:state', state);
    // Emit the volatile frame first: a reliable packet can temporarily mark the transport unwritable.
    const food = arena.takeFoodDelta();
    if (food) io.emit('game:food', food);
  };

  const stopLoop = (): void => { if (loop) clearInterval(loop); loop = null; };
  const ensureLoop = (): void => {
    if (loop || arena.humans === 0 || closing) return;
    loop = setInterval(() => {
      const before = performance.now();
      arena.step(); ticksTotal++;
      for (const death of arena.takeDeaths()) sockets.get(death.id)?.emit('game:dead', death.data);
      if (arena.tick % 2 === 0) publish();
      const elapsed = performance.now() - before;
      maxTickMs = Math.max(maxTickMs, elapsed);
      tickDurations[metricIndex++ % 9000] = elapsed;
    }, 1000 / 30);
  };

  io.on('connection', socket => {
    const id = arena.addHuman(socket.data.claims.name);
    socket.data.playerId = id;
    sockets.set(id, socket);
    const inputLimit = new RateLimit(20, 1000);
    const restartLimit = new RateLimit(1, 2000);
    const syncLimit = new RateLimit(1, 2000);
    const abuseLimit = new RateLimit(100, 1000);
    socket.emit('game:ready', arena.ready(id));
    ensureLoop();
    socket.on('game:input', input => {
      if (!inputLimit.allow() || !validInput(input)) {
        inputRejected++;
        if (!abuseLimit.allow()) socket.disconnect(true);
        return;
      }
      if (arena.input(id, input)) inputAccepted++;
      else inputRejected++;
    });
    socket.on('game:restart', (_data, ack) => {
      const reply = typeof ack === 'function' ? ack : () => undefined;
      if (!restartLimit.allow()) { reply({ ok: false, code: 'RATE_LIMITED' }); return; }
      if (!arena.restart(id)) { reply({ ok: false, code: 'NOT_DEAD' }); return; }
      socket.emit('game:ready', arena.ready(id));
      reply({ ok: true });
    });
    socket.on('game:syncFood', () => {
      if (!syncLimit.allow()) return;
      socket.emit('game:foodSnapshot', { version: arena.foodVersion, foods: [...arena.foods.values()] });
    });
    socket.on('disconnect', () => {
      sockets.delete(id);
      if (accounts.get(socket.data.claims.sub) === socket.id) accounts.delete(socket.data.claims.sub);
      arena.removeHuman(id);
      if (arena.humans === 0) stopLoop();
    });
  });

  return {
    arena, metrics, verifier,
    listen: () => new Promise<number>((resolve, reject) => {
      http.once('error', reject);
      http.listen(options.port ?? 3021, options.host ?? '127.0.0.1', () => {
        http.off('error', reject);
        const address = http.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    }),
    close: async (): Promise<void> => {
      closing = true; stopLoop(); eventLoop.disable();
      io.emit('game:closing'); io.disconnectSockets(true);
      await new Promise<void>(resolve => io.close(() => resolve()));
      accounts.clear(); sockets.clear();
    },
  };
}
