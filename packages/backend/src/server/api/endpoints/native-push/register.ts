/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { NativePushService, NativePushRegistrationError } from '@/core/NativePushService.js';

export const meta = {
	tags: ['notifications'], requireCredential: true, kind: 'write:notifications',
	limit: { duration: 60_000, max: 20 },
	errors: {
		disabled: { message: 'Native push is not enabled.', code: 'NATIVE_PUSH_DISABLED', id: '46bf22c4-82e2-449b-96b6-266be6437527' },
		deviceLimit: { message: 'Too many registered devices.', code: 'NATIVE_PUSH_DEVICE_LIMIT', id: '084d2235-dbb1-4473-9a85-40d24ac41044' },
		scopeRequired: { message: 'Notification authorization is required.', code: 'NATIVE_PUSH_SCOPE_REQUIRED', id: '73a5a5ba-fd0d-420c-857b-5b51a8e9554b' },
		environmentMismatch: { message: 'Unsupported application or environment.', code: 'NATIVE_PUSH_ENVIRONMENT_MISMATCH', id: '10de6043-c5f3-4092-9074-1a28e5a43f5a' },
		staleOperation: { message: 'A newer device operation already exists.', code: 'NATIVE_PUSH_STALE_OPERATION', id: 'ce492898-9d11-4ab2-811f-48f2d5df7fab' },
	},
	res: { type: 'object', optional: false, nullable: false, properties: {
		subscriptionId: { type: 'string', optional: false, nullable: false },
		expiresAt: { type: 'string', format: 'date-time', optional: false, nullable: false },
	} },
} as const;

export const paramDef = {
	type: 'object', properties: {
		installationId: { type: 'string', pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' },
		revision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
		deviceToken: { type: 'string', pattern: '^(?:[a-fA-F0-9]{2}){16,256}$' },
		environment: { type: 'string', enum: ['development', 'production'] },
		bundleId: { type: 'string', enum: ['com.bolubo.native'] },
	}, required: ['installationId', 'deviceToken', 'environment', 'bundleId', 'revision'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private nativePushService: NativePushService) {
		super(meta, paramDef, async (ps, me, token) => {
			try { return await this.nativePushService.register(me, token, ps); } catch (error) {
				if (error instanceof NativePushRegistrationError) {
					const definition = Object.values(meta.errors).find(item => item.code === error.code);
					if (definition) throw new ApiError(definition);
				}
				throw error;
			}
		});
	}
}
