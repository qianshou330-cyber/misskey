/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';
import type { App } from 'vue';
import type { ChatAttachment } from '@/types/chat.js';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), claim: vi.fn(), releaseAudio: vi.fn(), create: vi.fn() }));
vi.mock('@/i18n.js', () => ({ i18n: { ts: { _chatPro: new Proxy({}, { get: (_, key) => key }) } } }));
vi.mock('@/utility/chat-media.js', () => ({ fetchChatAttachment: mocks.fetch, claimChatAudio: mocks.claim, releaseChatAudio: mocks.releaseAudio, isChatMediaBudgetError: (error: Error) => error.message === 'CHAT_MEDIA_BUDGET' }));
vi.mock('wavesurfer.js', () => ({ default: { create: mocks.create } }));
import XVoiceMessage from '@/pages/chat/XVoiceMessage.vue';

type Handler = (...args: unknown[]) => void;
class FakePlayer {
	public handlers = new Map<string, Set<Handler>>();
	public load = vi.fn(async () => undefined);
	public play = vi.fn(async () => { this.emit('play'); });
	public pause = vi.fn(() => { this.emit('pause'); });
	public destroy = vi.fn();
	public on(event: string, handler: Handler): () => void {
		const handlers = this.handlers.get(event) ?? new Set<Handler>();
		handlers.add(handler);
		this.handlers.set(event, handlers);
		return () => handlers.delete(handler);
	}
	public emit(event: string, ...args: unknown[]): void { for (const handler of this.handlers.get(event) ?? []) handler(...args); }
}

let app: App | undefined;
let host: HTMLElement;
let player: FakePlayer;
let lease: { size: number; createObjectURL: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
const attachment = { id: 'synthetic-voice', size: 1024, durationMs: 2500, peaks: [0.2, 0.4, 0.1] } as ChatAttachment;

async function settle(): Promise<void> { for (let i = 0; i < 12; i++) { await Promise.resolve(); await nextTick(); } }

function playButton(): HTMLButtonElement { return host.querySelector('button')!; }

function hide(): void { vi.spyOn(window.document, 'hidden', 'get').mockReturnValue(true); window.document.dispatchEvent(new Event('visibilitychange')); }

function show(): void { vi.spyOn(window.document, 'hidden', 'get').mockReturnValue(false); window.document.dispatchEvent(new Event('visibilitychange')); }

beforeEach(() => {
	vi.spyOn(window.document, 'hidden', 'get').mockReturnValue(false);
	vi.clearAllMocks();
	player = new FakePlayer();
	lease = { size: 1024, createObjectURL: vi.fn(() => 'blob:voice'), release: vi.fn() };
	mocks.fetch.mockReset().mockResolvedValue(lease);
	mocks.create.mockReset().mockReturnValue(player);
	host = window.document.createElement('div');
	window.document.body.append(host);
	app = createApp(XVoiceMessage, { attachment });
	app.mount(host);
});
afterEach(() => { app?.unmount(); app = undefined; host.remove(); vi.restoreAllMocks(); });

describe('Chat voice playback lifecycle', () => {
	it('waits for decoding readiness before requesting playback', async () => {
		let ready!: () => void;
		player.load.mockImplementation(() => new Promise(resolve => { ready = () => resolve(undefined); }));
		playButton().click();
		await settle();
		expect(player.play).not.toHaveBeenCalled();
		expect(playButton().disabled).toBe(true);
		ready();
		await settle();
		expect(player.play).toHaveBeenCalledOnce();
		expect(mocks.claim).toHaveBeenCalledOnce();
		expect(playButton().getAttribute('aria-label')).toBe('pause');
	});
	it('releases a failed load and creates a fresh player and lease on retry', async () => {
		player.load.mockRejectedValueOnce(new Error('decode failed'));
		playButton().click();
		await settle();
		expect(player.destroy).toHaveBeenCalledOnce();
		expect(lease.release).toHaveBeenCalledOnce();
		expect(mocks.releaseAudio).toHaveBeenCalledOnce();
		expect(host.textContent).toContain('fileUnavailable');
		const retry = new FakePlayer();
		mocks.create.mockReturnValue(retry);
		playButton().click();
		await settle();
		expect(mocks.fetch).toHaveBeenCalledTimes(2);
		expect(retry.play).toHaveBeenCalledOnce();
		expect(host.textContent).not.toContain('fileUnavailable');
	});
	it('handles an asynchronous media error after readiness and allows retry', async () => {
		playButton().click();
		await settle();
		player.emit('error', new Error('media decode failed'));
		await settle();
		expect(lease.release).toHaveBeenCalledOnce();
		expect(player.destroy).toHaveBeenCalledOnce();
		expect(playButton().disabled).toBe(false);
		expect(host.textContent).toContain('fileUnavailable');
	});
	it('keeps decoded media for a new user gesture when autoplay is rejected', async () => {
		player.play.mockRejectedValueOnce(new DOMException('Gesture required', 'NotAllowedError'));
		playButton().click();
		await settle();
		expect(host.textContent).toContain('playbackTap');
		expect(host.textContent).not.toContain('fileUnavailable');
		expect(lease.release).not.toHaveBeenCalled();
		expect(player.destroy).not.toHaveBeenCalled();
		playButton().click();
		await settle();
		expect(mocks.fetch).toHaveBeenCalledOnce();
		expect(player.play).toHaveBeenCalledTimes(2);
		expect(host.textContent).not.toContain('playbackTap');
	});
	it.each(['visibility', 'pagehide'])('pauses on %s and requires manual playback after returning', async (reason) => {
		playButton().click();
		await settle();
		if (reason === 'visibility') hide(); else window.dispatchEvent(new Event('pagehide'));
		await settle();
		expect(player.pause).toHaveBeenCalled();
		expect(playButton().getAttribute('aria-label')).toBe('play');
		show();
		window.dispatchEvent(new Event('pageshow'));
		await settle();
		expect(player.play).toHaveBeenCalledOnce();
		playButton().click();
		await settle();
		expect(player.play).toHaveBeenCalledTimes(2);
	});
	it('releases late attachment bytes without playing after backgrounding during fetch', async () => {
		let finish!: (value: typeof lease) => void;
		mocks.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
		playButton().click();
		await settle();
		const signal = mocks.fetch.mock.calls[0][2] as AbortSignal;
		hide();
		show();
		finish(lease);
		await settle();
		expect(signal.aborted).toBe(true);
		expect(lease.release).toHaveBeenCalledOnce();
		expect(mocks.create).not.toHaveBeenCalled();
		expect(player.play).not.toHaveBeenCalled();
		expect(host.textContent).not.toContain('fileUnavailable');
		expect(playButton().disabled).toBe(false);
	});
	it('cancels delayed decoding on background and does not play when it finishes', async () => {
		let ready!: () => void;
		player.load.mockImplementationOnce(() => new Promise(resolve => { ready = () => resolve(undefined); }));
		playButton().click();
		await settle();
		hide();
		show();
		ready();
		await settle();
		expect(player.destroy).toHaveBeenCalledOnce();
		expect(lease.release).toHaveBeenCalledOnce();
		expect(player.play).not.toHaveBeenCalled();
		expect(playButton().disabled).toBe(false);
	});
	it('suppresses a delayed play event after the page is hidden', async () => {
		let finish!: () => void;
		player.play.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
		playButton().click();
		await settle();
		hide();
		show();
		player.emit('play');
		finish();
		await settle();
		expect(mocks.claim).not.toHaveBeenCalled();
		expect(player.pause).toHaveBeenCalled();
		expect(playButton().getAttribute('aria-label')).toBe('play');
	});
	it('removes listeners, aborts loading and releases resources once on unmount', async () => {
		playButton().click();
		await settle();
		app?.unmount(); app = undefined;
		window.dispatchEvent(new Event('pagehide'));
		player.emit('error', new Error('late error'));
		expect(player.destroy).toHaveBeenCalledOnce();
		expect(lease.release).toHaveBeenCalledOnce();
		expect(mocks.releaseAudio).toHaveBeenCalledOnce();
	});
});
