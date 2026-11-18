/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, createApp, defineComponent, h, nextTick, shallowRef } from 'vue';
import type { App } from 'vue';
import type { ChatMessage } from '@/types/chat.js';
import { chatReplySummary } from '@/utility/chat-replies.js';
import { i18n } from '@/i18n.js';

const mocks = vi.hoisted(() => ({
	api: vi.fn(), transport: vi.fn(), scroll: vi.fn(), reset: vi.fn(),
	events: new Map<string, (value?: unknown) => void>(),
	streamEvents: new Map<string, () => void>(),
}));
vi.mock('@/i.js', () => ({ ensureSignin: () => ({ id: 'self', policies: { chatAvailability: 'available' } }) }));
vi.mock('@/router.js', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/page.js', () => ({ definePage: vi.fn() }));
vi.mock('@/stream.js', () => ({ useStream: () => ({ state: 'connected', useChannel: () => ({ on: (event: string, callback: (value?: unknown) => void) => mocks.events.set(event, callback), dispose: vi.fn() }), on: (event: string, callback: () => void) => mocks.streamEvents.set(event, callback), off: vi.fn() }) }));
vi.mock('@/utility/chat-api.js', () => ({ chatApi: mocks.api }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: mocks.transport }));
vi.mock('@/utility/chat-conversation-settings.js', () => ({ showChatConversationMenu: vi.fn() }));
vi.mock('@/composables/use-chat-outbox.js', () => ({ useChatOutbox: () => ({ items: shallowRef([]), queue: { confirm: vi.fn(), expire: vi.fn() }, listeners: new Set() }) }));
vi.mock('@/composables/use-chat-read.js', () => ({ useChatRead: () => ({ reset: mocks.reset }) }));
vi.mock('@/utility/chat-scroll-position.js', () => ({ ChatScrollPosition: class { refresh = vi.fn(); focusMessage = vi.fn(); dispose = vi.fn(); } }));
vi.mock('@@/js/scroll.js', () => ({ getScrollContainer: () => null }));
vi.mock('@/utility/timeline-date-separate.js', () => ({ makeDateSeparatedTimelineComputedRef: (messages: { value: ChatMessage[] }) => computed(() => messages.value.map(data => ({ id: data.id, type: 'item', data }))) }));
vi.mock('@/components/MkChatHistories.vue', () => ({ default: defineComponent({ render: () => null }) }));
vi.mock('@/components/MkVirtualTimelineItem.vue', () => ({ default: defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) }) }));
vi.mock('@/components/MkInfo.vue', () => ({ default: defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) }) }));
vi.mock('@/components/MkButton.vue', () => ({ default: defineComponent({ setup: (_, { slots }) => () => h('button', slots.default?.()) }) }));
vi.mock('@/pages/chat/XPendingMessage.vue', () => ({ default: defineComponent({ render: () => null }) }));
vi.mock('@/pages/chat/room.search.vue', () => ({ default: defineComponent({ render: () => null }) }));
vi.mock('@/pages/chat/room.form.vue', () => ({ default: defineComponent({ props: ['reply'], setup: props => () => h('div', { 'data-composer-reply': props.reply?.id ?? '' }) }) }));
vi.mock('@/pages/chat/XMessage.vue', () => ({ default: defineComponent({
	props: ['message'], emits: ['reply', 'openReply'], setup: (props, { emit }) => () => h('div', { 'data-message-id': props.message.id, 'data-quote-text': props.message.replyTo?.text ?? '' }, [
		h('button', { 'data-action': 'reply', onClick: () => emit('reply', props.message) }, 'reply'),
		props.message.replyToId ? h('button', { 'data-action': 'context', onClick: () => emit('openReply', props.message.replyToId) }, 'context') : null,
	]),
}) }));
import PrivateChat from '@/pages/chat/private.vue';

let app: App | undefined;
let host: HTMLElement;
let latest: ChatMessage[];
let states: Map<string, ChatMessage>;

function message(id: string, patch: Partial<ChatMessage> = {}): ChatMessage {
	return { id, fromUserId: 'peer', toUserId: 'self', toRoomId: null, text: id, createdAt: '2026-10-22T00:00:00.000Z', reactions: [], revision: 1, recalledAt: null, ...patch } as ChatMessage;
}

async function mount(): Promise<void> {
	host = document.createElement('div'); document.body.append(host);
	app = createApp(PrivateChat, { userId: 'peer' });
	app.component('PageWithHeader', defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) }));
	app.component('MkA', defineComponent({ setup: (_, { slots }) => () => h('a', slots.default?.()) }));
	app.component('MkLoading', { render: () => null });
	app.mount(host);
	await vi.waitFor(() => expect(host.querySelector('[data-message-id="latest"]')).not.toBeNull());
}

beforeEach(() => {
	vi.clearAllMocks(); mocks.events.clear(); mocks.streamEvents.clear();
	const target = message('target');
	latest = [message('latest', { replyToId: target.id, replyTo: chatReplySummary(target) })];
	states = new Map([...latest, target].map(value => [value.id, value]));
	vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
	vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(mocks.scroll);
	mocks.transport.mockImplementation(async (endpoint: string) => endpoint === 'users/show' ? { id: 'peer', host: null, canChat: true } : latest);
	mocks.api.mockImplementation(async (endpoint: string, data: { messageIds: string[] }) => {
		if (endpoint === 'chat/messages/state') return { messages: data.messageIds.flatMap(id => states.get(id) ? [states.get(id)] : []), missingIds: data.messageIds.filter(id => !states.has(id)) };
		throw new Error('Unexpected API');
	});
});
afterEach(() => { app?.unmount(); app = undefined; host?.remove(); vi.restoreAllMocks(); });

describe('private conversation context integration', () => {
	it('reconciles an unloaded quoted target on foreground without inserting or reading it', async () => {
		await mount();
		states.set('target', message('target', { revision: 2, text: 'edited in background' }));
		document.dispatchEvent(new Event('visibilitychange'));
		await vi.waitFor(() => expect(host.querySelector('[data-message-id="latest"]')?.getAttribute('data-quote-text')).toBe('edited in background'));
		expect(host.querySelector('[data-message-id="target"]')).toBeNull();
		expect(mocks.api.mock.calls.some(call => call[0] === 'chat/messages/read')).toBe(false);
		expect(mocks.api.mock.calls.filter(call => call[0] === 'chat/messages/state').every(call => call[1].messageIds.length <= 100)).toBe(true);
	});
	it('loads bounded context, keeps update-only events out of the window, then returns to latest', async () => {
		await mount();
		let resolve!: (value: unknown) => void;
		mocks.api.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
		(host.querySelector('[data-action="context"]') as HTMLButtonElement).click();
		mocks.events.get('updated')?.(message('older-unloaded', { revision: 2 }));
		resolve({ messages: [message('target'), ...Array.from({ length: 40 }, (_, index) => message(String(index).padStart(4, '0')))], hasOlder: true, hasNewer: true });
		await vi.waitFor(() => expect(host.querySelectorAll('[data-message-id]')).toHaveLength(41));
		expect(host.querySelector('[data-message-id="older-unloaded"]')).toBeNull();
		expect(mocks.scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'instant' });
		expect(host.textContent).toContain(i18n.ts._chatDaily.contextViewing);
		const newest = Array.from(host.querySelectorAll('button')).find(button => button.textContent === i18n.ts._chatPro.newest)!;
		newest.click();
		await vi.waitFor(() => expect(host.querySelectorAll('[data-message-id]')).toHaveLength(1));
		expect(host.querySelector('[data-message-id="latest"]')).not.toBeNull();
		expect(host.textContent).not.toContain(i18n.ts._chatDaily.contextViewing);
	});
	it('keeps the existing window on unavailable context and ignores a late response after disposal', async () => {
		await mount();
		mocks.api.mockRejectedValueOnce({ code: 'NO_SUCH_MESSAGE' });
		(host.querySelector('[data-action="context"]') as HTMLButtonElement).click();
		await vi.waitFor(() => expect(host.textContent).toContain(i18n.ts._chatDaily.contextFailed));
		expect(host.querySelector('[data-message-id="latest"]')).not.toBeNull();
		let resolve!: (value: unknown) => void;
		mocks.api.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
		(host.querySelector('[data-action="context"]') as HTMLButtonElement).click();
		const signal = mocks.api.mock.calls.at(-1)![2] as AbortSignal;
		app!.unmount(); app = undefined;
		expect(signal.aborted).toBe(true);
		resolve({ messages: [message('target')], hasOlder: false, hasNewer: false });
		await nextTick(); await nextTick();
		expect(mocks.scroll).not.toHaveBeenCalled();
	});
});
