/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Config } from '@/config.js';
import { DI } from '@/di-symbols.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const execFileAsync = promisify(execFile);

export class VerificationFileRejectedError extends Error {}
export class VerificationScannerUnavailableError extends Error {}

@Injectable()
export class VerificationStorageService implements OnModuleInit {
	private readonly directory: string;

	constructor(@Inject(DI.config) config: Config) {
		const configuredDirectory = process.env.MISSKEY_VERIFICATION_STORAGE_PATH?.trim();
		if (process.env.NODE_ENV === 'production' && (configuredDirectory == null || !path.isAbsolute(configuredDirectory))) {
			throw new Error('MISSKEY_VERIFICATION_STORAGE_PATH must be an absolute path on a persistent private volume in production');
		}
		this.directory = path.resolve(configuredDirectory ?? path.join(config.rootDir, 'verification-private'));
	}

	public async onModuleInit(): Promise<void> {
		this.key();
		await this.ensureDirectory();
	}

	private async ensureDirectory(): Promise<void> {
		await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
		await fs.chmod(this.directory, 0o700);
	}

	private key(): Buffer {
		const value = process.env.MISSKEY_VERIFICATION_ENCRYPTION_KEY;
		if (!value) throw new Error('Verification storage encryption key is not configured');
		const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64');
		if (key.length !== 32) throw new Error('MISSKEY_VERIFICATION_ENCRYPTION_KEY must be 32 bytes');
		return key;
	}

	private filePath(storageKey: string): string {
		if (!/^[a-zA-Z0-9_-]{32,128}$/.test(storageKey)) throw new Error('Invalid verification storage key');
		return path.join(this.directory, `${storageKey}.enc`);
	}

	public async scan(sourcePath: string): Promise<void> {
		const scanner = process.env.MISSKEY_VERIFICATION_SCANNER_PATH ?? 'clamscan';
		try {
			await execFileAsync(scanner, ['--no-summary', sourcePath], { timeout: 30_000, windowsHide: true, maxBuffer: 1024 * 1024 });
		} catch (error) {
			if ((error as { code?: number }).code === 1) throw new VerificationFileRejectedError('Verification file failed malware scan');
			throw new VerificationScannerUnavailableError('Verification malware scanner is unavailable');
		}
	}

	public async store(storageKey: string, sourcePath: string): Promise<{ sha256: string; size: number }> {
		const key = this.key();
		const data = await fs.readFile(sourcePath);
		if (data.length === 0 || data.length > MAX_FILE_SIZE) throw new Error('Verification file size is invalid');

		const nonce = randomBytes(12);
		const cipher = createCipheriv('aes-256-gcm', key, nonce);
		const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
		const tag = cipher.getAuthTag();
		await this.ensureDirectory();
		const destination = this.filePath(storageKey);
		const temporary = `${destination}.${randomBytes(8).toString('hex')}.tmp`;
		try {
			await fs.writeFile(temporary, Buffer.concat([nonce, tag, ciphertext]), { mode: 0o600 });
			await fs.rename(temporary, destination);
		} finally {
			await fs.rm(temporary, { force: true });
		}

		return { sha256: createHash('sha256').update(data).digest('hex'), size: data.length };
	}

	public async read(storageKey: string): Promise<Buffer> {
		const key = this.key();
		await this.ensureDirectory();
		const data = await fs.readFile(this.filePath(storageKey));
		if (data.length < 28) throw new Error('Invalid verification file');
		const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
		decipher.setAuthTag(data.subarray(12, 28));
		return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]);
	}

	public async delete(storageKey: string): Promise<void> {
		await this.ensureDirectory();
		await fs.rm(this.filePath(storageKey), { force: true, maxRetries: 3, retryDelay: 250 });
	}

	public async listStoredKeysOlderThan(cutoff: Date): Promise<string[]> {
		await this.ensureDirectory();
		const entries = await fs.readdir(this.directory, { withFileTypes: true }).catch(error => {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
			throw error;
		});
		const keys: string[] = [];
		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.endsWith('.enc')) continue;
			const key = entry.name.slice(0, -4);
			if (!/^[a-zA-Z0-9_-]{32,128}$/.test(key)) continue;
			const stat = await fs.stat(this.filePath(key));
			if (stat.mtime < cutoff) keys.push(key);
		}
		return keys;
	}
}
