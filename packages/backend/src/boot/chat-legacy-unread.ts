/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import pg from 'pg';
import * as Redis from 'ioredis';
import { loadConfig } from '@/config.js';
import { importChatLegacyUnread } from '@/core/chat-legacy-unread-import.js';

const mode = process.argv[2];
if (!['dryrun', 'import'].includes(mode) || (mode === 'import' && !process.argv.includes('--writers-stopped'))) {
	console.error('Usage: node built/chat-legacy-unread.js dryrun|import [--writers-stopped]');
	process.exitCode = 1;
} else {
	let db: pg.Client | undefined;
	let redis: Redis.Redis | undefined;
	try {
		// No Nest context, schema synchronization, migrations, daemons or media access.
		const config = loadConfig();
		db = new pg.Client({ ...config.db.extra, host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.pass, database: config.db.db, application_name: 'misskey-chat-legacy-import', statement_timeout: 10_000 });
		// SCAN returns physical keys. Disable automatic prefixing so GET uses those
		// exact keys; otherwise the prefix would be applied twice.
		redis = new Redis.Redis({ ...config.redis, keyPrefix: '', lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1, retryStrategy: () => null });
		redis.on('error', () => { /* Errors below are deliberately sanitized. */ });
		await db.connect();
		await redis.connect();
		const summary = await importChatLegacyUnread(redis, db, config.redis.keyPrefix ?? '', mode === 'import');
		console.log(JSON.stringify({ mode, ...summary }));
	} catch {
		console.error('Chat legacy unread import failed. No Redis messages or keys have been modified.');
		process.exitCode = 1;
	} finally {
		redis?.disconnect();
		await db?.end().catch(() => {});
	}
}
