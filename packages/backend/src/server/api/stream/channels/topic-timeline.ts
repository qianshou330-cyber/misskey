/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, Scope } from '@nestjs/common';
import type { Packed } from '@/misc/json-schema.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { NoteStreamingHidingService } from '../NoteStreamingHidingService.js';
import { PublicTopicService, type PublicTopic } from '@/core/PublicTopicService.js';
import { RoleService } from '@/core/RoleService.js';
import { bindThis } from '@/decorators.js';
import { isRenotePacked, isQuotePacked } from '@/misc/is-renote.js';
import type { JsonObject } from '@/misc/json-value.js';
import Channel, { type ChannelRequest } from '../channel.js';
import { REQUEST } from '@nestjs/core';

@Injectable({ scope: Scope.TRANSIENT })
export class TopicTimelineChannel extends Channel {
	public readonly chName = 'topicTimeline';
	public static shouldShare = false;
	public static requireCredential = false as const;
	private topic!: PublicTopic;
	private withRenotes = true;
	private withFiles = false;

	constructor(
		@Inject(REQUEST)
		request: ChannelRequest,

		private roleService: RoleService,
		private publicTopicService: PublicTopicService,
		private noteEntityService: NoteEntityService,
		private noteStreamingHidingService: NoteStreamingHidingService,
	) {
		super(request);
	}

	@bindThis
	public async init(params: JsonObject): Promise<boolean> {
		const policies = await this.roleService.getUserPolicies(this.user ? this.user.id : null);
		if (!policies.gtlAvailable || typeof params.topicId !== 'string') return false;

		const topic = this.publicTopicService.get(params.topicId);
		if (!topic) return false;
		this.topic = topic;
		this.withRenotes = !!(params.withRenotes ?? true);
		this.withFiles = !!(params.withFiles ?? false);

		this.subscriber.on('notesStream', this.onNote);
		return true;
	}

	@bindThis
	private async onNote(note: Packed<'Note'>) {
		if (this.withFiles && (note.fileIds == null || note.fileIds.length === 0)) return;
		if (note.visibility !== 'public' || note.channelId != null || note.user.host == null) return;
		if (!this.publicTopicService.matches(this.topic, note)) return;
		if (note.user.requireSigninToViewContents && this.user == null) return;
		if (note.renote && note.renote.user.requireSigninToViewContents && this.user == null) return;
		if (note.reply && note.reply.user.requireSigninToViewContents && this.user == null) return;
		if (isRenotePacked(note) && !isQuotePacked(note) && !this.withRenotes) return;
		if (this.isNoteMutedOrBlocked(note)) return;

		const filtered = await this.noteStreamingHidingService.filter(note, this.user?.id ?? null);
		if (!filtered) return;
		note = filtered;

		if (this.user && isRenotePacked(note) && !isQuotePacked(note) && note.renote && Object.keys(note.renote.reactions).length > 0) {
			note.renote.myReaction = await this.noteEntityService.populateMyReaction(note.renote, this.user.id);
		}

		this.send('note', note);
	}

	@bindThis
	public dispose() {
		this.subscriber.off('notesStream', this.onNote);
	}
}
