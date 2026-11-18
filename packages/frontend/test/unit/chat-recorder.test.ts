/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';
import type { App } from 'vue';

vi.mock('@/i18n.js', () => ({ i18n: { ts: { _time: { second: 'second' }, _chatPro: new Proxy({}, { get: (_, key) => key }) } } }));
vi.mock('@/utility/chat-media.js', () => ({ claimChatAudio: vi.fn(), releaseChatAudio: vi.fn() }));
const waveCreate = vi.hoisted(() => vi.fn());
vi.mock('wavesurfer.js', () => ({ default: { create: waveCreate } }));
import XVoiceRecorder from '@/pages/chat/XVoiceRecorder.vue';

let app: App | undefined;
let host: HTMLElement;
const recorders: FakeRecorder[] = [];
const track = { stop: vi.fn(), onended: null as (() => void) | null, onmute: null as (() => void) | null };
const getUserMedia = vi.fn();
const stream = { getTracks: () => [track] };

class FakeRecorder {
	public static isTypeSupported(): boolean { return true; }
	public state = 'inactive';
	public mimeType = 'audio/webm';
	public ondataavailable?: (event: { data: Blob }) => void;
	public onstop?: () => void;
	public onerror?: () => void;
	public stopCalls = 0;
	public emitData = true;
	public constructor() { recorders.push(this); }
	public start(): void { this.state = 'recording'; }
	public stop(): void { this.stopCalls++; this.systemStop(); }
	public systemStop(): void { this.state = 'inactive'; if (this.emitData) this.ondataavailable?.({ data: new Blob(['audio'], { type: this.mimeType }) }); this.onstop?.(); }
}

async function settle(): Promise<void> { for (let i = 0; i < 8; i++) { await Promise.resolve(); await nextTick(); } }

function button(text: string): HTMLButtonElement { return [...host.querySelectorAll('button')].find(candidate => candidate.textContent === text)!; }

function hide(): void { vi.spyOn(window.document, 'hidden', 'get').mockReturnValue(true); window.document.dispatchEvent(new Event('visibilitychange')); }

function show(): void { vi.spyOn(window.document, 'hidden', 'get').mockReturnValue(false); window.document.dispatchEvent(new Event('visibilitychange')); }

async function start(): Promise<void> {
	host = window.document.createElement('div');
	window.document.body.append(host);
	app = createApp(XVoiceRecorder);
	app.mount(host);
	host.querySelector('button')!.click();
	await Promise.resolve();
	await nextTick();
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(window.document, 'hidden', 'get').mockReturnValue(false);
	track.stop.mockReset();
	track.onended = null;
	track.onmute = null;
	waveCreate.mockReset().mockImplementation(() => ({ destroy: vi.fn(), on: vi.fn(() => vi.fn()) }));
	recorders.length = 0;
	getUserMedia.mockReset().mockResolvedValue(stream);
	vi.stubGlobal('MediaRecorder', FakeRecorder);
	Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
	vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-recording');
	vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});
afterEach(() => { app?.unmount(); app = undefined; host?.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Chat microphone lifecycle', () => {
	it('stops a late microphone permission result after cancellation', async () => {
		let grant!: (value: typeof stream) => void;
		getUserMedia.mockImplementation(() => new Promise(resolve => { grant = resolve; }));
		await start();
		app?.unmount(); app = undefined;
		grant(stream);
		await Promise.resolve();
		expect(track.stop).toHaveBeenCalledOnce();
	});
	it('stops at five minutes and releases preview resources on unmount', async () => {
		await start();
		expect(recorders.at(-1)!.state).toBe('recording');
		await vi.advanceTimersByTimeAsync(300_000);
		expect(recorders.at(-1)!.state).toBe('inactive');
		expect(track.stop).toHaveBeenCalledOnce();
		expect(host.querySelector('audio')).not.toBeNull();
		app?.unmount(); app = undefined;
		expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-recording');
	});
	it('stops recording when the browser hides the page', async () => {
		await start();
		hide();
		await nextTick();
		expect(recorders.at(-1)!.state).toBe('inactive');
		expect(track.stop).toHaveBeenCalledOnce();
		expect(host.textContent).toContain('recordingInterrupted');
	});
	it.each(['visibility', 'pagehide', 'cancel'])('releases a late permission grant after %s without starting recording', async (reason) => {
		let grant!: (value: typeof stream) => void;
		getUserMedia.mockImplementation(() => new Promise(resolve => { grant = resolve; }));
		await start();
		if (reason === 'visibility') hide();
		else if (reason === 'pagehide') window.dispatchEvent(new Event('pagehide'));
		else button('discardRecording').click();
		show();
		window.dispatchEvent(new Event('pageshow'));
		grant(stream);
		await settle();
		expect(recorders).toHaveLength(0);
		expect(track.stop).toHaveBeenCalledOnce();
		expect(host.querySelector('audio')).toBeNull();
	});
	it('ignores a stale permission rejection while a fresh request remains pending', async () => {
		let deny!: (error: Error) => void;
		getUserMedia.mockImplementationOnce(() => new Promise((_, reject) => { deny = reject; })).mockImplementationOnce(() => new Promise(() => undefined));
		await start();
		hide();
		show();
		await settle();
		button('record').click();
		await settle();
		deny(new DOMException('Permission denied', 'NotAllowedError'));
		await settle();
		expect(button('record').disabled).toBe(true);
		expect(host.textContent).not.toContain('microphoneError');
		expect(getUserMedia).toHaveBeenCalledTimes(2);
	});
	it.each(['system', 'error', 'ended', 'mute', 'pagehide'])('cleans up %s exactly once and retains a usable partial preview', async (reason) => {
		await start();
		const recorder = recorders[0];
		const onstop = recorder.onstop!;
		if (reason === 'system') recorder.systemStop();
		else if (reason === 'error') recorder.onerror!();
		else if (reason === 'ended') track.onended!();
		else if (reason === 'mute') track.onmute!();
		else window.dispatchEvent(new Event('pagehide'));
		onstop();
		window.dispatchEvent(new Event('pagehide'));
		await settle();
		expect(track.stop).toHaveBeenCalledOnce();
		expect(track.onended).toBeNull();
		expect(track.onmute).toBeNull();
		expect(vi.getTimerCount()).toBe(0);
		expect(host.querySelector('audio')).not.toBeNull();
		expect(host.textContent).not.toContain('stopRecording');
		expect(URL.createObjectURL).toHaveBeenCalledOnce();
		expect(recorder.stopCalls).toBeLessThanOrEqual(1);
	});
	it('shows interruption without creating an empty preview when the system ends before data is available', async () => {
		await start();
		recorders[0].emitData = false;
		recorders[0].systemStop();
		await settle();
		expect(host.textContent).toContain('recordingInterrupted');
		expect(host.querySelector('audio')).toBeNull();
		expect(button('record').disabled).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
	});
	it('waits for final data when the browser reports an error after setting recorder inactive', async () => {
		await start();
		const recorder = recorders[0];
		recorder.state = 'inactive';
		recorder.onerror!();
		await settle();
		expect(track.stop).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
		expect(button('record').disabled).toBe(true);
		expect(host.querySelector('audio')).toBeNull();
		recorder.ondataavailable!({ data: new Blob(['final audio'], { type: 'audio/mp4' }) });
		recorder.onstop!();
		await settle();
		expect(track.stop).toHaveBeenCalledOnce();
		expect(host.querySelector('audio')).not.toBeNull();
		expect(button('sendVoice')).not.toBeUndefined();
		expect(recorder.stopCalls).toBe(0);
	});
	it('pauses preview on background and does not resume on return', async () => {
		await start();
		button('stopRecording').click();
		await settle();
		const audio = host.querySelector('audio')!;
		const pause = vi.spyOn(audio, 'pause');
		const play = vi.spyOn(audio, 'play');
		hide();
		audio.dispatchEvent(new Event('play'));
		expect(pause).toHaveBeenCalledTimes(2);
		show();
		expect(play).not.toHaveBeenCalled();
	});
	it('keeps native preview usable when asynchronous waveform decoding fails', async () => {
		let fail!: () => void;
		const destroy = vi.fn();
		waveCreate.mockImplementation(() => ({ destroy, on: (event: string, handler: () => void) => { if (event === 'error') fail = handler; return vi.fn(); } }));
		await start();
		button('stopRecording').click();
		await settle();
		await vi.dynamicImportSettled();
		expect(waveCreate).toHaveBeenCalledOnce();
		fail();
		expect(destroy).toHaveBeenCalledOnce();
		expect(host.querySelector('audio')).not.toBeNull();
		expect(button('sendVoice')).not.toBeUndefined();
	});
});
