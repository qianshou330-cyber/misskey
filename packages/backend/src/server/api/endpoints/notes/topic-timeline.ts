/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { NotesRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { QueryService } from '@/core/QueryService.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { PublicTopicService } from '@/core/PublicTopicService.js';
import { RoleService } from '@/core/RoleService.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '../../error.js';

export const meta = {
	tags: ['notes'],
	requireCredential: false,

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'Note',
		},
	},

	errors: {
		gtlDisabled: {
			message: 'Global timeline has been disabled.',
			code: 'GTL_DISABLED',
			id: '0332fc13-6ab2-4427-ae80-a9fadffd1a6b',
		},
		topicNotFound: {
			message: 'The requested topic does not exist.',
			code: 'TOPIC_NOT_FOUND',
			id: '8a6c2f1e-8d5c-4f5d-a2bc-1b1a7f4df0a1',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		topicId: { type: 'string', minLength: 1 },
		withFiles: { type: 'boolean', default: false },
		withRenotes: { type: 'boolean', default: true },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
	},
	required: ['topicId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		private noteEntityService: NoteEntityService,
		private queryService: QueryService,
		private publicTopicService: PublicTopicService,
		private roleService: RoleService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const policies = await this.roleService.getUserPolicies(me ? me.id : null);
			if (!policies.gtlAvailable) throw new ApiError(meta.errors.gtlDisabled);

			const topic = this.publicTopicService.get(ps.topicId);
			if (!topic) throw new ApiError(meta.errors.topicNotFound);

			const query = this.queryService.makePaginationQuery(
				this.notesRepository.createQueryBuilder('note'),
				ps.sinceId,
				ps.untilId,
			)
				.andWhere("note.visibility = 'public'")
				.andWhere('note.channelId IS NULL')
				.andWhere('note.userHost IS NOT NULL')
				.innerJoinAndSelect('note.user', 'user')
				.leftJoinAndSelect('note.reply', 'reply')
				.leftJoinAndSelect('note.renote', 'renote')
				.leftJoinAndSelect('reply.user', 'replyUser')
				.leftJoinAndSelect('renote.user', 'renoteUser');

			this.publicTopicService.applyQueryFilter(query, topic);
			this.queryService.generateBaseNoteFilteringQuery(query, me);
			if (me) this.queryService.generateMutedUserRenotesQueryForNotes(query, me);

			if (ps.withFiles) query.andWhere("note.fileIds != '{}'");
			if (ps.withRenotes === false) {
				query.andWhere('(note.renoteId IS NULL OR note.text IS NOT NULL OR note.fileIds != \'{}\' OR EXISTS (SELECT 1 FROM poll WHERE poll."noteId" = note.id))');
			}

			const timeline = await query.limit(ps.limit).getMany();
			return await this.noteEntityService.packMany(timeline, me);
		});
	}
}
