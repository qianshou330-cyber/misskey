/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import 'reflect-metadata';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '@/config.js';
import { ChatAttachmentStorageService } from './ChatAttachmentStorageService.js';

describe('independent private Chat storage', () => {
	const directories: string[] = [];
	afterEach(async () => { vi.unstubAllEnvs(); for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });
	it('stores immutable original and preview outside public Drive, verifies bytes and deletes both', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-storage-test-')); directories.push(root);
		vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('MISSKEY_CHAT_STORAGE_PATH', path.join(root, 'private'));
		const storage = new ChatAttachmentStorageService({ rootDir: root } as Config);
		const source = path.join(root, 'upload'); await fs.writeFile(source, 'secret audio bytes');
		const stored = await storage.store(source, Buffer.from('thumbnail'));
		expect(stored.size).toBe(18);
		expect(stored.previewSize).toBe(9);
		expect(stored.sha256).toHaveLength(64);
		expect(await storage.hash(storage.pathFor(stored.key, 'original'))).toBe(stored.sha256);
		expect(await fs.readFile(storage.pathFor(stored.key, 'preview'), 'utf8')).toBe('thumbnail');
		await storage.delete(stored.key);
		await expect(fs.stat(storage.pathFor(stored.key, 'original'))).rejects.toMatchObject({ code: 'ENOENT' });
		await expect(fs.stat(storage.pathFor(stored.key, 'preview'))).rejects.toMatchObject({ code: 'ENOENT' });
	});
	it('refuses public Drive and verification directories and path traversal', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-storage-test-')); directories.push(root);
		vi.stubEnv('NODE_ENV', 'test');
		for (const directory of ['files', 'files/nested', 'built', 'verification-private']) {
			vi.stubEnv('MISSKEY_CHAT_STORAGE_PATH', path.join(root, directory));
			const storage = new ChatAttachmentStorageService({ rootDir: root } as Config);
			await expect(storage.ensure()).rejects.toThrow('cannot be inside');
			expect(() => storage.pathFor('../key', 'original')).toThrow();
		}
	});
	it('requires an explicit absolute persistent production path', async () => {
		vi.stubEnv('NODE_ENV', 'production');
		for (const directory of ['', 'relative-chat-storage']) {
			vi.stubEnv('MISSKEY_CHAT_STORAGE_PATH', directory);
			const storage = new ChatAttachmentStorageService({ rootDir: os.tmpdir() } as Config);
			await expect(storage.ensure()).rejects.toThrow('absolute');
		}
	});
	 it('refuses the configured verification root and symlink aliases', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-storage-test-')); directories.push(root);
		vi.stubEnv('NODE_ENV', 'test');
		vi.stubEnv('MISSKEY_VERIFICATION_STORAGE_PATH', path.join(root, 'identity-documents'));
		vi.stubEnv('MISSKEY_CHAT_STORAGE_PATH', path.join(root, 'identity-documents', 'nested'));
		await expect(new ChatAttachmentStorageService({ rootDir: root } as Config).ensure()).rejects.toThrow('cannot be inside');
		const target = path.join(root, 'target'), alias = path.join(root, 'alias');
		await fs.mkdir(target);
		await fs.symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
		vi.stubEnv('MISSKEY_CHAT_STORAGE_PATH', alias);
		await expect(new ChatAttachmentStorageService({ rootDir: root } as Config).ensure()).rejects.toThrow('symlink');
	});
});
