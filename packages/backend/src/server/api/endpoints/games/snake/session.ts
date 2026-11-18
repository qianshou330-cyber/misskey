/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { Config } from '@/config.js';
import { DI } from '@/di-symbols.js';
import { issueSnakeSession } from '@/misc/snake-session.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';

export const meta = {
	tags: ['games'],
	requireCredential: true,
	kind: 'read:account',
	prohibitMoved: true,
	limit: {
		duration: 60 * 1000,
		max: 12,
		minInterval: 1000,
	},
	errors: {
		unavailable: {
			message: 'Snake game is unavailable.',
			code: 'SNAKE_GAME_UNAVAILABLE',
			id: 'b172e589-819a-489f-bcfb-24cffa859934',
		},
	},
	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			ticket: { type: 'string', optional: false, nullable: false },
			expiresAt: { type: 'string', format: 'date-time', optional: false, nullable: false },
			socketPath: { type: 'string', enum: ['/games/snake/socket.io/'], optional: false, nullable: false },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.config) config: Config,
	) {
		super(meta, paramDef, async (_ps, me) => {
			const session = await issueSnakeSession(config, me);
			if (session === null) throw new ApiError(meta.errors.unavailable);
			return session;
		});
	}
}
