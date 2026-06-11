/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { MiApkResource } from '@/models/ApkResource.js';
import { ApiError } from '../../../error.js';

export const meta = {
	tags: ['apk'],

	requireCredential: true,

	kind: 'write:drive',

	errors: {
		noSuchResource: {
			message: 'No such APK resource.',
			code: 'NO_SUCH_RESOURCE',
			id: 'f5375955-c31a-4391-bf2e-4e1d16ec7cc8',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		resourceId: { type: 'string', format: 'misskey:id' },
	},
	required: ['resourceId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.db)
		private db: DataSource,
	) {
		super(meta, paramDef, async (ps, me) => {
			const result = await this.db.getRepository(MiApkResource).delete({
				id: ps.resourceId,
				userId: me.id,
			});

			if (result.affected === 0) throw new ApiError(meta.errors.noSuchResource);
		});
	}
}
