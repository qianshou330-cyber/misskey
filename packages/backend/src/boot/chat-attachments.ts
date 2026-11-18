/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import 'reflect-metadata';
import { loadConfig } from '@/config.js';
import { createPostgresDataSource } from '@/postgres.js';
import { MiMeta } from '@/models/Meta.js';
import { IdService } from '@/core/IdService.js';
import { ChatAttachmentStorageService } from '@/core/ChatAttachmentStorageService.js';
import { ChatAttachmentMigrationService } from '@/core/ChatAttachmentMigrationService.js';

const mode = process.argv[2];
if (!['dryrun', 'copy', 'maintenance-cutover'].includes(mode)) {
	console.error('Usage: node built/chat-attachments.js dryrun|copy|maintenance-cutover [--writers-stopped]');
	process.exitCode = 1;
} else {
	// This deliberately does not bootstrap Nest, Redis, timers, daemons or the web server.
	const config = loadConfig();
	const db = createPostgresDataSource(config);
	// The ordinary test factory synchronizes/drops schemas and may open Redis cache
	// connections. None of that is appropriate for an operator's migration command.
	db.setOptions({ synchronize: false, dropSchema: false, cache: false, logging: false, replication: undefined, extra: { ...config.db.extra, max: 1, application_name: 'misskey-chat-migration' } });
	try {
		await db.initialize();
		const meta = await db.getRepository(MiMeta).findOne({ where: {}, order: { id: 'DESC' } });
		if (!meta) throw new Error('Missing instance metadata');
		const migration = new ChatAttachmentMigrationService(db, config, meta, new ChatAttachmentStorageService(config), new IdService(config));
		const summary = await migration.run(mode as 'dryrun' | 'copy' | 'maintenance-cutover', process.argv.includes('--writers-stopped'));
		console.log(JSON.stringify({ mode, ...summary }));
		if (summary.failed > 0) process.exitCode = 1;
	} catch {
		// Do not print connection strings, storage keys or media contents on failure.
		console.error('Chat attachment migration failed. Inspect the migration state with an authorized database administrator.');
		process.exitCode = 1;
	} finally { if (db.isInitialized) await db.destroy(); }
}
