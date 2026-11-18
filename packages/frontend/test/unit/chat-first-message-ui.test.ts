/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import locales from 'i18n';
import type { App } from 'vue';
import type * as Misskey from 'misskey-js';
import type { ChatAttachment, ChatOutboxItem } from '@/types/chat.js';
import { updateI18n } from '@/i18n.js';

const mocks = vi.hoisted(() => ({ upload: vi.fn(), api: vi.fn(), abort: vi.fn() }));
vi.mock('@/utility/chat-media.js', () => ({ CHAT_ATTACHMENT_LIMIT: 10, uploadChatAttachment: mocks.upload }));
vi.mock('@/utility/chat-api.js', () => ({ chatApi: mocks.api }));
vi.mock('@/utility/drive.js', () => ({ chooseDriveFile: vi.fn() }));
vi.mock('@/os.js', () => ({ alert: vi.fn(), popupMenu: vi.fn() }));
vi.mock('@/components/MkFukidashi.vue', () => ({ default: defineComponent({ setup: (_, { slots }) => () => h('div', { 'data-bubble': '' }, slots.default?.()) }) }));
vi.mock('@/pages/chat/XVoiceRecorder.vue', () => ({ default: defineComponent({ emits: ['recorded'], setup: (_, { emit }) => () => h('button', { 'data-record': '', onClick: () => emit('recorded', new File(['audio'], 'voice.webm')) }, 'record') }) }));
import PendingMessage from '@/pages/chat/XPendingMessage.vue';
import AttachmentComposer from '@/pages/chat/XAttachmentComposer.vue';

let app: App | undefined;
let host: HTMLDivElement;
const replyRequired = '对方未回复之前只能发送一条消息，等对方回复以后才可以继续留言';
const textOnly = '对方回复前仅支持发送一条文字消息';

beforeEach(() => {
	vi.clearAllMocks();
	updateI18n(locales['zh-CN']);
	host = document.createElement('div');
	document.body.append(host);
	mocks.upload.mockImplementation(() => ({ promise: Promise.reject({ code: 'CHAT_FIRST_MESSAGE_TEXT_ONLY', message: 'server secret' }), abort: mocks.abort }));
	mocks.api.mockRejectedValue({ code: 'CHAT_FIRST_MESSAGE_TEXT_ONLY', message: 'server secret' });
});
afterEach(() => { app?.unmount(); app = undefined; host.remove(); updateI18n(locales['en-US']); });

describe('Private first-message sender UI', () => {
	it('renders the exact business hint below the sender bubble and retries only on a click', async () => {
		const item: ChatOutboxItem = { snapshot: { clientMessageId: 'same-nonce', toUserId: 'peer', text: 'retained original' }, status: 'failed', failureCode: 'CHAT_REPLY_REQUIRED', createdAt: new Date().toISOString() };
		const status = ref(item.status);
		const code = ref(item.failureCode);
		const retry = vi.fn();
		const discard = vi.fn();
		app = createApp({ setup: () => () => h(PendingMessage, { item, status: status.value, failureCode: code.value, user: { id: 'self' } as Misskey.entities.UserLite, onRetry: retry, onDiscard: discard }) });
		app.component('MkAvatar', { render: () => null });
		// Match the application's existing global Mfm component name.
		// eslint-disable-next-line vue/multi-word-component-names
		app.component('Mfm', defineComponent({ props: ['text'], setup: props => () => h('div', props.text) }));
		app.mount(host);
		expect(host.querySelector('[role="alert"]')?.textContent?.trim()).toBe(replyRequired);
		expect(host.querySelector('[data-bubble]')?.nextElementSibling?.getAttribute('role')).toBe('alert');
		expect(host.querySelector('[data-chat-pending="same-nonce"]')).not.toBeNull();
		expect(retry).not.toHaveBeenCalled();
		code.value = 'CHAT_FIRST_MESSAGE_TEXT_ONLY';
		await nextTick();
		expect(host.querySelector('[role="alert"]')?.textContent?.trim()).toBe(textOnly);
		expect(retry).not.toHaveBeenCalled();
		host.querySelector('button')!.click();
		expect(retry).toHaveBeenCalledExactlyOnceWith('same-nonce');
		status.value = 'sending'; code.value = undefined;
		await nextTick();
		expect(host.querySelector('[role="alert"]')).toBeNull();
		expect(host.querySelector('button')).toBeNull();
		expect(retry).toHaveBeenCalledOnce();
	});
	it.each(['file', 'drive', 'voice'] as const)('shows the safe attachment restriction for %s and retains an explicit retry/removal', async (kind) => {
		const attachments = ref<ChatAttachment[]>([]);
		const busy = vi.fn();
		const composer = ref<InstanceType<typeof AttachmentComposer>>();
		app = createApp({ setup: () => () => h(AttachmentComposer, { ref: composer, userId: 'peer', modelValue: attachments.value, 'onUpdate:modelValue': values => { attachments.value = values; }, onBusy: busy }) });
		app.mount(host);
		if (kind === 'drive') composer.value!.addDriveFiles([{ id: 'drive-id', name: 'document.txt' }]);
		else if (kind === 'voice') { composer.value!.toggleRecording(); await nextTick(); (host.querySelector('[data-record]') as HTMLButtonElement).click(); } else composer.value!.addFiles([new File(['text'], 'document.txt')]);
		await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toBe(textOnly));
		expect(host.textContent).not.toContain('server secret');
		expect(attachments.value).toHaveLength(0);
		expect(busy).toHaveBeenLastCalledWith(true);
		const attempts = () => kind === 'drive' ? mocks.api.mock.calls.length : mocks.upload.mock.calls.length;
		expect(attempts()).toBe(1);
		await nextTick();
		expect(attempts()).toBe(1);
		host.querySelector('button')!.click();
		await vi.waitFor(() => expect(attempts()).toBe(2));
		if (kind === 'voice') expect(mocks.upload.mock.calls[0][2]).toBe('voice');
		(host.querySelector('button[aria-label]') as HTMLButtonElement).click();
		await nextTick();
		expect(host.querySelector('[role="alert"]')).toBeNull();
		expect(busy).toHaveBeenLastCalledWith(false);
	});
	it('keeps unknown attachment failures generic instead of rendering remote error text', async () => {
		mocks.upload.mockImplementation(() => ({ promise: Promise.reject({ code: 'INTERNAL', message: '<img src=x onerror=alert(1)>' }), abort: mocks.abort }));
		app = createApp(AttachmentComposer, { userId: 'peer', modelValue: [] });
		const component = app.mount(host) as InstanceType<typeof AttachmentComposer>;
		component.addFiles([new File(['text'], 'document.txt')]);
		await vi.waitFor(() => expect(host.textContent).toContain('上传失败'));
		expect(host.querySelector('[role="alert"]')).toBeNull();
		expect(host.querySelector('img')).toBeNull();
		expect(host.textContent).not.toContain('onerror');
	});
});
