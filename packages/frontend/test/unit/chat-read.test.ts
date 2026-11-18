/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, KeepAlive, nextTick, onBeforeUnmount, ref } from 'vue';
import type { App } from 'vue';
import type { ChatMessage } from '@/types/chat.js';

const state = vi.hoisted(() => ({ api: vi.fn(), popups: { value: [] as unknown[] } }));
vi.mock('@/utility/chat-api.js', () => ({ chatApi: state.api }));
vi.mock('@/os.js', () => ({ popups: state.popups }));
vi.mock('@@/js/scroll.js', () => ({ getScrollContainer: () => null }));
import { useChatRead } from '@/composables/use-chat-read.js';

let app: App | undefined;
let host: HTMLElement;
let row: HTMLElement;
let enabled: boolean;
let generation: number;
const merge = vi.fn();

function mount(messages: ChatMessage[] = [{ id: 'incoming', fromUserId: 'bob' } as ChatMessage]): void {
	host = window.document.createElement('div');
	window.document.body.append(host);
	app = createApp({ setup() {
		useChatRead({ root: () => host, enabled: () => enabled, generation: () => generation, userId: 'bob', accountId: 'alice', messages: () => messages, merge });
		return () => h('div', { 'data-chat-readable': 'incoming' }, 'message');
	} });
	app.mount(host);
	row = host.firstElementChild as HTMLElement;
	vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 100, 200, 80));
	vi.spyOn(window.document, 'elementFromPoint').mockImplementation(() => row);
}

beforeEach(() => {
	vi.useFakeTimers();
	enabled = true;
	generation = 0;
	state.popups.value = [];
	state.api.mockReset().mockResolvedValue({ messages: [] });
	merge.mockReset();
	vi.spyOn(window.document, 'hasFocus').mockReturnValue(true);
	vi.spyOn(window.document, 'hidden', 'get').mockReturnValue(false);
});
afterEach(() => { app?.unmount(); app = undefined; host?.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Chat visible read gate', () => {
	it('stops the reader timer while its real KeepAlive component is cached', async () => {
		const visible = ref(true);
		const unmounted = vi.fn();
		const getRoot = vi.fn(() => host);
		const intervals = vi.spyOn(window, 'setInterval');
		host = window.document.createElement('div');
		window.document.body.append(host);
		const reader = { setup() {
			useChatRead({ root: getRoot, enabled: () => enabled, generation: () => generation, userId: 'bob', accountId: 'alice', messages: () => [], merge });
			onBeforeUnmount(unmounted);
			return () => h('div', 'reader');
		} };
		const other = { render: () => h('div', 'other page') };
		app = createApp({ render: () => h(KeepAlive, null, { default: () => visible.value ? h(reader) : h(other) }) });
		app.mount(host);
		await nextTick();
		expect(intervals.mock.calls.filter(call => call[1] === 150)).toHaveLength(1);
		visible.value = false;
		await nextTick();
		expect(unmounted).not.toHaveBeenCalled();
		getRoot.mockClear();
		await vi.advanceTimersByTimeAsync(900);
		expect(getRoot).not.toHaveBeenCalled();
		visible.value = true;
		await nextTick();
		expect(intervals.mock.calls.filter(call => call[1] === 150)).toHaveLength(2);
		await vi.advanceTimersByTimeAsync(300);
		expect(getRoot).toHaveBeenCalled();
	});
	it('aborts a cached reader request and ignores its late response after reactivation', async () => {
		const visible = ref(true);
		const pending: ((value: { messages: ChatMessage[] }) => void)[] = [];
		state.api.mockImplementation(() => new Promise(resolve => { pending.push(resolve); }));
		host = window.document.createElement('div');
		window.document.body.append(host);
		const reader = { setup() {
			useChatRead({ root: () => host, enabled: () => enabled, generation: () => generation, userId: 'bob', accountId: 'alice', messages: () => [{ id: 'incoming', fromUserId: 'bob' } as ChatMessage], merge });
			return () => h('div', { 'data-chat-readable': 'incoming' }, 'message');
		} };
		const other = { render: () => h('div', 'other page') };
		app = createApp({ render: () => h(KeepAlive, null, { default: () => visible.value ? h(reader) : h(other) }) });
		app.mount(host);
		row = host.firstElementChild as HTMLElement;
		vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 100, 200, 80));
		vi.spyOn(window.document, 'elementFromPoint').mockImplementation(() => row);
		await vi.advanceTimersByTimeAsync(750);
		expect(state.api).toHaveBeenCalledOnce();
		const previousSignal = state.api.mock.calls[0][2] as AbortSignal;
		visible.value = false;
		await nextTick();
		expect(previousSignal.aborted).toBe(true);
		visible.value = true;
		await nextTick();
		pending[0]({ messages: [{ id: 'incoming', readAt: 'old' } as ChatMessage] });
		await Promise.resolve();
		expect(merge).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(450);
		expect(state.api).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(300);
		expect(state.api).toHaveBeenCalledTimes(2);
		expect(state.api.mock.calls[1][2].aborted).toBe(false);
		pending[1]({ messages: [{ id: 'incoming', readAt: 'current' } as ChatMessage] });
		await Promise.resolve();
		expect(merge).toHaveBeenCalledWith([{ id: 'incoming', readAt: 'current' }]);
	});
	it('does not read overscan, hidden or occluded messages and requires a fresh 500ms dwell', async () => {
		mount();
		vi.mocked(row.getBoundingClientRect).mockReturnValue(new DOMRect(10, 2000, 200, 80));
		await vi.advanceTimersByTimeAsync(900);
		expect(state.api).not.toHaveBeenCalled();
		vi.mocked(row.getBoundingClientRect).mockReturnValue(new DOMRect(10, 100, 200, 80));
		state.popups.value = [{}];
		await vi.advanceTimersByTimeAsync(900);
		expect(state.api).not.toHaveBeenCalled();
		state.popups.value = [];
		vi.mocked(window.document.elementFromPoint).mockReturnValue(host);
		await vi.advanceTimersByTimeAsync(900);
		expect(state.api).not.toHaveBeenCalled();
		vi.mocked(window.document.elementFromPoint).mockReturnValue(row);
		await vi.advanceTimersByTimeAsync(450);
		expect(state.api).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(300);
		expect(state.api).toHaveBeenCalledWith('chat/messages/read', { userId: 'bob', messageIds: ['incoming'] }, expect.any(AbortSignal));
	});
	it('never reads an outgoing message or a delivery received while inactive', async () => {
		mount([{ id: 'incoming', fromUserId: 'alice' } as ChatMessage]);
		await vi.advanceTimersByTimeAsync(900);
		expect(state.api).not.toHaveBeenCalled();
		app?.unmount(); host.remove();
		enabled = false;
		mount();
		await vi.advanceTimersByTimeAsync(900);
		expect(state.api).not.toHaveBeenCalled();
	});
	it('ignores a read response from the previous reconnect generation', async () => {
		let resolve!: (value: { messages: ChatMessage[] }) => void;
		state.api.mockImplementation(() => new Promise(done => { resolve = done; }));
		mount();
		await vi.advanceTimersByTimeAsync(750);
		expect(state.api).toHaveBeenCalledOnce();
		generation++;
		resolve({ messages: [{ id: 'incoming', readAt: 'now' } as ChatMessage] });
		await Promise.resolve();
		expect(merge).not.toHaveBeenCalled();
	});
});
