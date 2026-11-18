/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { nextTick } from 'vue';
import * as Misskey from 'misskey-js';
import CustomEmoji from '@/components/global/MkCustomEmoji.vue';
import Picker from '@/components/MkEmojiPicker.vue';
import Reactions from '@/components/MkReactionsViewer.vue';
import { customEmojis, customEmojisMap } from '@/custom-emojis.js';
import { prefer } from '@/preferences.js';

vi.mock('@/i18n.js', () => ({ i18n: { ts: new Proxy({}, { get: (_target, name) => name }), tsx: {} } }));
vi.mock('@@/js/config.js', () => ({ host: 'bolubo.com', url: 'https://bolubo.com' }));
vi.mock('@/custom-emojis.js', async () => {
	const { computed, shallowReactive, shallowRef, watch } = await import('vue');
	const emojis = shallowRef<Misskey.entities.EmojiSimple[]>([]);
	const map = shallowReactive(new Map<string, Misskey.entities.EmojiSimple>());
	watch(emojis, value => { map.clear(); for (const emoji of value) map.set(emoji.name, emoji); }, { flush: 'sync' });
	return { customEmojis: emojis, customEmojisMap: map, customEmojiCategories: computed(() => [...new Set(emojis.value.map(e => e.category)), null]) };
});
vi.mock('@/preferences.js', async () => {
	const { reactive, ref } = await import('vue');
	return { prefer: { s: reactive({ animation: false, showAvailableReactionsFirstInNote: true, disableShowingAnimatedImages: false }), r: { mutingEmojis: ref([]), emojiPickerScale: ref(1), emojiPickerWidth: ref(1), emojiPickerHeight: ref(1) } } };
});
vi.mock('@/store.js', async () => {
	const { ref } = await import('vue');
	return { store: { r: { recentlyUsedEmojis: ref([]) }, s: { recentlyUsedEmojis: [], additionalUnicodeEmojiIndexes: {} }, set: vi.fn() } };
});
vi.mock('@/i.js', () => ({ $i: { id: 'me', host: null, roles: [] } }));
vi.mock('@/os.js', () => ({ popup: vi.fn(), confirm: vi.fn() }));
vi.mock('@/router.js', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: vi.fn(), misskeyApiGet: vi.fn() }));
vi.mock('@/utility/media-proxy.js', () => ({ getProxiedImageUrl: (url: string) => url, getStaticImageUrl: (url: string) => url }));
vi.mock('@/utility/copy-to-clipboard.js', () => ({ copyToClipboard: vi.fn() }));
vi.mock('@/utility/emoji-palette.js', () => ({ addToEmojiPalette: vi.fn() }));
vi.mock('@/utility/touch.js', () => ({ isTouchUsing: false }));
vi.mock('@/utility/device-kind.js', () => ({ deviceKind: 'desktop' }));
vi.mock('@/utility/haptic.js', () => ({ haptic: vi.fn() }));
vi.mock('@/components/MkCustomEmojiDetailedDialog.vue', () => ({ default: { template: '<div/>' } }));
vi.mock('@/components/MkRippleEffect.vue', () => ({ default: { template: '<div/>' } }));
vi.mock('@/components/MkReactionsViewer.reaction.vue', () => ({ default: { props: ['reaction', 'count'], template: '<button :data-reaction="reaction">{{ count }}</button>' } }));

const emoji = (name: string, category: string | null = 'PUBO') => ({ name, aliases: [name], category, url: `https://bolubo.com/${name}.png`, localOnly: false, isSensitive: false, roleIdsThatCanBeUsedThisEmojiAsReaction: [] }) satisfies Misskey.entities.EmojiSimple;
const globals = { components: { MkCustomEmoji: CustomEmoji }, stubs: { MkEmoji: { template: '<span/>' } }, directives: { panel: {}, tooltip: {} } };

describe('late custom emoji data updates existing UI', () => {
	beforeEach(() => {
		customEmojis.value = [];
		prefer.r.mutingEmojis.value = [];
		prefer.s.showAvailableReactionsFirstInNote = true;
	});
	afterEach(cleanup);

	it('replaces a shortcode when the URL arrives, retries changed URLs but not failed identical URLs', async () => {
		const view = render(CustomEmoji, { props: { name: 'pubo', fallbackToImage: true } });
		expect(view.getByText(':pubo:')).toBeTruthy();
		customEmojis.value = [emoji('pubo')];
		await nextTick();
		expect(view.getByAltText(':pubo:').getAttribute('src')).toBe('https://bolubo.com/pubo.png');
		await fireEvent.error(view.getByAltText(':pubo:'));
		expect(view.container.querySelector('img')?.getAttribute('src')).toBe('/client-assets/dummy.png');
		customEmojis.value = [{ ...emoji('pubo') }];
		await nextTick();
		expect(view.queryByAltText(':pubo:')).toBeNull();
		customEmojis.value = [{ ...emoji('pubo'), url: 'https://bolubo.com/pubo-new.png' }];
		await nextTick();
		expect(view.getByAltText(':pubo:').getAttribute('src')).toBe('https://bolubo.com/pubo-new.png');
		customEmojis.value = [];
		await nextTick();
		expect(view.getByText(':pubo:')).toBeTruthy();
	});

	it('keeps muted emojis hidden when their data arrives', async () => {
		prefer.r.mutingEmojis.value = [':pubo:'];
		const view = render(CustomEmoji, { props: { name: 'pubo' } });
		customEmojis.value = [emoji('pubo')];
		await nextTick();
		expect(view.container.querySelector('img')?.getAttribute('src')).toBe('/client-assets/unknown.png');
	});

	it('refreshes an already-entered search, category tree and permission-filtered pinned buttons', async () => {
		const view = render(Picker, { props: { pinnedEmojis: [':pubo:'], targetNote: { user: { host: null }, reactionAcceptance: 'nonSensitiveOnly' } as Misskey.entities.Note }, global: globals });
		await fireEvent.update(view.getByRole('searchbox'), 'pubo');
		expect(view.container.querySelector('.result button')).toBeNull();
		customEmojis.value = [{ ...emoji('pubo', 'New/Nested'), isSensitive: true }];
		await nextTick();
		const result = view.container.querySelector<HTMLButtonElement>('.result button');
		expect(result?.title).toBe('pubo');
		expect(result?.disabled).toBe(true);
		expect(view.container.querySelector<HTMLButtonElement>('[data-emoji=":pubo:"]')?.disabled).toBe(true);
		expect(view.container.textContent).toContain('New');
		customEmojis.value = [emoji('pubo', 'New/Nested')];
		await nextTick();
		expect(view.container.querySelector<HTMLButtonElement>('.result button')?.disabled).toBe(false);
		await fireEvent.update(view.getByRole('searchbox'), '');
		const topHeader = [...view.container.querySelectorAll('section > header')].find(el => el.textContent?.includes('New'))!;
		await fireEvent.click(topHeader);
		const nested = [...view.container.querySelectorAll('section > header')].find(el => el.textContent?.includes('Nested'))!;
		await fireEvent.click(nested);
		expect(view.container.querySelectorAll('[data-emoji=":pubo:"]').length).toBe(2);
		customEmojis.value = [{ ...emoji('pubo', 'New/Nested'), roleIdsThatCanBeUsedThisEmojiAsReaction: ['restricted'] }];
		await nextTick();
		for (const button of view.container.querySelectorAll<HTMLButtonElement>('[data-emoji=":pubo:"]')) expect(button.disabled).toBe(true);
		customEmojis.value = [];
		await nextTick();
		expect(view.container.textContent).not.toContain('Nested');
	});

	it('recomputes available-first ranking and its top N after emoji arrival and removal', async () => {
		const view = render(Reactions, { props: { noteId: 'note', reactions: { ':remote@example.com:': 100, ':pubo@.:': 2 }, reactionEmojis: {}, myReaction: null, maxNumber: 1 }, slots: { more: 'More' } });
		expect(view.container.querySelector('button')?.getAttribute('data-reaction')).toBe(':remote@example.com:');
		customEmojis.value = [emoji('pubo')];
		await nextTick();
		expect(customEmojisMap.has('pubo')).toBe(true);
		expect(view.container.querySelector('button')?.getAttribute('data-reaction')).toBe(':pubo@.:');
		expect(view.getByText('More')).toBeTruthy();
		customEmojis.value = [];
		await nextTick();
		expect(view.container.querySelector('button')?.getAttribute('data-reaction')).toBe(':remote@example.com:');
	});

	it('keeps existing reaction order for ordinary count updates and preserves an own zero-count reaction', async () => {
		const view = render(Reactions, { props: { noteId: 'note', reactions: { '😀': 10, '❤️': 2, ':pubo@.:': 0 }, reactionEmojis: {}, myReaction: ':pubo@.:', maxNumber: 2 } });
		await view.rerender({ reactions: { '😀': 10, '❤️': 20, ':pubo@.:': 0 } });
		expect([...view.container.querySelectorAll('button')].map(el => el.getAttribute('data-reaction'))).toEqual(['😀', '❤️', ':pubo@.:']);
		expect(view.container.querySelector('[data-reaction=":pubo@.:"]')?.textContent).toBe('0');
		prefer.s.showAvailableReactionsFirstInNote = false;
		await nextTick();
		customEmojis.value = [emoji('pubo')];
		await nextTick();
		expect(view.container.querySelector('button')?.getAttribute('data-reaction')).toBe('❤️');
	});
});
