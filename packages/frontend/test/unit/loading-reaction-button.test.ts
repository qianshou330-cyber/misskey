/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { nextTick } from 'vue';
import Reaction from '@/components/MkReactionsViewer.reaction.vue';
import { customEmojisMap } from '@/custom-emojis.js';
import { DI } from '@/di.js';

vi.mock('@/custom-emojis.js', async () => ({ customEmojisMap: (await import('vue')).shallowReactive(new Map()) }));
vi.mock('@/i.js', () => ({ $i: { id: 'me', host: null, roles: [] } }));
vi.mock('@/i18n.js', () => ({ i18n: { ts: {}, tsx: {} } }));
vi.mock('@/os.js', () => ({ popup: vi.fn() }));
vi.mock('@/preferences.js', () => ({ prefer: { s: { animation: false, confirmOnReact: false } } }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: vi.fn(), misskeyApiGet: vi.fn() }));
vi.mock('@/utility/emoji-mute.js', () => ({ checkMuted: vi.fn(), mute: vi.fn(), unmute: vi.fn() }));
vi.mock('@/utility/emoji-palette.js', () => ({ addToEmojiPalette: vi.fn() }));
vi.mock('@/utility/haptic.js', () => ({ haptic: vi.fn() }));
vi.mock('@/utility/sound.js', () => ({ playMisskeySfx: vi.fn() }));
vi.mock('@/composables/use-tooltip.js', () => ({ useTooltip: vi.fn() }));
vi.mock('@/composables/use-note-capture.js', () => ({ noteEvents: { emit: vi.fn() } }));
vi.mock('@/components/MkCustomEmojiDetailedDialog.vue', () => ({ default: { template: '<div/>' } }));
vi.mock('@/components/MkReactionEffect.vue', () => ({ default: { template: '<div/>' } }));
vi.mock('@/components/MkReactionsViewer.details.vue', () => ({ default: { template: '<div/>' } }));
vi.mock('@/components/MkReactionIcon.vue', () => ({ default: { template: '<span/>' } }));

describe('existing reaction buttons react to late emoji data', () => {
	afterEach(() => { cleanup(); customEmojisMap.clear(); });
	it('enables a reaction when data arrives and disables it after deletion', async () => {
		const view = render(Reaction, { props: { noteId: 'note', reaction: ':pubo@.:', reactionEmojis: {}, myReaction: null, count: 1, isInitial: true }, global: { provide: { [DI.mock]: true }, directives: { ripple: {} } } });
		await fireEvent.click(view.getByRole('button'));
		expect(view.emitted().reactionToggled).toBeUndefined();
		customEmojisMap.set('pubo', { name: 'pubo', aliases: [], url: 'https://bolubo.com/pubo.png', category: null });
		await nextTick();
		await fireEvent.click(view.getByRole('button'));
		expect(view.emitted().reactionToggled).toEqual([[':pubo@.:', 2]]);
		customEmojisMap.delete('pubo');
		await nextTick();
		await fireEvent.click(view.getByRole('button'));
		expect(view.emitted().reactionToggled).toHaveLength(1);
	});
});
