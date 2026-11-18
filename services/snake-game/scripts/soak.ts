/* SPDX-FileCopyrightText: 2026 PUBO contributors
 * SPDX-License-Identifier: MIT */

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { SOCKET_PATH } from '../src/protocol.js';
import type { ClientEvents, ServerEvents, State } from '../src/protocol.js';
import { signTicket } from '../src/ticket.js';

// This harness uses isolated service tickets only. Never point it at the public game.
if (process.env.SNAKE_SOAK_ISOLATED !== '1') throw new Error('Set SNAKE_SOAK_ISOLATED=1 for an isolated, non-public service');
const base = process.env.SNAKE_SOAK_URL ?? 'http://127.0.0.1:3021';
const origin = process.env.SNAKE_PUBLIC_ORIGIN ?? 'https://bolubo.com';
const secretFile = process.env.SNAKE_TICKET_SECRET_FILE;
const output = process.env.SNAKE_SOAK_OUTPUT;
if (!secretFile || !output) throw new Error('Restricted secret file and unique SNAKE_SOAK_OUTPUT are required');
const secret = readFileSync(secretFile);
const duration = Number(process.env.SNAKE_SOAK_SECONDS ?? 1800);
const humans = Number(process.env.SNAKE_SOAK_HUMANS ?? 20);
if (!Number.isInteger(duration) || duration < 5 || !Number.isInteger(humans) || humans < 1 || humans > 20) throw new Error('Invalid soak parameters');
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const getMetrics = async (): Promise<Record<string, number | boolean>> => {
  const response = await fetch(`${base}/metrics`, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error('Metrics request failed');
  return response.json() as Promise<Record<string, number | boolean>>;
};
let initial = await getMetrics();
while (Math.floor(Date.now() / 1000) <= Number(initial.bootCutoff)) await pause(200);
const clients: Socket<ServerEvents, ClientEvents>[] = [];
const sequences = Array.from({ length: humans }, () => 0);
const latest: (State | null)[] = Array.from({ length: humans }, () => null);
const ids: string[] = [];
let frames = 0;
const clientFrames = Array.from({ length: humans }, () => 0);
let deaths = 0;
let restarts = 0;
let disconnects = 0;
let receivedBytes = 0;
let foodGaps = 0;
let ended = false;
const problems: string[] = [];
const restartTimers = new Set<NodeJS.Timeout>();
const born = Date.now();

try {
  for (let index = 0; index < humans; index++) {
    const now = Math.floor(Date.now() / 1000);
    const ticket = signTicket({ v: 1, aud: 'pubo-snake', sub: `soak-${index}`, name: `隔离压测 ${index + 1}`, jti: randomUUID(), iat: now, exp: now + 60 }, secret);
    const socket: Socket<ServerEvents, ClientEvents> = io(base, { path: SOCKET_PATH, auth: { ticket }, transports: ['websocket'], reconnection: false, extraHeaders: { Origin: origin } });
    clients.push(socket);
    let foodVersion = -1;
    socket.onAny((_event, data) => { if (data) receivedBytes += Buffer.byteLength(JSON.stringify(data)); });
    socket.on('game:state', state => { latest[index] = state; frames++; clientFrames[index] = clientFrames[index]! + 1; });
    socket.on('game:food', delta => {
      if (delta.version !== foodVersion + 1) { foodGaps++; socket.emit('game:syncFood', {}); }
      foodVersion = delta.version;
    });
    socket.on('game:foodSnapshot', snapshot => { foodVersion = snapshot.version; });
    socket.on('game:ready', ready => { ids[index] = ready.selfId; foodVersion = ready.foodVersion; latest[index] = ready.state; });
    socket.on('game:dead', () => {
      deaths++;
      const timer = setTimeout(() => {
        restartTimers.delete(timer);
        if (!ended) socket.emit('game:restart', {}, result => { if (result.ok) restarts++; else problems.push(`restart:${result.code}`); });
      }, 2100);
      restartTimers.add(timer);
    });
    socket.on('disconnect', () => { if (!ended) disconnects++; });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Join timed out')), 10_000);
      socket.once('game:ready', () => { clearTimeout(timeout); resolve(); });
      socket.once('connect_error', error => { clearTimeout(timeout); reject(error); });
    });
  }
  initial = await getMetrics();
  const start = Date.now();
  const inputs = setInterval(() => {
    clients.forEach((socket, index) => {
      const state = latest[index];
      const self = state?.players.find(player => player.id === ids[index]);
      if (!self?.alive) return;
      const head = self.segments[0]!;
      let angle = Math.sin((Date.now() - born) / 4000 + index) * Math.PI;
      const threat = state!.players.find(player => player.id !== self.id && player.alive && player.segments.some(point => Math.hypot(point.x - head.x, point.y - head.y) < 120));
      if (threat) angle = Math.atan2(head.y - threat.segments[0]!.y, head.x - threat.segments[0]!.x);
      socket.emit('game:input', { seq: ++sequences[index]!, angle, boost: Math.floor(Date.now() / 5000 + index) % 7 === 0 });
    });
  }, 50);
  const samples: Record<string, number | boolean>[] = [];
  try {
    while (Date.now() - start < duration * 1000) {
      await pause(Math.min(5000, duration * 1000 - (Date.now() - start)));
      const sample = await getMetrics();
      samples.push({ at: Date.now(), ...sample });
      if (sample.humans !== humans || sample.bots !== Math.min(5, Math.max(0, 6 - humans))) problems.push('population mismatch');
      if (Number(sample.rssBytes) >= 512 * 1024 * 1024 || Number(sample.tickP95Ms) >= 1000 / 30) problems.push('resource threshold');
      if (Number(sample.foods) > 360 || Number(sample.largestSnake) > 160) problems.push('arena bound exceeded');
      if (samples.length % 12 === 0) console.log(JSON.stringify({ event: 'soak-progress', elapsedSeconds: Math.round((Date.now() - start) / 1000), humans: sample.humans, tickP95Ms: sample.tickP95Ms, rssBytes: sample.rssBytes }));
    }
  } finally { clearInterval(inputs); }
  const final = await getMetrics();
  const elapsedSeconds = (Date.now() - start) / 1000;
  const tickRate = (Number(final.ticksTotal) - Number(initial.ticksTotal)) / elapsedSeconds;
  const stateRate = (Number(final.stateFrames) - Number(initial.stateFrames)) / elapsedSeconds;
  const cpuCores = (Number(final.cpuUserMs) + Number(final.cpuSystemMs) - Number(initial.cpuUserMs) - Number(initial.cpuSystemMs)) / (elapsedSeconds * 1000);
  const receivedRates = clientFrames.map(count => count / elapsedSeconds);
  if (tickRate < 27 || stateRate < 13 || Math.min(...receivedRates) < 13 || cpuCores > 1.05 || disconnects || foodGaps) problems.push('rate/connection threshold');
  const warmSamples = samples.filter(sample => Number(sample.at) >= start + 300_000);
  const median = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.length % 2 ? sorted[Math.floor(sorted.length / 2)]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
  };
  const trend = (field: string) => {
    if (warmSamples.length < 120) return { observed: false };
    const first = warmSamples.filter(sample => Number(sample.at) <= Number(warmSamples[0]!.at) + 300_000).map(sample => Number(sample[field]) / 1048576);
    const last = warmSamples.filter(sample => Number(sample.at) >= Number(warmSamples.at(-1)!.at) - 300_000).map(sample => Number(sample[field]) / 1048576);
    const x = warmSamples.map(sample => (Number(sample.at) - start) / 60_000);
    const y = warmSamples.map(sample => Number(sample[field]) / 1048576);
    const meanX = x.reduce((sum, value) => sum + value, 0) / x.length;
    const meanY = y.reduce((sum, value) => sum + value, 0) / y.length;
    const slope = x.reduce((sum, value, index) => sum + (value - meanX) * (y[index]! - meanY), 0) / x.reduce((sum, value) => sum + (value - meanX) ** 2, 0);
    return { observed: true, firstFiveMinuteMedianMiB: median(first), lastFiveMinuteMedianMiB: median(last), deltaMiB: median(last) - median(first), slopeMiBPerMinute: slope };
  };
  const memoryTrend = { warmupSeconds: 300, rss: trend('rssBytes'), heap: trend('heapUsedBytes') };
  if (memoryTrend.rss.observed && (memoryTrend.rss.deltaMiB! > 32 || memoryTrend.rss.slopeMiBPerMinute! > 0.5)) problems.push('sustained RSS growth');
  ended = true;
  clients.forEach(socket => socket.disconnect());
  await pause(150);
  const empty = await getMetrics();
  if (empty.humans !== 0 || empty.bots !== 0 || empty.running !== false) problems.push('empty-room loop retained');
  const result = {
    status: problems.length ? 'FAIL' : 'PASS', isolated: true, requestedSeconds: duration, elapsedSeconds,
    sustainedThirtyMinutes: duration >= 1800 && elapsedSeconds >= 1800, humans, tickRate, stateRate, cpuCores,
    frames, receivedRates, deaths, restarts, disconnects, foodGaps, receivedBytes, memoryTrend, problems: [...new Set(problems)], initial, final, empty, samples,
  };
  writeFileSync(output, JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ event: 'soak-complete', status: result.status, elapsedSeconds, tickRate, stateRate, cpuCores, output }));
  if (problems.length) process.exitCode = 1;
} catch (error) {
  ended = true;
  writeFileSync(output, JSON.stringify({ status: 'FAIL', message: error instanceof Error ? error.message : 'Soak failed', disconnected: disconnects, partial: true }, null, 2), { flag: 'wx', mode: 0o600 });
  throw error;
} finally {
  ended = true;
  restartTimers.forEach(timer => clearTimeout(timer));
  clients.forEach(socket => socket.disconnect());
}
