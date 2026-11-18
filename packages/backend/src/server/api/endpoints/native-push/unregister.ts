/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { NativePushService } from '@/core/NativePushService.js';

export const meta = {
	tags: ['notifications'], requireCredential: true, kind: 'write:notifications',
	limit: { duration: 60_000, max: 30 },
} as const;

export const paramDef = { type: 'object', properties: {
	installationId: { type: 'string', pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' },
	revision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
	environment: { type: 'string', enum: ['development', 'production'] },
	bundleId: { type: 'string', enum: ['com.bolubo.native'] },
}, required: ['installationId', 'revision', 'environment', 'bundleId'] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private nativePushService: NativePushService) {
		super(meta, paramDef, async (ps, me) => { await this.nativePushService.unregister(me.id, ps); });
	}
}
