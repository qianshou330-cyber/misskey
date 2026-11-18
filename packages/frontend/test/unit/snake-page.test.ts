/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineComponent, h, KeepAlive, nextTick, ref } from 'vue';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SnakePage from '@/pages/snake.vue';
import Games from '@/pages/games.vue';
import { instance } from '@/instance.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { pleaseLogin } from '@/utility/please-login.js';
import { i18n } from '@/i18n.js';

const fake = vi.hoisted(() => ({ account: null as null | { id: string }, clients: [] as any[] }));
vi.mock('@/i.js', () => ({ get $i() { return fake.account; } }));
vi.mock('@/instance.js', async () => { const { reactive } = await import('vue'); return { instance: reactive({ snakeGameEnabled: false }) }; });
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: vi.fn() }));
vi.mock('@/utility/please-login.js', () => ({ pleaseLogin: vi.fn() }));
vi.mock('@/page.js', () => ({ definePage: vi.fn() }));
vi.mock('@/games/snake/renderer.js', () => ({ drawSnake: vi.fn() }));
vi.mock('@/games/snake/client.js', () => ({
	loadSnakeSocket: vi.fn(),
	SnakeClient: class {
		status = 'idle'; code = ''; score = 0; maxHumans = 20;
		scene = { selfId: '', current: null as any };
		start = vi.fn();
		input = vi.fn();
		close = vi.fn(() => { this.status = 'idle'; this.scene.current = null; this.options.changed(); });
		constructor(private options: { changed: () => void }) { fake.clients.push(this); }
		update(value: Record<string, unknown>): void { Object.assign(this, value); this.options.changed(); }
	},
}));
vi.mock('@/components/MkButton.vue', async () => {
	const { defineComponent, h } = await import('vue');
	return { default: defineComponent({ props: { disabled: Boolean }, emits: ['click'], setup: (props, { slots, emit }) => () => h('button', { disabled: props.disabled, onClick: () => emit('click') }, slots.default?.()) }) };
});

const global = { components: {
	PageWithHeader: defineComponent({ setup: (_props, { slots }) => () => h('div', slots.default?.()) }),
	MkA: defineComponent({ props: { to: String }, setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }),
} };

describe('PUBO snake entry and lifecycle', () => {
	let frames: Map<number, FrameRequestCallback>;
	let observers: { disconnect: ReturnType<typeof vi.fn> }[];
	beforeEach(() => {
		vi.clearAllMocks();
		fake.clients = [];
		fake.account = { id: 'player' };
		instance.snakeGameEnabled = true;
		vi.mocked(misskeyApi).mockImplementation(async () => ({ snakeGameEnabled: instance.snakeGameEnabled }) as any);
		frames = new Map(); observers = [];
		let nextId = 0;
		vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.set(++nextId, callback); return nextId; }));
		vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
		vi.stubGlobal('ResizeObserver', class {
			disconnect = vi.fn(); observe = vi.fn();
			constructor() { observers.push(this); }
		});
	});
	afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

	it('defaults off and refreshes only the public feature flag, preserving the existing games', async () => {
		instance.snakeGameEnabled = false;
		const page = render(Games, { global });
		expect(page.queryByTestId('snake-game-link')).toBeNull();
		expect(page.container.querySelector('a[href="/bubble-game"]')).not.toBeNull();
		expect(page.container.querySelector('a[href="/reversi"]')).not.toBeNull();
		expect(misskeyApi).toHaveBeenCalledWith('meta', { detail: true }, null, expect.any(AbortSignal));
		page.unmount();
		vi.mocked(misskeyApi).mockResolvedValueOnce({ snakeGameEnabled: true } as any);
		const refreshed = render(Games, { global });
		await refreshed.findByTestId('snake-game-link');
		expect(instance.snakeGameEnabled).toBe(false);
	});

	it('blocks disabled entry and makes no game connection or rendering loop', async () => {
		instance.snakeGameEnabled = false;
		const page = render(SnakePage, { global });
		expect(page.getByTestId('snake-disabled')).not.toBeNull();
		await nextTick();
		expect(fake.clients[0].start).not.toHaveBeenCalled();
		expect(frames.size).toBe(0);
	});

	it('uses the existing sign-in flow for guests without a game session', async () => {
		fake.account = null;
		const page = render(SnakePage, { global });
		await fireEvent.click(page.getByRole('button', { name: i18n.ts.login }));
		expect(pleaseLogin).toHaveBeenCalledOnce();
		expect(fake.clients[0].start).not.toHaveBeenCalled();
		expect(frames.size).toBe(0);
	});

	it('never starts automatically; authoritative rankings escape names and label computer players separately', async () => {
		const page = render(SnakePage, { global });
		await nextTick();
		const client = fake.clients[0];
		expect(client.start).not.toHaveBeenCalled();
		await fireEvent.click(page.getByTestId('snake-start'));
		expect(client.start).toHaveBeenCalledOnce();
		client.update({ status: 'playing', maxHumans: 8, score: 12, scene: { selfId: 'human', current: { humans: 2, bots: 1, leaderboard: [{ id: 'human', name: '<img src=x onerror=alert(1)>', score: 12, isBot: false }, { id: 'bot', name: 'CPU', score: 5, isBot: true }] } } });
		await nextTick();
		const ranking = page.getByTestId('snake-ranking');
		expect(ranking.textContent).toContain('<img src=x onerror=alert(1)>');
		expect(ranking.querySelector('img')).toBeNull();
		expect(ranking.querySelectorAll('small')).toHaveLength(1);
		expect(page.getByTestId('snake-status').textContent).toContain('2 / 8');
		expect(page.queryByTestId('snake-overlay')).toBeNull();
	});

	it('releases boost when the tab becomes hidden without exceeding the input rate', async () => {
		const page = render(SnakePage, { global });
		await nextTick(); await nextTick();
		const client = fake.clients[0];
		client.update({ status: 'playing' });
		await nextTick();
		vi.spyOn(window.document, 'hidden', 'get').mockReturnValue(false);
		await fireEvent.keyDown(page.getByTestId('snake-surface'), { code: 'Space' });
		const callback = [...frames.values()][0];
		callback(100);
		expect(client.input).toHaveBeenLastCalledWith(expect.objectContaining({ boost: true }));
		vi.spyOn(window.document, 'hidden', 'get').mockReturnValue(true);
		vi.spyOn(performance, 'now').mockReturnValue(160);
		window.document.dispatchEvent(new Event('visibilitychange'));
		expect(client.input).toHaveBeenLastCalledWith(expect.objectContaining({ boost: false }));
		expect(client.input).toHaveBeenCalledTimes(2);
		window.document.dispatchEvent(new Event('visibilitychange'));
		expect(client.input).toHaveBeenCalledTimes(2);
	});

	it('releases the socket, input handlers, observers, RAF and metadata request on cached page leave', async () => {
		const shown = ref(true);
		const page = render(defineComponent({ setup: () => () => h(KeepAlive, null, { default: () => shown.value ? h(SnakePage) : null }) }), { global });
		await nextTick(); await nextTick();
		expect(frames.size).toBe(1);
		const signal = vi.mocked(misskeyApi).mock.calls[0][3] as AbortSignal;
		shown.value = false;
		await nextTick();
		expect(fake.clients[0].close).toHaveBeenCalled();
		expect(frames.size).toBe(0);
		expect(observers.every(observer => observer.disconnect.mock.calls.length > 0)).toBe(true);
		expect(signal.aborted).toBe(true);
		shown.value = true;
		await waitFor(() => expect(frames.size).toBe(1));
		expect(fake.clients[0].start).not.toHaveBeenCalled();
		page.unmount();
		expect(frames.size).toBe(0);
	});
});
