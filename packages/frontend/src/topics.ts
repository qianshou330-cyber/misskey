/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Public federation topics exposed by PUBO.
 *
 * The matching rules and remote-account allowlists live on the server.  Keep
 * this list in sync with the server topic definitions; the IDs are part of the
 * public URL and API contract.
 */
export const topics = [
	{
		id: 'japanese',
		name: '日文',
		description: '日语创作者的公开远端帖子',
		icon: 'ti ti-language',
	},
	{
		id: 'kpop',
		name: 'K-pop 偶像',
		description: 'K-pop 偶像、音乐和舞台动态',
		icon: 'ti ti-music',
	},
	{
		id: 'taiwan',
		name: '台湾',
		description: '台湾生活、文化和娱乐',
		icon: 'ti ti-building-community',
	},
	{
		id: 'hongkong',
		name: '香港',
		description: '香港生活、文化和娱乐',
		icon: 'ti ti-building-skyscraper',
	},
	{
		id: 'humor',
		name: '搞笑段子',
		description: '公开分享的搞笑段子和轻松内容',
		icon: 'ti ti-mood-laugh',
	},
] as const;

export type TopicId = typeof topics[number]['id'];
export type Topic = typeof topics[number];

export function getTopic(id: string): Topic | undefined {
	return topics.find(topic => topic.id === id);
}
