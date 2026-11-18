/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineComponent, h } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import type * as Misskey from 'misskey-js';
import { preferState } from '../setup.unit.js';
import WelcomeTimelineNote from '@/pages/welcome.timeline.note.vue';

vi.mock('@/os.js', () => ({}));
vi.mock('@/utility/media-proxy.js', () => ({ getStaticImageUrl: (url: string) => `${url}?static=1` }));
vi.mock('@/components/MkMediaList.vue', async () => {
	const { defineComponent, h } = await import('vue');
	return { default: defineComponent({ setup: () => () => h('div', { 'data-testid': 'full-media-list' }) }) };
});
vi.mock('@/components/MkReactionsViewer.vue', async () => {
	const { defineComponent, h } = await import('vue');
	return { default: defineComponent({ setup: () => () => h('button', { 'data-testid': 'reaction-button' }, 'reaction') }) };
});
vi.mock('@/components/MkCwButton.vue', async () => {
	const { defineComponent, h } = await import('vue');
	return { default: defineComponent({
		props: { modelValue: Boolean },
		emits: ['update:modelValue'],
		setup: (props, { emit }) => () => h('button', { 'data-testid': 'expand-cw', onClick: () => emit('update:modelValue', !props.modelValue) }, 'show'),
	}) };
});

const MkA = defineComponent({ props: { to: String }, setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) });
const Mfm = defineComponent({ props: { text: String }, setup: props => () => h('span', {}, [props.text, h('a', { href: '/mfm-link' }, 'nested MFM link')]) });

function file(id: string, type = 'image/jpeg', extra: Partial<Misskey.entities.DriveFile> = {}): Misskey.entities.DriveFile {
	return { id, type, thumbnailUrl: `https://media.example/${id}.webp`, url: `https://media.example/${id}`, name: id, isSensitive: false, properties: {}, ...extra } as Misskey.entities.DriveFile;
}

function note(extra: Partial<Misskey.entities.Note> = {}): Misskey.entities.Note {
	return { id: 'preview-note', user: { id: 'author', username: 'author', name: 'Author' }, text: 'Public note preview', cw: null, files: [], reactionCount: 0, reactions: {}, reactionEmojis: {}, ...extra } as Misskey.entities.Note;
}

function mountNote(item = note(), props: { preview?: boolean; duplicate?: boolean } = { preview: true }) {
	return render(WelcomeTimelineNote, { props: { note: item, ...props }, global: { components: { MkA, Mfm } } });
}

describe('welcome timeline preview cards', () => {
	beforeEach(() => {
		preferState.nsfw = 'respect';
		preferState.dataSaver = { media: false };
	});
	afterEach(cleanup);

	it('provides one original-note entrance while rich content and reactions cannot receive focus', () => {
		const screen = mountNote(note({ reactionCount: 1, reactions: { '❤': 1 } }));
		const link = screen.getByTestId('welcome-note-link');
		expect(link.getAttribute('href')).toBe('/notes/preview-note');
		expect(link.getAttribute('aria-label')).toContain('Public note preview');
		expect(link.getAttribute('tabindex')).toBeNull();
		expect(link.closest('[inert]')).toBeNull();
		expect(screen.container.querySelector('a[href="/mfm-link"]')?.closest('[inert]')).not.toBeNull();
		expect(screen.getByTestId('reaction-button').closest('[inert]')).not.toBeNull();
		expect(screen.queryByTestId('full-media-list')).toBeNull();
	});

	it('keeps CW body and all its media out of the preview DOM and accessible link label', () => {
		const screen = mountNote(note({ cw: 'Content warning', text: 'Hidden body', files: [file('hidden-file')] }));
		expect(screen.container.textContent).toContain('Content warning');
		expect(screen.container.textContent).not.toContain('Hidden body');
		expect(screen.getByTestId('welcome-note-link').getAttribute('aria-label')).not.toContain('Hidden body');
		expect(screen.queryByTestId('expand-cw')).toBeNull();
		expect(screen.container.querySelector('img')).toBeNull();
	});

	it('never loads sensitive media or data-saver placeholders, even with an ignore preference', () => {
		preferState.nsfw = 'ignore';
		const screen = mountNote(note({ files: [file('sensitive', 'image/jpeg', { isSensitive: true })] }));
		expect(screen.container.querySelector('img')).toBeNull();
		expect(screen.container.innerHTML).not.toContain('media.example');
		cleanup();
		preferState.dataSaver = { media: true };
		const saved = mountNote(note({ files: [file('data-saver')] }));
		expect(saved.container.querySelector('img')).toBeNull();
	});

	it('uses static image/video thumbnails only and never creates an audio/video player or raw fallback', () => {
		const screen = mountNote(note({ files: [file('image'), file('video', 'video/mp4'), file('audio', 'audio/mpeg'), file('no-thumbnail', 'video/mp4', { thumbnailUrl: null })] }));
		const images = Array.from(screen.container.querySelectorAll('img'));
		expect(images.map(image => image.getAttribute('src'))).toEqual(['https://media.example/image.webp?static=1', 'https://media.example/video.webp?static=1']);
		expect(screen.container.querySelector('video, audio, iframe')).toBeNull();
		expect(screen.container.innerHTML).not.toContain('https://media.example/audio');
		expect(screen.container.innerHTML).not.toContain('https://media.example/no-thumbnail');
	});

	it('keeps copied preview links mouse-clickable but outside tab navigation and reading order', async () => {
		const screen = mountNote(note(), { preview: true, duplicate: true });
		const link = screen.getByTestId('welcome-note-link');
		expect(link.getAttribute('tabindex')).toBe('-1');
		expect(link.closest('[aria-hidden="true"]')).not.toBeNull();
		expect(link.closest('[inert]')).toBeNull();
		const down = new MouseEvent('mousedown', { cancelable: true, bubbles: true });
		link.dispatchEvent(down);
		expect(down.defaultPrevented).toBe(true);
		const click = vi.fn();
		link.addEventListener('click', click);
		await fireEvent.click(link);
		expect(click).toHaveBeenCalledOnce();
	});

	it('preserves ordinary cards and their CW expansion when preview is omitted', async () => {
		const screen = mountNote(note({ cw: 'Warning', text: 'Ordinary hidden content', files: [file('normal')] }), {});
		expect(screen.queryByTestId('welcome-note-link')).toBeNull();
		expect(screen.queryByTestId('full-media-list')).toBeNull();
		await fireEvent.click(screen.getByTestId('expand-cw'));
		expect(screen.container.textContent).toContain('Ordinary hidden content');
		expect(screen.getByTestId('full-media-list')).not.toBeNull();
	});
});
