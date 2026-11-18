/* SPDX-FileCopyrightText: 2026 PUBO contributors
 * SPDX-License-Identifier: MIT */

import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { Arena, LIMITS, validInput } from '../src/engine.js';
import { signTicket, TicketVerifier } from '../src/ticket.js';
import type { Claims } from '../src/ticket.js';
import { createGameService } from '../src/server.js';
import { SOCKET_PATH } from '../src/protocol.js';
import type { ClientEvents, Ready, ServerEvents } from '../src/protocol.js';

const secret = randomBytes(32);
const origin = 'https://pubo.example';
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function claims(overrides: Partial<Claims> = {}): Claims { return { v: 1, aud: 'pubo-snake', sub: 'test-user', name: '测试用户', jti: randomUUID(), iat: 110, exp: 170, ...overrides }; }
function seeded(): () => number { let seed = 123456; return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; }; }

test('signed tickets are single use and expired replay entries are removed', () => {
  const verifier = new TicketVerifier(secret, 100);
  const ticket = signTicket(claims(), secret);
  assert.equal(verifier.verify(ticket, 111).name, '测试用户');
  assert.throws(() => verifier.verify(ticket, 111), /TICKET_REPLAY/);
  verifier.prune(171); assert.equal(verifier.size, 0);
});

test('ticket verification rejects signatures, expiry, wrong audience, future and preboot timestamps', () => {
  const verifier = new TicketVerifier(secret, 100);
  assert.throws(() => verifier.verify(signTicket(claims(), randomBytes(32)), 111), /TICKET_INVALID/);
  assert.throws(() => verifier.verify(signTicket(claims(), secret), 170), /TICKET_EXPIRED/);
  for (const bad of [claims({ iat: 112 }), claims({ exp: 171 }), claims({ iat: 110.5 }), claims({ jti: 'bad' }), claims({ sub: '' }), claims({ aud: 'other' as Claims['aud'] })]) {
    assert.throws(() => verifier.verify(signTicket(bad, secret), 111), /TICKET_INVALID/);
  }
  assert.throws(() => verifier.verify(signTicket(claims({ iat: 100, exp: 160 }), secret), 111), /TICKET_BEFORE_BOOT/);
  for (const invalid of [null, [], '', 'x.x', 'x'.repeat(2049)]) assert.throws(() => verifier.verify(invalid, 111), /TICKET_INVALID/);
  assert.throws(() => new TicketVerifier(randomBytes(31), 100));
});

test('capacity is configurable only from 1 to 20 and bots adjust as humans enter and leave', () => {
  for (const invalid of [0, 21, 1.5, NaN]) assert.throws(() => new Arena(seeded(), invalid));
  const arena = new Arena(seeded());
  const ids: string[] = [];
  for (let index = 1; index <= 20; index++) {
    ids.push(arena.addHuman(`玩家 ${index}`));
    assert.equal(arena.bots, Math.min(5, Math.max(0, 6 - index)));
  }
  assert.throws(() => arena.addHuman('overflow'), /FULL/);
  ids.forEach(id => arena.removeHuman(id));
  assert.equal(arena.bots, 0); assert.equal(arena.foods.size, 0);
  arena.step(); assert.equal(arena.tick, 0);
  const single = new Arena(seeded(), 1); const id = single.addHuman('one');
  assert.equal(single.ready(id).maxHumans, 1);
  assert.throws(() => single.addHuman('two'), /FULL/);
  assert.ok(single.state().players.filter(player => player.isBot).every(player => player.name.startsWith('电脑 ')));
});

test('only bounded finite ordered inputs affect authoritative movement', () => {
  const arena = new Arena(seeded()); const id = arena.addHuman('<b>名字</b>');
  for (const bad of [null, { seq: 0, angle: NaN, boost: false }, { seq: 0, angle: Infinity, boost: false }, { seq: 0, angle: 1e200, boost: true }, { seq: 1, angle: 0, boost: 'true' }, { seq: -1, angle: 0, boost: true }]) {
    assert.equal(validInput(bad), false); assert.equal(arena.input(id, bad), false);
  }
  assert.equal(arena.input(id, { seq: 1, angle: 0, boost: false }), true);
  assert.equal(arena.input(id, { seq: 1, angle: 1, boost: true }), false);
  const before = { ...arena.players.get(id)!.segments[0]! };
  arena.step();
  const after = arena.players.get(id)!.segments[0]!;
  assert.ok(Math.abs(Math.hypot(after.x - before.x, after.y - before.y) - LIMITS.speed) < 0.01);
  assert.ok(arena.state().players.every(player => player.segments.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))));
});

test('human boost expires after 500 ms without new input', () => {
  const arena = new Arena(seeded()); const id = arena.addHuman('one');
  const player = arena.players.get(id)!;
  arena.input(id, { seq: 1, angle: player.angle, boost: true });
  arena.step(); assert.equal(player.boosting, true);
  for (let index = 0; index < 14; index++) arena.step();
  assert.equal(player.boosting, false); assert.equal(player.input.boost, false);
});

test('food initial snapshot plus ordered deltas exactly reconstruct the bounded live food map', () => {
  const arena = new Arena(seeded()); const id = arena.addHuman('one');
  const copy = new Map(arena.ready(id).foods.map(food => [food.id, food]));
  let version = 0;
  for (let tick = 0; tick < 600; tick++) {
    arena.step();
    const delta = arena.takeFoodDelta();
    if (delta) {
      assert.equal(delta.version, ++version);
      delta.remove.forEach(foodId => copy.delete(foodId)); delta.add.forEach(food => copy.set(food.id, food));
    }
    assert.ok(arena.foods.size <= LIMITS.maxFood);
    assert.ok([...arena.players.values()].every(player => player.segments.length <= LIMITS.maxSegments));
  }
  assert.deepEqual([...copy.keys()].sort(), [...arena.foods.keys()].sort());
});

test('head-on collision kills both once, restart is explicit and living restart is refused', () => {
  const arena = new Arena(seeded()); const ids = Array.from({ length: 6 }, (_, index) => arena.addHuman(`p${index}`));
  const first = arena.players.get(ids[0]!)!; const second = arena.players.get(ids[1]!)!;
  first.segments = Array.from({ length: 10 }, () => ({ x: 1000, y: 1000 }));
  second.segments = Array.from({ length: 10 }, () => ({ x: 1020, y: 1000 }));
  first.angle = 0; first.input.angle = 0; second.angle = Math.PI; second.input.angle = Math.PI;
  assert.equal(arena.restart(first.id), false);
  arena.step();
  assert.equal(first.alive, false); assert.equal(second.alive, false);
  assert.equal(arena.takeDeaths().filter(death => [first.id, second.id].includes(death.id)).length, 2);
  arena.step(); assert.equal(arena.takeDeaths().filter(death => [first.id, second.id].includes(death.id)).length, 0);
  assert.equal(arena.restart(first.id), true); assert.equal(arena.players.get(first.id)!.score, 0);
  const foodCount = arena.foods.size; arena.removeHuman(second.id); assert.equal(arena.foods.size, foodCount);
});

async function fixture(maxHumans = 20) {
  const now = Math.floor(Date.now() / 1000);
  const service = createGameService({ secret, origin, port: 0, bootCutoff: now - 1, maxHumans });
  const port = await service.listen();
  const clients: Socket<ServerEvents, ClientEvents>[] = [];
  function connect(sub: string, ticket?: string, requestedOrigin = origin): Socket<ServerEvents, ClientEvents> {
    const issued = Math.floor(Date.now() / 1000);
    const socket = io(`http://127.0.0.1:${port}`, {
      path: SOCKET_PATH, transports: ['websocket'], reconnection: false,
      extraHeaders: { Origin: requestedOrigin },
      auth: { ticket: ticket ?? signTicket(claims({ sub, iat: issued, exp: issued + 60 }), secret) },
    });
    clients.push(socket); return socket;
  }
  return { service, connect, port, close: async () => { clients.forEach(client => client.disconnect()); await service.close(); } };
}
function ready(socket: Socket<ServerEvents, ClientEvents>): Promise<Ready> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('ready timeout')), 3000);
    socket.once('game:ready', data => { clearTimeout(timeout); resolve(data); });
    socket.once('connect_error', error => { clearTimeout(timeout); reject(error); });
  });
}
function rejected(socket: Socket<ServerEvents, ClientEvents>): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('rejection timeout')), 3000);
    socket.once('connect_error', error => { clearTimeout(timeout); socket.disconnect(); resolve((error as Error & { data?: { code?: string } }).data?.code ?? 'TRANSPORT_REJECTED'); });
  });
}

test('network authentication rejects duplicate account, full room and wrong Origin', async () => {
  const f = await fixture(1);
  try {
    const first = await ready(f.connect('one')); assert.equal(first.maxHumans, 1);
    assert.equal(await rejected(f.connect('one')), 'DUPLICATE');
    assert.equal(await rejected(f.connect('two')), 'FULL');
    assert.equal(await rejected(f.connect('other-origin', undefined, 'https://wrong.example')), 'TRANSPORT_REJECTED');
    assert.equal(f.service.metrics().humans, 1);
  } finally { await f.close(); }
});

test('network tickets reject replay, bad signature and expiry', async () => {
  const f = await fixture();
  try {
    const now = Math.floor(Date.now() / 1000);
    const ticket = signTicket(claims({ sub: 'one', iat: now, exp: now + 60 }), secret);
    await ready(f.connect('one', ticket));
    assert.equal(await rejected(f.connect('other', ticket)), 'TICKET_REPLAY');
    assert.equal(await rejected(f.connect('other', signTicket(claims({ iat: now, exp: now + 60 }), randomBytes(32)))), 'TICKET_INVALID');
    assert.equal(await rejected(f.connect('other', signTicket(claims({ iat: now - 60, exp: now }), secret))), 'TICKET_EXPIRED');
  } finally { await f.close(); }
});

test('network caps input at 20/s, sends 15Hz state and stops when the last player leaves', async () => {
  const f = await fixture();
  try {
    const socket = f.connect('one'); await ready(socket);
    let frames = 0; socket.on('game:state', () => { frames++; });
    for (let seq = 0; seq < 40; seq++) socket.emit('game:input', { seq, angle: 0, boost: false });
    await pause(600);
    assert.ok(f.service.metrics().inputAccepted <= 20);
    assert.ok(f.service.metrics().inputRejected >= 20);
    assert.ok(frames >= 6 && frames <= 11);
    socket.disconnect(); await pause(30);
    assert.equal(f.service.metrics().humans, 0); assert.equal(f.service.metrics().bots, 0); assert.equal(f.service.metrics().running, false);
    const ticks = f.service.metrics().ticksTotal; await pause(80); assert.equal(f.service.metrics().ticksTotal, ticks);
  } finally { await f.close(); }
});

test('restart and food sync use acknowledgements/snapshots and cannot reset an alive player', async () => {
  const f = await fixture();
  try {
    const socket = f.connect('one'); const init = await ready(socket);
    const reply = await new Promise<{ ok: boolean; code?: string }>(resolve => socket.emit('game:restart', {}, resolve));
    assert.deepEqual(reply, { ok: false, code: 'NOT_DEAD' });
    const snapshot = new Promise<number>(resolve => socket.once('game:foodSnapshot', data => resolve(data.foods.length)));
    socket.emit('game:syncFood', {}); assert.ok(await snapshot >= 300);
    assert.ok(f.service.arena.players.get(init.selfId)!.alive);
  } finally { await f.close(); }
});
