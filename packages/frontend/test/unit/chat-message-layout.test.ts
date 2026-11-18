/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, reactive, shallowRef, triggerRef } from 'vue';
import type { App, Component } from 'vue';
import type * as Misskey from 'misskey-js';
import type { ChatOutboxItem } from '@/types/chat.js';

const { account } = vi.hoisted(() => ({ account: { id: 'self', username: 'self', policies: { chatAvailability: 'available' } } }));
vi.mock('@/i.js', () => ({ ensureSignin: () => account }));
vi.mock('@/i18n.js', () => ({ i18n: { ts: { more: 'more', _chatPro: new Proxy({}, { get: (_, key) => key }) } } }));
vi.mock('@/preferences.js', () => ({ prefer: { s: { useStickyIcons: true, 'chat.showSenderName': true, animation: false } } }));
vi.mock('@/os.js', () => ({}));
vi.mock('@/utility/sound.js', () => ({}));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: vi.fn() }));
vi.mock('@/utility/chat-api.js', () => ({ chatApi: vi.fn() }));
vi.mock('@/utility/reaction-picker.js', () => ({ reactionPicker: {} }));
vi.mock('@/components/MkUrlPreview.vue', () => ({ default: { render: () => null } }));
vi.mock('@/components/MkMediaList.vue', () => ({ default: { render: () => null } }));
vi.mock('@/components/MkReactionIcon.vue', () => ({ default: { render: () => null } }));
vi.mock('@/pages/chat/XAttachment.vue', () => ({ default: { render: () => null } }));
import XMessage from '@/pages/chat/XMessage.vue';
import XPendingMessage from '@/pages/chat/XPendingMessage.vue';
import privateStyle from '@/pages/chat/private-message-layout.module.scss';

let app: App | undefined;
let host: HTMLElement;

function mount(component: Component, props: Record<string, unknown>): void {
	host = window.document.createElement('div');
	window.document.body.append(host);
	app = createApp({ render: () => h(component, { ...props }) });
	app.component('MkAvatar', defineComponent({ props: ['user'], setup: () => () => h('div', { 'data-avatar': '' }) }));
	app.component('MkUserName', defineComponent({ props: ['user'], setup: () => () => h('span', 'sender') }));
	// eslint-disable-next-line vue/multi-word-component-names -- Match the existing global component name.
	app.component('Mfm', defineComponent({ props: ['text'], setup: p => () => h('span', p.text) }));
	app.component('MkTime', defineComponent({ props: ['time', 'mode'], setup: p => () => h('time', { datetime: p.time, 'data-mode': p.mode ?? 'relative' }, '1 hour ago') }));
	app.component('MkA', defineComponent({ setup: (_, { slots }) => () => h('a', slots.default?.()) }));
	app.mount(host);
}

function message(changes: Record<string, unknown> = {}): Misskey.entities.ChatMessage {
	return {
		id: 'message', createdAt: '2026-10-12T10:00:00Z', fromUserId: account.id,
		fromUser: account, toUserId: 'peer', toRoomId: null, text: 'message text',
		file: null, fileId: null, reactions: [], readAt: null, readState: 'unknown',
		...changes,
	} as unknown as Misskey.entities.ChatMessage;
}

function pending(status: ChatOutboxItem['status']): ChatOutboxItem {
	return { snapshot: { clientMessageId: 'original-nonce', toUserId: 'peer', text: 'queued text' }, createdAt: '2026-10-12T10:00:00Z', status };
}

afterEach(() => { app?.unmount(); app = undefined; host?.remove(); });

describe('private message presentation isolation', () => {
	it('keeps the existing shared layout unless the private conversation explicitly opts in', () => {
		mount(XMessage, { message: message(), isSearchResult: true });
		expect(host.querySelector(`.${privateStyle.root}`)).toBeNull();
		expect(host.querySelector('time')?.parentElement?.querySelector(':scope > button[aria-label="more"]')).not.toBeNull();
		expect(host.querySelector('time')?.getAttribute('data-mode')).toBe('relative');
	});
	it('groups private metadata without moving it inside the bubble or changing the read meaning', async () => {
		const props = reactive({ message: message({ editedAt: '2026-10-12T10:01:00Z' }), privateLayout: true });
		mount(XMessage, props);
		expect(host.querySelector(`.${privateStyle.root}.${privateStyle.isMe}`)).not.toBeNull();
		const details = host.querySelector(`.${privateStyle.details}`)!;
		expect(details.textContent).toContain('1 hour ago');
		expect(details.textContent).toContain('edited');
		expect(details.textContent).toContain('sent');
		expect(details.textContent).not.toContain('read');
		expect(details.closest(`.${privateStyle.bubble}`)).toBeNull();
		expect(details.parentElement?.querySelector(':scope > button[aria-label="more"]')).not.toBeNull();
		expect(host.querySelector('time')?.getAttribute('data-mode')).toBe('relative');
		props.message = message({ readAt: '2026-10-12T10:02:00Z', readState: 'read' });
		await nextTick();
		expect(details.textContent).toContain('read');
		expect(details.textContent).not.toContain('sent');
	});
	it('keeps incoming messages left-oriented and does not invent a sender read status', () => {
		mount(XMessage, { message: message({ fromUserId: 'peer', fromUser: { id: 'peer' }, toUserId: account.id }), privateLayout: true });
		expect(host.querySelector(`.${privateStyle.root}.${privateStyle.isMe}`)).toBeNull();
		expect(host.querySelector(`.${privateStyle.header}`)?.textContent).toBe('sender');
		expect(host.querySelector(`.${privateStyle.details}`)?.textContent).toBe('1 hour ago');
	});
	it('preserves recalled placeholders without exposing the old text or edited/read labels', () => {
		mount(XMessage, { message: message({ recalledAt: '2026-10-12T10:03:00Z', editedAt: '2026-10-12T10:01:00Z', readAt: '2026-10-12T10:02:00Z' }), privateLayout: true });
		expect(host.textContent).toContain('recalled');
		expect(host.textContent).not.toContain('message text');
		expect(host.querySelector(`.${privateStyle.details}`)?.textContent).toBe('1 hour ago');
	});
});

describe('pending private message presentation', () => {
	it('retries and discards using the original nonce without marking the pending message readable', () => {
		const retry = vi.fn();
		const discard = vi.fn();
		mount(XPendingMessage, { item: pending('failed'), status: 'failed', user: account, onRetry: retry, onDiscard: discard });
		expect(host.querySelector(`.${privateStyle.root}.${privateStyle.isMe}`)).not.toBeNull();
		expect(host.querySelector('[data-chat-readable]')).toBeNull();
		expect(host.querySelector('[data-chat-pending]')?.getAttribute('data-chat-pending')).toBe('original-nonce');
		const buttons = host.querySelectorAll('button');
		buttons[0].click();
		buttons[1].click();
		expect(retry).toHaveBeenCalledWith('original-nonce');
		expect(discard).toHaveBeenCalledWith('original-nonce');
	});
	it('cannot discard an in-flight message or retry an expired attachment', async () => {
		const props = reactive({ item: pending('sending'), status: 'sending', user: account });
		mount(XPendingMessage, props);
		expect(host.querySelectorAll('button')).toHaveLength(0);
		expect(host.textContent).toContain('sending');
		props.item = pending('expired');
		props.status = 'expired';
		await nextTick();
		expect(host.querySelectorAll('button')).toHaveLength(1);
		expect(host.querySelector('button')?.textContent).toBe('discardPending');
		expect(host.querySelector('[role="alert"]')?.textContent).toBe('expiredPending');
	});
	it('renders failed status when the shallow outbox mutates an existing item', async () => {
		const item = pending('sending');
		const items = shallowRef([item]);
		mount(XPendingMessage, { get item() { return items.value[0]; }, get status() { return items.value[0].status; }, user: account });
		expect(host.querySelectorAll('button')).toHaveLength(0);
		item.status = 'failed';
		triggerRef(items);
		await nextTick();
		expect(host.querySelectorAll('button')).toHaveLength(2);
		expect(host.textContent).toContain('failed');
		expect(host.textContent).not.toContain('sending');
	});
});
