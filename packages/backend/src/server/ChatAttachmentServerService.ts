/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { MiUser } from '@/models/User.js';
import { MiAccessToken } from '@/models/AccessToken.js';
import { MiApp } from '@/models/App.js';
import { ChatAttachmentService } from '@/core/ChatAttachmentService.js';
import { ChatAttachmentStorageService } from '@/core/ChatAttachmentStorageService.js';
import { AuthenticateService } from '@/server/api/AuthenticateService.js';
import { contentDisposition } from '@/misc/content-disposition.js';
import { bindThis } from '@/decorators.js';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

export function parseChatRange(value: string | undefined, size: number): { start: number; end: number } | null {
	if (value == null) return null;
	const match = /^bytes=(\d*)-(\d*)$/.exec(value);
	if (!match || (!match[1] && !match[2]) || size < 1) throw new Error('Invalid range');
	const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
	let end = match[1] && match[2] ? Number(match[2]) : size - 1;
	if ((!match[1] && Number(match[2]) === 0) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) throw new Error('Invalid range');
	end = Math.min(end, size - 1);
	return { start, end };
}

@Injectable()
export class ChatAttachmentServerService {
	constructor(@Inject(DI.db) private db: DataSource, private authenticate: AuthenticateService, private attachments: ChatAttachmentService, private storage: ChatAttachmentStorageService) {}

	@bindThis
	public createServer(fastify: FastifyInstance, _options: FastifyPluginOptions, done: (err?: Error) => void): void {
		fastify.route<{ Params: { id: string; variant: string } }>({
			method: ['GET', 'HEAD'], url: '/api/chat/attachments/:id/:variant',
			handler: async (request, reply) => {
				reply.header('Cache-Control', 'private, no-store');
				reply.header('Vary', 'Authorization');
				reply.header('X-Content-Type-Options', 'nosniff');
				reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
				reply.header('Referrer-Policy', 'no-referrer');
				const authorization = request.headers.authorization;
				if (!authorization?.startsWith('Bearer ') || request.raw.url?.includes('?')) return reply.code(401).send();
				try {
					const [authenticated, token] = await this.authenticate.authenticate(authorization.slice(7));
					if (!authenticated) return reply.code(403).send();
					if (token) {
						// App permissions in AuthenticateService may be cached. Private media
						// checks the current token and current app permissions for each range.
						const current = await this.db.getRepository(MiAccessToken).findOneBy({ id: token.id, userId: authenticated.id });
						if (!current) return reply.code(403).send();
						const permissions = current.appId ? (await this.db.getRepository(MiApp).findOneBy({ id: current.appId }))?.permission : current.permission;
						if (!permissions?.includes('read:chat')) return reply.code(403).send();
					}
					const user = await this.db.getRepository(MiUser).findOneBy({ id: authenticated.id });
					if (!user || user.host !== null || user.isSuspended || user.isDeleted) return reply.code(403).send();
					// Native-token authentication is cached by Misskey. Recheck the row so
					// token rotation cannot serve private bytes during cache invalidation lag.
					if (!token && user.token !== authorization.slice(7)) return reply.code(403).send();
					if (!/^[a-zA-Z0-9]{1,32}$/.test(request.params.id) || !['original', 'preview', 'download'].includes(request.params.variant)) return reply.code(404).send();
					const { attachment, blob } = await this.attachments.authorizedAttachment(user.id, request.params.id);
					const preview = request.params.variant === 'preview';
					if (preview && blob.previewSize === 0) return reply.code(404).send();
					const source = this.storage.pathFor(blob.storageKey, preview ? 'preview' : 'original');
					const { size } = await fs.stat(source);
					if (size !== (preview ? blob.previewSize : blob.size)) return reply.code(404).send();
					let range: { start: number; end: number } | null;
					try { range = parseChatRange(request.headers.range, size); } catch { return reply.header('Content-Range', `bytes */${size}`).code(416).send(); }
					const inline = preview || (blob.kind === 'voice' && request.params.variant !== 'download');
					reply.header('Content-Type', preview ? 'image/webp' : blob.kind === 'voice' ? 'audio/mpeg' : 'application/octet-stream');
					reply.header('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', preview ? 'preview.webp' : attachment.name));
					reply.header('Accept-Ranges', 'bytes');
					reply.header('Content-Length', range ? range.end - range.start + 1 : size);
					if (range) reply.header('Content-Range', `bytes ${range.start}-${range.end}/${size}`).code(206);
					if (request.method === 'HEAD') return reply.send();
					return reply.send(createReadStream(source, range ?? undefined));
				} catch {
					// Same response for missing, revoked and other accounts' attachments.
					return reply.code(404).send();
				}
			},
		});
		done();
	}
}
