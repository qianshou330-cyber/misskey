/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { computed } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { entities } from 'misskey-js';

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), post: vi.fn(), getApi: vi.fn() }));
vi.mock('@/utility/idb-proxy.js', () => ({ get: mocks.get, set: mocks.set }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: mocks.post, misskeyApiGet: mocks.getApi }));

function emoji(name: string, alias = name): entities.EmojiSimple {
	return { name, aliases: [alias], url: `https://example.test/${name}.webp`, category: 'test' };
}

describe('custom emoji reactive public interface', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		mocks.get.mockResolvedValue(undefined);
		mocks.set.mockResolvedValue(undefined);
		mocks.getApi.mockResolvedValue({ emojis: [emoji('first')] });
		mocks.post.mockResolvedValue({ emojis: [emoji('forced')] });
	});

	it('imports without waiting for the emoji cache, then updates existing Map consumers', async () => {
		mocks.get.mockReturnValue(new Promise(() => {}));
		const emojis = await import('@/custom-emojis.js');
		expect(mocks.get).not.toHaveBeenCalled();
		const url = computed(() => emojis.customEmojisMap.get('first')?.url);
		expect(url.value).toBeUndefined();
		emojis.addCustomEmoji(emoji('first'));
		expect(url.value).toBe('https://example.test/first.webp');
		emojis.removeCustomEmojis([emoji('first')]);
		expect(url.value).toBeUndefined();
	});

	it('invalidates tag and category views when late data arrives and on streaming changes', async () => {
		const emojis = await import('@/custom-emojis.js');
		expect(emojis.getCustomEmojiTags()).toEqual([]);
		expect(emojis.customEmojiCategories.value).toEqual([null]);
		await emojis.fetchCustomEmojis();
		expect(emojis.getCustomEmojiTags()).toEqual(['first']);
		expect(emojis.customEmojiCategories.value).toEqual(['test', null]);
		emojis.updateCustomEmojis([emoji('first', 'changed')]);
		expect(emojis.getCustomEmojiTags()).toEqual(['changed']);
		emojis.removeCustomEmojis([emoji('first')]);
		expect(emojis.getCustomEmojiTags()).toEqual([]);
	});

	it('passes an abort signal to GET and preserves authenticated POST force semantics', async () => {
		const emojis = await import('@/custom-emojis.js');
		await emojis.fetchCustomEmojis();
		expect(mocks.getApi).toHaveBeenCalledWith('emojis', {}, expect.any(AbortSignal));
		await emojis.fetchCustomEmojis(true);
		expect(mocks.post).toHaveBeenCalledWith('emojis', {}, undefined, expect.any(AbortSignal));
		expect(emojis.customEmojis.value).toEqual([emoji('forced')]);
	});
});
