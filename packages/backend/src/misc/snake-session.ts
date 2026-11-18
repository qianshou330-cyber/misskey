/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHmac, randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { Config } from '@/config.js';
import type { MiLocalUser } from '@/models/User.js';

async function readBoundedFile(path: string | undefined, minimum: number, maximum: number): Promise<Buffer | null> {
	if (typeof path !== 'string' || !isAbsolute(path)) return null;
	try {
		const file = await open(path, 'r');
		try {
			const stat = await file.stat();
			if (!stat.isFile() || stat.size < minimum || stat.size > maximum) return null;
			const data = Buffer.alloc(maximum + 1);
			let length = 0;
			while (length < data.length) {
				const { bytesRead } = await file.read(data, length, data.length - length, length);
				if (bytesRead === 0) break;
				length += bytesRead;
			}
			return length >= minimum && length <= maximum ? data.subarray(0, length) : null;
		} finally {
			await file.close();
		}
	} catch {
		// Missing, invalid or unreadable configuration disables the feature silently.
		return null;
	}
}

/** Read raw bytes, without trimming/decoding; never expose paths or file errors. */
export async function readSnakeTicketSecret(config: Pick<Config, 'snakeGame'>): Promise<Buffer | null> {
	const game = config.snakeGame;
	if (game?.enabled !== true) return null;
	if (game.enabledFile !== undefined) {
		const gate = await readBoundedFile(game.enabledFile, 8, 8);
		if (!gate?.equals(Buffer.from('enabled\n'))) return null;
	}
	return readBoundedFile(game.ticketSecretFile, 32, 4096);
}

export async function isSnakeGameEnabled(config: Pick<Config, 'snakeGame'>): Promise<boolean> {
	return await readSnakeTicketSecret(config) !== null;
}

/** Authentication and account restrictions are enforced by ApiCallService. */
export async function issueSnakeSession(config: Pick<Config, 'snakeGame'>, user: Pick<MiLocalUser, 'id' | 'name' | 'username'>) {
	const secret = await readSnakeTicketSecret(config);
	if (secret === null) return null;
	const iat = Math.floor(Date.now() / 1000);
	const claims = {
		v: 1,
		aud: 'pubo-snake',
		sub: user.id,
		name: user.name || user.username,
		jti: randomUUID(),
		iat,
		exp: iat + 60,
	};
	const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
	const signature = createHmac('sha256', secret).update(payload).digest('base64url');
	return {
		ticket: `${payload}.${signature}`,
		expiresAt: new Date(claims.exp * 1000).toISOString(),
		socketPath: '/games/snake/socket.io/' as const,
	};
}
