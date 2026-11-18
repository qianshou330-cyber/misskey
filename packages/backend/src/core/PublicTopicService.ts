/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Brackets, type ObjectLiteral, type SelectQueryBuilder } from 'typeorm';
import { normalizeForSearch } from '@/misc/normalize-for-search.js';
import type { Packed } from '@/misc/json-schema.js';

/**
 * Public, read-only topic definitions.  The account lists intentionally start
 * empty: accounts are added only after they have been observed in PUBO's
 * Global timeline, so this feature never causes a remote follow or fetch.
 */
export const PUBLIC_TOPICS = [
	{ id: 'japanese', name: '日文', tags: ['日本語', '日文', 'japan', 'japanese'], accounts: [] },
	{ id: 'kpop', name: 'K-pop 偶像', tags: ['kpop', 'k-pop', '케이팝', '아이돌'], accounts: [] },
	{ id: 'taiwan', name: '台湾', tags: ['台湾', '台灣', 'taiwan'], accounts: [] },
	{ id: 'hongkong', name: '香港', tags: ['香港', 'hongkong', 'hong-kong'], accounts: [] },
	{ id: 'humor', name: '搞笑段子', tags: ['搞笑', '段子', 'meme', 'funny', '梗'], accounts: [] },
] as const;

export type PublicTopic = (typeof PUBLIC_TOPICS)[number];

type TopicAccount = `${string}@${string}`;

@Injectable()
export class PublicTopicService {
	private readonly topics = new Map<string, PublicTopic>(PUBLIC_TOPICS.map(topic => [topic.id, topic]));

	constructor() {
		for (const topic of PUBLIC_TOPICS) {
			if (topic.accounts.length > 8) throw new Error(`Topic ${topic.id} has more than eight accounts`);
		}
	}

	public get(topicId: string): PublicTopic | undefined {
		return this.topics.get(topicId);
	}

	public list(): readonly PublicTopic[] {
		return PUBLIC_TOPICS;
	}

	/** Add a SQL predicate for a note whose own author matches this topic. */
	public applyQueryFilter<T extends ObjectLiteral>(query: SelectQueryBuilder<T>, topic: PublicTopic): void {
		const tags = topic.tags.map(tag => normalizeForSearch(tag));
		const accounts = topic.accounts as readonly TopicAccount[];

		query.andWhere(new Brackets(qb => {
			// The containment form matches the existing tag-search query and can use
			// the GIN index on note.tags without relying on driver-specific array
			// parameter expansion.
			if (tags.length > 0) {
				qb.where(':publicTopicTag0 <@ note.tags', { publicTopicTag0: [tags[0]] });
				for (let index = 1; index < tags.length; index++) {
					qb.orWhere(`:publicTopicTag${index} <@ note.tags`, { [`publicTopicTag${index}`]: [tags[index]] });
				}
			} else {
				qb.where('1 = 0');
			}

			accounts.forEach((account, index) => {
				const at = account.lastIndexOf('@');
				if (at <= 0 || at === account.length - 1) return;
				const usernameKey = `publicTopicAccountUsername${index}`;
				const hostKey = `publicTopicAccountHost${index}`;
				qb.orWhere(`(user.usernameLower = :${usernameKey} AND user.host = :${hostKey})`, {
					[usernameKey]: account.slice(0, at).toLowerCase(),
					[hostKey]: account.slice(at + 1),
				});
			});
		}));
	}

	/** Match the packed note shape emitted by the streaming bus. */
	public matches(topic: PublicTopic, note: Packed<'Note'>): boolean {
		if (note.user.host == null) return false;

		const topicTags = new Set(topic.tags.map(tag => normalizeForSearch(tag)));
		if (note.tags?.some(tag => topicTags.has(normalizeForSearch(tag)))) return true;

		return (topic.accounts as readonly TopicAccount[]).some(account =>
			account.toLowerCase() === `${note.user.username}@${note.user.host}`.toLowerCase(),
		);
	}
}
