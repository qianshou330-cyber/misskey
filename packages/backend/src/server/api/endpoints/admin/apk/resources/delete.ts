/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { MiApkResource } from '@/models/ApkResource.js';
import { ApiError } from '../../../../error.js';

export const meta = {
	tags: ['admin', 'apk'],

	requireCredential: true,
	requireModerator: true,

	kind: 'write:admin:drive',

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {},
	},

	errors: {
		noSuchResource: {
			message: 'No such APK resource.',
			code: 'NO_SUCH_RESOURCE',
			id: '69893447-6546-432b-99e1-0a6eb16ab1b7',
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
		super(meta, paramDef, async (ps) => {
			const repository = this.db.getRepository(MiApkResource);
			const result = await repository.delete({ id: ps.resourceId });

			if (result.affected === 0) throw new ApiError(meta.errors.noSuchResource);

			return {};
		});
	}
}
