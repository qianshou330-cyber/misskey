/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, KeepAlive, nextTick, ref } from 'vue';
import type { App } from 'vue';
import type * as Misskey from 'misskey-js';
import type { ChatMessage, ChatSendSnapshot } from '@/types/chat.js';
import { i18n } from '@/i18n.js';
import { preferState } from '../setup.unit.js';

const mocks = vi.hoisted(() => ({
	enqueue: vi.fn(),
	persistent: { value: true },
	listeners: new Set<(message: ChatMessage) => void>(),
	alert: vi.fn(),
	emojiShow: vi.fn(),
	detach: vi.fn(),
	device: { kind: 'desktop' },
	attachmentMounts: 0,
}));
vi.mock('@/i.js', () => ({ ensureSignin: () => ({ id: 'self', policies: { chatAvailability: 'available' } }) }));
vi.mock('@/composables/use-chat-outbox.js', () => ({ useChatOutbox: () => ({ queue: { enqueue: mocks.enqueue, items: [] }, persistent: mocks.persistent, listeners: mocks.listeners }) }));
vi.mock('@/utility/autocomplete.js', () => ({ Autocomplete: class { public detach = mocks.detach; } }));
vi.mock('@/utility/device-kind.js', () => ({ get deviceKind() { return mocks.device.kind; } }));
vi.mock('@/utility/emoji-picker.js', () => ({ emojiPicker: { show: mocks.emojiShow } }));
vi.mock('@/os.js', () => ({ alert: mocks.alert }));
vi.mock('@/utility/drive.js', () => ({ selectFile: vi.fn() }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: vi.fn() }));
vi.mock('@/local-storage.js', () => ({ miLocalStorage: { getItem: () => null, setItem: vi.fn() } }));
vi.mock('@/pages/chat/XAttachmentComposer.vue', () => ({ default: defineComponent({
	setup(_, { expose }) {
		mocks.attachmentMounts++;
		expose({ canAddAttachments: true, recording: false });
		return () => h('div');
	},
}) }));
import Composer from '@/pages/chat/room.form.vue';

let app: App | undefined;
let host: HTMLElement;
let width = 393;
let contentHeight = 44;
let frameId = 0;
const frames = new Map<number, FrameRequestCallback>();
const observers: { callback: ResizeObserverCallback; disconnect: ReturnType<typeof vi.fn> }[] = [];
let viewport: EventTarget & { height: number };
const user = { id: 'peer', canChat: true, host: null } as Misskey.entities.UserDetailed;

async function frame(): Promise<void> {
	await nextTick();
	const callbacks = [...frames.values()];
	frames.clear();
	for (const callback of callbacks) callback(0);
	await nextTick();
}

function mount(props: Record<string, unknown> = { user }): HTMLTextAreaElement {
	host = window.document.createElement('div');
	window.document.body.append(host);
	app = createApp(Composer, props);
	app.component('MkLoading', { render: () => null });
	app.mount(host);
	return host.querySelector('textarea')!;
}

async function input(textarea: HTMLTextAreaElement, value: string): Promise<void> {
	textarea.value = value;
	textarea.dispatchEvent(new Event('input', { bubbles: true }));
	await nextTick();
}

function send(): void {
	host.querySelectorAll('button')[3].click();
}

function openEmoji(textarea: HTMLTextAreaElement): () => void {
	textarea.focus();
	const emojiButton = host.querySelectorAll('button')[2];
	emojiButton.dispatchEvent(new Event('pointerdown'));
	emojiButton.focus();
	emojiButton.click();
	return mocks.emojiShow.mock.calls.at(-1)![2];
}

beforeEach(() => {
	vi.clearAllMocks();
	width = 393;
	contentHeight = 44;
	frames.clear();
	observers.length = 0;
	mocks.attachmentMounts = 0;
	mocks.device.kind = 'desktop';
	mocks.persistent.value = true;
	mocks.listeners.clear();
	mocks.enqueue.mockImplementation(() => new Promise(() => undefined));
	mocks.alert.mockResolvedValue(undefined);
	preferState['chat.sendOnEnter'] = true;
	viewport = Object.assign(new EventTarget(), { height: 800 });
	Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
	vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++frameId, callback); return frameId; });
	vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
	vi.spyOn(window.document, 'hasFocus').mockReturnValue(true);
	vi.spyOn(window.document, 'hidden', 'get').mockReturnValue(false);
	vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
	vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => contentHeight);
	vi.stubGlobal('ResizeObserver', class {
		public disconnect = vi.fn();
		public constructor(callback: ResizeObserverCallback) { observers.push({ callback, disconnect: this.disconnect }); }
		public observe(): void {}
	});
});

afterEach(() => {
	app?.unmount();
	app = undefined;
	host?.remove();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('Private mobile composer sizing', () => {
	it('sends a removable quoted target with the draft and preserves attachment composer lifetime', async () => {
		const reply = { id: 'quoted', fromUserId: 'peer', text: 'quoted text', attachmentTypes: [], revision: 1, recalledAt: null, unavailable: false };
		const changed = vi.fn();
		const textarea = mount({ user, reply, 'onUpdate:reply': changed });
		await input(textarea, 'response');
		const buttons = Array.from(host.querySelectorAll('button'));
		buttons.find(button => button.getAttribute('aria-label') === i18n.ts.send)!.click();
		await nextTick();
		expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({ replyToId: 'quoted', text: 'response', toUserId: 'peer' }));
		expect(changed).toHaveBeenCalledWith(null);
		expect(mocks.attachmentMounts).toBe(1);
	});
	it('retains the typed draft when a recalled quote blocks sending, and permits removing the quote', async () => {
		const changed = vi.fn();
		const textarea = mount({ user, reply: { id: 'quoted', fromUserId: 'self', text: null, attachmentTypes: [], revision: 2, recalledAt: 'now', unavailable: false }, 'onUpdate:reply': changed });
		await input(textarea, 'keep this draft');
		const buttons = Array.from(host.querySelectorAll('button'));
		expect(buttons.find(button => button.getAttribute('aria-label') === i18n.ts.send)!.disabled).toBe(true);
		buttons.find(button => button.getAttribute('aria-label') === i18n.ts._chatDaily.cancelReply)!.click();
		expect(changed).toHaveBeenCalledWith(null);
		expect(textarea.value).toBe('keep this draft');
		expect(mocks.enqueue).not.toHaveBeenCalled();
	});
	it('starts at 48px, grows, caps to the keyboard viewport, and shrinks without remounting attachments', async () => {
		const textarea = mount();
		await frame();
		expect(textarea.getAttribute('rows')).toBe('1');
		expect(textarea.style.height).toBe('48px');
		expect(textarea.style.padding).toBe('12px');
		contentHeight = 120;
		await input(textarea, 'several lines');
		await frame();
		expect(textarea.style.height).toBe('120px');
		contentHeight = 300;
		viewport.height = 300;
		viewport.dispatchEvent(new Event('resize'));
		await frame();
		expect(textarea.style.height).toBe('90px');
		expect(textarea.style.overflowY).toBe('auto');
		contentHeight = 44;
		await input(textarea, '');
		await frame();
		expect(textarea.style.height).toBe('48px');
		expect(textarea.style.overflowY).toBe('hidden');
		expect(mocks.attachmentMounts).toBe(1);
	});
	it('keeps the desktop and group 80px minimum while smartphones remain compact in landscape', async () => {
		width = 757;
		const textarea = mount();
		await frame();
		expect(textarea.style.height).toBe('80px');
		mocks.device.kind = 'smartphone';
		window.dispatchEvent(new Event('resize'));
		await frame();
		expect(textarea.style.height).toBe('48px');
		app!.unmount();
		host.remove();
		const group = mount({ room: { id: 'room' } });
		await frame();
		expect(group.getAttribute('rows')).toBe('2');
		expect(group.style.height).toBe('80px');
	});
	it('batches width and viewport events, emits anchor hooks, and releases observers and pending frames', async () => {
		const before = vi.fn();
		const after = vi.fn();
		const textarea = mount({ user, onBeforeResize: before, onAfterResize: after });
		await frame();
		before.mockClear(); after.mockClear();
		width = 757;
		observers[0].callback([], {} as ResizeObserver);
		viewport.dispatchEvent(new Event('resize'));
		viewport.dispatchEvent(new Event('scroll'));
		window.dispatchEvent(new Event('resize'));
		expect(frames.size).toBe(1);
		await frame();
		expect(before).toHaveBeenCalledOnce();
		expect(after).toHaveBeenCalledOnce();
		expect(textarea.style.height).toBe('80px');
		viewport.dispatchEvent(new Event('resize'));
		app!.unmount(); app = undefined;
		expect(observers[0].disconnect).toHaveBeenCalledOnce();
		expect(frames.size).toBe(0);
		viewport.dispatchEvent(new Event('resize'));
		window.dispatchEvent(new Event('resize'));
		expect(frames.size).toBe(0);
	});
	it('never lets an extremely short visual viewport reduce the input below 48px', async () => {
		viewport.height = 100;
		contentHeight = 200;
		const textarea = mount();
		await frame();
		expect(textarea.style.height).toBe('48px');
		expect(textarea.style.maxHeight).toBe('48px');
	});
});

describe('Private composer sending and focus', () => {
	it('dismisses the keyboard as soon as queued, without waiting for the network', async () => {
		const textarea = mount();
		await input(textarea, 'queued text');
		textarea.focus();
		send();
		await nextTick();
		expect(mocks.enqueue).toHaveBeenCalledOnce();
		expect(window.document.activeElement).not.toBe(textarea);
		expect(textarea.value).toBe('');
		await input(textarea, 'next draft');
		const snapshot = mocks.enqueue.mock.calls[0][0] as ChatSendSnapshot;
		for (const listener of mocks.listeners) listener({ clientMessageId: snapshot.clientMessageId } as ChatMessage);
		await nextTick();
		expect(textarea.value).toBe('next draft');
	});
	it('keeps the live draft and focus when the queue rejects the message', async () => {
		mocks.enqueue.mockImplementation(() => { throw new Error('CHAT_OUTBOX_FULL'); });
		const textarea = mount();
		await input(textarea, 'keep draft');
		textarea.focus();
		send();
		await nextTick();
		expect(textarea.value).toBe('keep draft');
		expect(window.document.activeElement).toBe(textarea);
		expect(host.querySelector('[role="alert"]')).not.toBeNull();
		expect(mocks.alert).not.toHaveBeenCalled();
		await input(textarea, 'changed draft');
		expect(host.querySelector('[role="alert"]')).toBeNull();
	});
	it('clears an inline queue rejection after a successful retry without changing the frozen request text', async () => {
		mocks.enqueue.mockImplementationOnce(() => { throw new Error('CHAT_OUTBOX_FULL'); });
		const textarea = mount();
		await input(textarea, 'retry draft');
		textarea.focus();
		send();
		await nextTick();
		expect(host.querySelector('[role="alert"]')).not.toBeNull();
		send();
		await nextTick();
		expect(host.querySelector('[role="alert"]')).toBeNull();
		expect(window.document.activeElement).not.toBe(textarea);
		expect(mocks.enqueue.mock.calls[1][0].text).toBe('retry draft');
		expect(mocks.alert).not.toHaveBeenCalled();
	});
	it('does not misreport a nonpersistent transport failure as a rejected queue or restore focus', async () => {
		mocks.persistent.value = false;
		mocks.enqueue.mockRejectedValueOnce(new Error('NETWORK_FAILED'));
		const textarea = mount();
		await input(textarea, 'queued draft');
		textarea.focus();
		send();
		await Promise.resolve();
		await nextTick();
		expect(textarea.value).toBe('queued draft');
		expect(window.document.activeElement).not.toBe(textarea);
		expect(host.querySelector('[role="alert"]')).toBeNull();
		expect(mocks.alert).not.toHaveBeenCalled();
	});
	it('dismisses before a nonpersistent send settles and preserves a subsequently edited draft', async () => {
		mocks.persistent.value = false;
		let settle!: (value: boolean) => void;
		mocks.enqueue.mockImplementation(() => new Promise(resolve => { settle = resolve; }));
		const textarea = mount();
		await input(textarea, 'original');
		textarea.focus();
		send();
		expect(window.document.activeElement).not.toBe(textarea);
		await input(textarea, 'new draft while sending');
		const snapshot = mocks.enqueue.mock.calls[0][0] as ChatSendSnapshot;
		for (const listener of mocks.listeners) listener({ clientMessageId: snapshot.clientMessageId } as ChatMessage);
		settle(true);
		await nextTick();
		expect(textarea.value).toBe('new draft while sending');
		expect(window.document.activeElement).not.toBe(textarea);
	});
	it('does not dismiss desktop focus or submit while composing, and respects the Enter preference', async () => {
		width = 757;
		const textarea = mount();
		await input(textarea, 'draft');
		textarea.focus();
		textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
		textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Process', bubbles: true }));
		preferState['chat.sendOnEnter'] = false;
		textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(mocks.enqueue).not.toHaveBeenCalled();
		textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
		await nextTick();
		expect(mocks.enqueue).toHaveBeenCalledOnce();
		expect(window.document.activeElement).toBe(textarea);
	});
	it('accepts one touch pointerdown even if its later click is also delivered', async () => {
		const textarea = mount();
		await input(textarea, 'touch');
		const button = host.querySelectorAll('button')[3];
		const event = new Event('pointerdown', { cancelable: true });
		Object.defineProperty(event, 'pointerType', { value: 'touch' });
		button.dispatchEvent(event);
		button.click();
		await nextTick();
		expect(event.defaultPrevented).toBe(true);
		expect(mocks.enqueue).toHaveBeenCalledOnce();
	});
	it('restores an active emoji editing intent but does not reopen the keyboard after sending', async () => {
		const textarea = mount();
		await input(textarea, 'draft');
		const closeFirst = openEmoji(textarea);
		closeFirst();
		await nextTick();
		expect(window.document.activeElement).toBe(textarea);
		const closeSecond = openEmoji(textarea);
		send();
		closeSecond();
		await nextTick();
		expect(window.document.activeElement).not.toBe(textarea);
		expect(textarea.readOnly).toBe(false);
	});
	it('does not focus a previously dismissed editor when emoji selection closes', async () => {
		const textarea = mount();
		host.querySelectorAll('button')[2].click();
		mocks.emojiShow.mock.calls.at(-1)![2]();
		await nextTick();
		expect(window.document.activeElement).not.toBe(textarea);
	});
	it('ignores stale emoji selection and close after the page has been hidden', async () => {
		const textarea = mount();
		await input(textarea, 'keep');
		const close = openEmoji(textarea);
		vi.spyOn(window.document, 'hidden', 'get').mockReturnValue(true);
		window.document.dispatchEvent(new Event('visibilitychange'));
		mocks.emojiShow.mock.calls.at(-1)![1]('emoji');
		close();
		await nextTick();
		expect(textarea.value).toBe('keep');
		expect(window.document.activeElement).not.toBe(textarea);
		expect(textarea.readOnly).toBe(false);
	});
	it('invalidates emoji focus and resize work on KeepAlive deactivation, then reactivates cleanly', async () => {
		const visible = ref(true);
		host = window.document.createElement('div'); window.document.body.append(host);
		app = createApp({ render: () => h(KeepAlive, null, { default: () => visible.value ? h(Composer, { user }) : null }) });
		app.component('MkLoading', { render: () => null });
		app.mount(host);
		await frame();
		const textarea = host.querySelector('textarea')!;
		const close = openEmoji(textarea);
		visible.value = false;
		await nextTick();
		close();
		viewport.dispatchEvent(new Event('resize'));
		await nextTick();
		expect(window.document.activeElement).not.toBe(textarea);
		expect(frames.size).toBe(0);
		expect(observers[0].disconnect).toHaveBeenCalledOnce();
		visible.value = true;
		await frame();
		expect(host.querySelector('textarea')!.style.height).toBe('48px');
		expect(mocks.attachmentMounts).toBe(1);
	});
});
