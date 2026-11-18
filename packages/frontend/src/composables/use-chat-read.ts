/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { onActivated, onBeforeUnmount, onDeactivated, onMounted } from 'vue';
import { getScrollContainer } from '@@/js/scroll.js';
import type { ChatMessage } from '@/types/chat.js';
import { ChatReadCandidates, isChatMessageVisible } from '@/utility/chat-state.js';
import { chatApi } from '@/utility/chat-api.js';
import { popups } from '@/os.js';

export function useChatRead(options: {
	root: () => HTMLElement | null;
	enabled: () => boolean;
	generation: () => number;
	userId: string;
	accountId: string;
	messages: () => ChatMessage[];
	merge: (messages: ChatMessage[]) => void;
}): { reset: () => void } {
	const candidates = new ChatReadCandidates();
	let timer: number | undefined;
	let inFlight = false;
	let lifecycle = 0;
	let controller = new AbortController();
	const reset = (): void => candidates.clear();

	async function tick(): Promise<void> {
		const root = options.root();
		const enabled = options.enabled() && !window.document.hidden && window.document.hasFocus() && popups.value.length === 0 && root?.isConnected;
		if (!enabled || !root) { reset(); return; }
		const container = getScrollContainer(root);
		const bounds = container?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth };
		const viewport = { ...bounds, top: Math.max(bounds.top, window.visualViewport?.offsetTop ?? 0), bottom: Math.min(bounds.bottom, (window.visualViewport?.offsetTop ?? 0) + (window.visualViewport?.height ?? window.innerHeight)), left: bounds.left, right: bounds.right };
		const unread = new Set(options.messages().filter(message => message.fromUserId !== options.accountId && !message.readAt && !message.recalledAt).map(message => message.id));
		const visible: string[] = [];
		for (const row of root.querySelectorAll<HTMLElement>('[data-chat-readable]')) {
			const id = row.dataset.chatReadable;
			if (!id || !unread.has(id)) continue;
			const rect = row.getBoundingClientRect();
			if (!isChatMessageVisible(rect, viewport)) continue;
			const x = Math.min(viewport.right - 1, Math.max(viewport.left + 1, (rect.left + rect.right) / 2));
			const y = (Math.max(rect.top, viewport.top) + Math.min(rect.bottom, viewport.bottom)) / 2;
			const hit = window.document.elementFromPoint(x, y);
			if (hit && row.contains(hit)) visible.push(id);
		}
		const ids = candidates.observe(visible, performance.now(), true);
		if (!ids.length || inFlight) return;
		const generation = options.generation();
		const requestLifecycle = lifecycle;
		inFlight = true;
		candidates.submitted(ids);
		try {
			const result = await chatApi('chat/messages/read', { userId: options.userId, messageIds: ids }, controller.signal);
			if (requestLifecycle === lifecycle && generation === options.generation()) options.merge(result.messages);
		} catch {
			// Re-observe the current viewport; never queue stale read candidates.
			if (requestLifecycle === lifecycle) reset();
		} finally { if (requestLifecycle === lifecycle) inFlight = false; }
	}

	function start(): void {
		if (timer !== undefined) return;
		if (controller.signal.aborted) controller = new AbortController();
		timer = window.setInterval(() => { void tick(); }, 150);
		window.document.addEventListener('visibilitychange', reset);
		window.addEventListener('blur', reset);
	}

	function stop(): void {
		window.clearInterval(timer);
		timer = undefined;
		lifecycle++;
		controller.abort();
		inFlight = false;
		reset();
		window.document.removeEventListener('visibilitychange', reset);
		window.removeEventListener('blur', reset);
	}

	onMounted(start);
	onActivated(start);
	onDeactivated(stop);
	onBeforeUnmount(stop);
	return { reset };
}
