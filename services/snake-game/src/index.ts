/* SPDX-FileCopyrightText: 2026 PUBO contributors
 * SPDX-License-Identifier: MIT */

import { readFileSync, statSync } from 'node:fs';
import { createGameService } from './server.js';

const secretFile = process.env.SNAKE_TICKET_SECRET_FILE;
if (!secretFile) throw new Error('SNAKE_TICKET_SECRET_FILE is required');
const stat = statSync(secretFile);
if (!stat.isFile() || stat.size < 32 || stat.size > 4096) throw new Error('Ticket secret file must contain 32..4096 raw bytes');
if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) throw new Error('Ticket secret file must have mode 0600 or stricter');
const origin = process.env.SNAKE_PUBLIC_ORIGIN;
if (!origin) throw new Error('SNAKE_PUBLIC_ORIGIN is required');
const port = Number(process.env.PORT ?? 3021);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT is invalid');
const service = createGameService({ secret: readFileSync(secretFile), origin, host: process.env.HOST ?? '127.0.0.1', port, maxHumans: Number(process.env.SNAKE_MAX_HUMANS ?? 20) });
await service.listen();
console.log(JSON.stringify({ event: 'ready', port, protocol: 1, bootCutoff: service.metrics().bootCutoff }));
let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => process.exit(1), 10_000); timeout.unref();
  await service.close(); clearTimeout(timeout);
}
process.once('SIGTERM', () => { void stop(); });
process.once('SIGINT', () => { void stop(); });
