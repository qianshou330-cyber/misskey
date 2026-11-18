/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { shallowRef, shallowReactive, computed, markRaw, watch } from 'vue';
import * as Misskey from 'misskey-js';
import { misskeyApi, misskeyApiGet } from '@/utility/misskey-api.js';
import { get, set } from '@/utility/idb-proxy.js';
import { CustomEmojiLoader } from '@/utility/custom-emoji-loader.js';

export const customEmojis = shallowRef<Misskey.entities.EmojiSimple[]>([]);
export const customEmojiCategories = computed<[ ...string[], null ]>(() => {
	const categories = new Set<string>();
	for (const emoji of customEmojis.value) {
		if (emoji.category && emoji.category !== 'null') {
			categories.add(emoji.category);
		}
	}
	return markRaw([...Array.from(categories), null]);
});

export const customEmojisMap = shallowReactive(new Map<string, Misskey.entities.EmojiSimple>());
let cachedTags: string[] | null = null;
watch(customEmojis, emojis => {
	cachedTags = null;
	customEmojisMap.clear();
	for (const emoji of emojis) {
		customEmojisMap.set(emoji.name, emoji);
	}
}, { immediate: true, flush: 'sync' });

const loader = new CustomEmojiLoader({
	readCache: async () => {
		const [emojis, fetchedAt] = await Promise.all([get('emojis'), get('lastEmojisFetchedAt')]);
		return { emojis, fetchedAt };
	},
	writeCache: async (emojis, fetchedAt, isCurrent) => {
		await set('emojis', emojis);
		if (isCurrent()) await set('lastEmojisFetchedAt', fetchedAt);
	},
	request: (force, signal) => force ? misskeyApi('emojis', {}, undefined, signal) : misskeyApiGet('emojis', {}, signal),
	changed: emojis => { customEmojis.value = emojis; },
});

export function addCustomEmoji(emoji: Misskey.entities.EmojiSimple) {
	loader.add(emoji);
}

export function updateCustomEmojis(emojis: Misskey.entities.EmojiSimple[]) {
	loader.update(emojis);
}

export function removeCustomEmojis(emojis: Misskey.entities.EmojiSimple[]) {
	loader.remove(emojis);
}

export function fetchCustomEmojis(force = false) {
	return loader.fetch(force);
}

export function getCustomEmojiTags() {
	if (cachedTags) return cachedTags;

	const tags = new Set<string>();
	for (const emoji of customEmojis.value) {
		for (const tag of emoji.aliases) {
			tags.add(tag);
		}
	}
	const res = Array.from(tags);
	cachedTags = res;
	return res;
}
