/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineComponent, h, nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import type { HomeAnnouncement } from '@/utility/home-announcements.js';
import MkHomeAnnouncementEditor from '@/components/MkHomeAnnouncementEditor.vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import { $i } from '@/i.js';

vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: vi.fn() }));
vi.mock('@/i.js', async () => {
	const { reactive } = await import('vue');
	return { $i: reactive({ id: 'admin', isAdmin: true }) };
});
vi.mock('@/components/MkModalWindow.vue', async () => {
	const { defineComponent, h } = await import('vue');
	return { default: defineComponent({ emits: ['closed'], setup(_, { slots, emit, expose }) {
		expose({ close: () => emit('closed') });
		return () => h('div', { role: 'dialog' }, [slots.header?.(), slots.default?.(), slots.footer?.()]);
	} }) };
});
vi.mock('@/components/MkInput.vue', async () => {
	const { defineComponent, h } = await import('vue');
	return { default: defineComponent({ props: ['modelValue', 'disabled'], emits: ['update:modelValue'], setup: (props, { emit }) => () => h('input', { value: props.modelValue, disabled: props.disabled, onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).value) }) }) };
});
vi.mock('@/components/MkTextarea.vue', async () => {
	const { defineComponent, h } = await import('vue');
	return { default: defineComponent({ props: ['modelValue', 'disabled'], emits: ['update:modelValue'], setup: (props, { emit }) => () => h('textarea', { value: props.modelValue, disabled: props.disabled, onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLTextAreaElement).value) }) }) };
});
vi.mock('@/components/MkButton.vue', async () => {
	const { defineComponent, h } = await import('vue');
	return { default: defineComponent({ props: ['disabled', 'wait'], emits: ['click'], setup: (props, { emit, slots }) => () => h('button', { disabled: props.disabled || props.wait, onClick: () => emit('click') }, slots.default?.()) }) };
});

const first: HomeAnnouncement = { id: 'first', title: 'First', text: 'Original body', imageUrl: null, createdAt: '2026-10-23T00:00:00Z', updatedAt: null, display: 'marquee', icon: 'info', forYou: false, silence: true, needConfirmationToRead: false };
const second: HomeAnnouncement = { ...first, id: 'second', title: 'Second' };
const api = vi.mocked(misskeyApi);

async function settle(): Promise<void> { await vi.advanceTimersByTimeAsync(0); await nextTick(); }

function mount(initialId: string | null = first.id) {
	return render(MkHomeAnnouncementEditor, { props: { initialId }, global: { components: { MkLoading: defineComponent({ setup: () => () => h('div') }) } } });
}

describe('direct homepage announcement editing', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		$i!.id = 'admin';
		$i!.isAdmin = true;
		api.mockReset();
		api.mockImplementation(async endpoint => endpoint === 'announcements' ? [first] : undefined);
	});
	afterEach(() => { cleanup(); vi.useRealTimers(); });

	it('reads the current single announcement and submits only editable fields after a fresh active check', async () => {
		const view = mount();
		await settle();
		expect((view.getByTestId('announcement-title') as HTMLInputElement).value).toBe('First');
		await fireEvent.update(view.getByTestId('announcement-title'), 'Updated');
		await fireEvent.update(view.getByTestId('announcement-text'), 'Updated body');
		await fireEvent.update(view.getByTestId('announcement-image'), 'https://example.com/image.png');
		await fireEvent.click(view.getByTestId('announcement-save'));
		await settle();
		expect(api.mock.calls.map(([endpoint]) => endpoint)).toEqual(['announcements', 'announcements', 'admin/announcements/update']);
		expect(api.mock.calls[0][2]).toBeNull();
		expect(api.mock.calls[2][1]).toEqual({ id: 'first', title: 'Updated', text: 'Updated body', imageUrl: 'https://example.com/image.png' });
		expect(view.emitted().saved).toHaveLength(1);
		expect(view.emitted().closed).toHaveLength(1);
	});

	it('selects the intended announcement from multiple current titles', async () => {
		api.mockResolvedValue([first, second]);
		const view = mount(null);
		await settle();
		expect(view.queryByTestId('announcement-title')).toBeNull();
		await fireEvent.click(view.getByRole('button', { name: 'Second' }));
		expect((view.getByTestId('announcement-title') as HTMLInputElement).value).toBe('Second');
	});

	it('does not write when canceled and does not replace a deleted selected ID with another announcement', async () => {
		api.mockResolvedValue([second]);
		const view = mount();
		await settle();
		expect(view.queryByTestId('announcement-save')).toBeNull();
		expect(view.getByRole('alert')).toBeTruthy();
		await fireEvent.click(view.getByTestId('announcement-cancel'));
		expect(api.mock.calls.every(([endpoint]) => endpoint === 'announcements')).toBe(true);
		expect(view.emitted().closed).toHaveLength(1);
	});

	it('retains typed values after a failed write and allows an explicit retry', async () => {
		let writes = 0;
		api.mockImplementation(async endpoint => {
			if (endpoint === 'announcements') return [first];
			if (writes++ === 0) throw new Error('offline');
			return undefined;
		});
		const view = mount();
		await settle();
		await fireEvent.update(view.getByTestId('announcement-text'), 'Keep this draft');
		await fireEvent.click(view.getByTestId('announcement-save'));
		await settle();
		expect((view.getByTestId('announcement-text') as HTMLTextAreaElement).value).toBe('Keep this draft');
		expect(view.getByRole('alert')).toBeTruthy();
		expect(view.emitted().closed).toBeUndefined();
		await fireEvent.click(view.getByTestId('announcement-save'));
		await settle();
		expect(writes).toBe(2);
		expect(view.emitted().saved).toHaveLength(1);
	});

	it.each(['ended', 'deleted', 'changed'])('does not submit a stale %s announcement', async state => {
		api.mockResolvedValueOnce([first]).mockResolvedValue(state === 'changed' ? [{ ...first, text: 'Other administrator update', updatedAt: '2026-10-23T01:00:00Z' }] : []);
		const view = mount();
		await settle();
		await fireEvent.update(view.getByTestId('announcement-text'), 'Keep my edit');
		await fireEvent.click(view.getByTestId('announcement-save'));
		await settle();
		expect(api.mock.calls.every(([endpoint]) => endpoint === 'announcements')).toBe(true);
		expect((view.getByTestId('announcement-text') as HTMLTextAreaElement).value).toBe('Keep my edit');
		expect(view.getByTestId('announcement-save').hasAttribute('disabled')).toBe(true);
	});

	it('closes and aborts requests on account change, ignoring late results', async () => {
		let resolve!: (value: HomeAnnouncement[]) => void;
		api.mockImplementationOnce(() => new Promise<HomeAnnouncement[]>(done => { resolve = done; }));
		const view = mount();
		$i!.id = 'other-admin';
		await settle();
		expect(api.mock.calls[0][3]?.aborted).toBe(true);
		expect(view.emitted().closed).toHaveLength(1);
		resolve([first]);
		await settle();
		expect(view.queryByTestId('announcement-title')).toBeNull();
	});

	it('refuses to start an edit without administrator privileges', async () => {
		$i!.isAdmin = false;
		mount();
		await settle();
		expect(api).not.toHaveBeenCalled();
	});

	it('aborts a timed-out load and exposes retry without writing', async () => {
		api.mockImplementationOnce((_endpoint, _params, _token, signal) => new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('timeout')))));
		const view = mount();
		await vi.advanceTimersByTimeAsync(15_000);
		expect(api.mock.calls[0][3]?.aborted).toBe(true);
		expect(view.getByRole('alert')).toBeTruthy();
		expect(api).toHaveBeenCalledTimes(1);
	});
});
