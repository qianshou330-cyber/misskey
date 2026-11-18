/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';

export class ChatStorageUnavailableError extends Error {}

@Injectable()
export class ChatAttachmentStorageService {
	public readonly directory: string;
	private readonly forbidden: string[];
	private readonly configured: boolean;

	constructor(@Inject(DI.config) config: Config) {
		const configured = process.env.MISSKEY_CHAT_STORAGE_PATH?.trim();
		this.configured = configured != null && path.isAbsolute(configured);
		this.directory = path.resolve(configured ?? path.join(config.rootDir, 'chat-private'));
		this.forbidden = [path.join(config.rootDir, 'files'), path.join(config.rootDir, 'built'), path.join(config.rootDir, 'verification-private')];
		if (process.env.MISSKEY_VERIFICATION_STORAGE_PATH) this.forbidden.push(path.resolve(process.env.MISSKEY_VERIFICATION_STORAGE_PATH));
	}

	public async ensure(): Promise<void> {
		if (process.env.NODE_ENV === 'production' && !this.configured) throw new ChatStorageUnavailableError('An independent absolute Chat private storage path is required');
		for (const forbidden of this.forbidden) {
			const relative = path.relative(path.resolve(forbidden), this.directory);
			if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) throw new ChatStorageUnavailableError('Chat storage cannot be inside public or verification storage');
		}
		await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
		const actual = await fs.realpath(this.directory);
		const normalize = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
		if (normalize(path.resolve(actual)) !== normalize(this.directory)) throw new ChatStorageUnavailableError('Chat private storage must not be a symlink');
		await fs.chmod(this.directory, 0o700);
	}

	public pathFor(key: string, variant: 'original' | 'preview'): string {
		if (!/^[a-f0-9]{48}$/.test(key)) throw new Error('Invalid Chat storage key');
		return path.join(this.directory, `${key}.${variant}`);
	}

	public async hash(source: string): Promise<string> {
		const hash = createHash('sha256');
		for await (const chunk of createReadStream(source)) hash.update(chunk);
		return hash.digest('hex');
	}

	public async store(source: string, preview?: Buffer): Promise<{ key: string; sha256: string; size: number; previewSize: number }> {
		await this.ensure();
		const key = randomBytes(24).toString('hex');
		const destination = this.pathFor(key, 'original');
		const temporary = `${destination}.tmp`;
		try {
			await fs.copyFile(source, temporary, fs.constants.COPYFILE_EXCL);
			await fs.chmod(temporary, 0o600);
			const sha256 = await this.hash(temporary);
			const { size } = await fs.stat(temporary);
			if (preview) await fs.writeFile(this.pathFor(key, 'preview'), preview, { mode: 0o600, flag: 'wx' });
			await fs.rename(temporary, destination);
			return { key, sha256, size, previewSize: preview?.length ?? 0 };
		} catch (error) {
			await this.delete(key);
			throw error;
		} finally {
			await fs.rm(temporary, { force: true });
		}
	}

	public async delete(key: string): Promise<void> {
		await Promise.all((['original', 'preview'] as const).map(variant => fs.rm(this.pathFor(key, variant), { force: true })));
	}

	public async oldKeys(cutoff: Date): Promise<string[]> {
		await this.ensure();
		const names = await fs.readdir(this.directory);
		const keys = new Set<string>();
		for (const name of names) {
			const match = /^([a-f0-9]{48})\.(original|preview)(\.tmp)?$/.exec(name);
			if (!match) continue;
			const stat = await fs.stat(path.join(this.directory, name));
			if (stat.mtime < cutoff) {
				if (match[3]) await fs.rm(path.join(this.directory, name), { force: true });
				else keys.add(match[1]);
			}
		}
		return [...keys];
	}
}
