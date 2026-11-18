/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { AnnouncementsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { AnnouncementService, InvalidMarqueeAnnouncementError } from '@/core/AnnouncementService.js';
import { ApiError } from '../../../error.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireModerator: true,
	kind: 'write:admin:announcements',

	errors: {
		noSuchAnnouncement: {
			message: 'No such announcement.',
			code: 'NO_SUCH_ANNOUNCEMENT',
			id: 'd3aae5a7-6372-4cb4-b61c-f511ffc2d7cc',
		},
		invalidMarqueeAnnouncement: {
			message: 'Marquee announcements must be global.',
			code: 'INVALID_MARQUEE_ANNOUNCEMENT',
			id: 'f19f65e7-80b6-451a-9bd0-ef4b59e05b20',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		id: { type: 'string', format: 'misskey:id' },
		title: { type: 'string', minLength: 1 },
		text: { type: 'string', minLength: 1 },
		imageUrl: { type: 'string', nullable: true, minLength: 0 },
		icon: { type: 'string', enum: ['info', 'warning', 'error', 'success'] },
		display: { type: 'string', enum: ['normal', 'banner', 'dialog', 'marquee'] },
		forExistingUsers: { type: 'boolean' },
		silence: { type: 'boolean' },
		needConfirmationToRead: { type: 'boolean' },
		isActive: { type: 'boolean' },
	},
	required: ['id'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.announcementsRepository)
		private announcementsRepository: AnnouncementsRepository,

		private announcementService: AnnouncementService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const announcement = await this.announcementsRepository.findOneBy({ id: ps.id });

			if (announcement == null) throw new ApiError(meta.errors.noSuchAnnouncement);

			await this.announcementService.update(announcement, {
				updatedAt: new Date(),
				title: ps.title,
				text: ps.text,
				imageUrl: ps.imageUrl,
				display: ps.display,
				icon: ps.icon,
				forExistingUsers: ps.forExistingUsers,
				silence: ps.silence,
				needConfirmationToRead: ps.needConfirmationToRead,
				isActive: ps.isActive,
			}, me).catch(err => {
				if (err instanceof InvalidMarqueeAnnouncementError) throw new ApiError(meta.errors.invalidMarqueeAnnouncement);
				throw err;
			});
		});
	}
}
