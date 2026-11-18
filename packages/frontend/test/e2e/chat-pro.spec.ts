/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { Page, WebSocketRoute } from '@playwright/test';
import type { ChatAttachment } from '@/types/chat.js';

const avatar = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="40" height="40"%3E%3Crect width="40" height="40" fill="%2386b300"/%3E%3C/svg%3E';

function user(id: string, name: string) {
	return { id, username: name.toLowerCase(), name, host: null, avatarUrl: avatar, avatarBlurhash: null, avatarDecorations: [], emojis: {}, onlineStatus: 'online', canChat: true, chatScope: 'everyone', createdAt: new Date().toISOString(), notesCount: 0, followersCount: 0, followingCount: 0, roles: [], fields: [], pinnedNotes: [], pinnedNoteIds: [], isAdmin: false, isModerator: false, isBot: false, isCat: false, isFollowing: false, isFollowed: false, isBlocking: false, isBlocked: false, isMuted: false, twoFactorEnabled: false, securityKeys: false, birthday: null, description: '', bannerUrl: null };
}

const alice = { ...user('qa-alice', 'Alice'), token: 'qa-only-not-a-real-token', policies: { chatAvailability: 'available', maxFileSizeMb: 50 }, unreadAnnouncements: [], achievements: [], notificationRecieveConfig: {}, hasUnreadChatMessages: true };
const bob = user('qa-bob', 'Bob');
const peers = Array.from({ length: 12 }, (_, index) => user(`qa-peer-${index}`, `Peer ${index}`));
type Message = ReturnType<typeof message>;

function message(index: number) {
	return { id: `qa${String(index).padStart(10, '0')}`, createdAt: new Date(Date.UTC(2026, 9, 12, 1, 0, index)).toISOString(), fromUserId: bob.id, toUserId: alice.id, text: `Synthetic chat message ${index} — enough content to exercise wrapping and history.`, reactions: [], revision: 1, editedAt: null, recalledAt: null as string | null, readAt: null as string | null, readTracked: true, readState: 'unread', clientMessageId: null as string | null, attachments: [] as ChatAttachment[] };
}

async function setup(page: Page, withAttachment = false, options: { denyOutboxStorage?: boolean; deferSend?: boolean; pendingExpiresSoon?: boolean } = {}) {
	const messages = Array.from({ length: 600 }, (_, index) => message(index));
	if (withAttachment) messages.at(-1)!.attachments.push({ id: 'qa-image', name: 'synthetic-image.png', mime: 'image/png', size: 68, kind: 'image', durationMs: null, peaks: [], width: 160, height: 80, hasPreview: true, legacyExposure: 'none', sourceRetainedShared: false, expiresAt: null });
	const reads: { ids: string[]; dwell: number[] }[] = [];
	const requests: { limit?: number; sinceId?: string; untilId?: string }[] = [];
	const errors: string[] = [];
	const channels = new Map<string, string>();
	const subscriptions = new Map<string, { channel: string; socket: WebSocketRoute }>();
	let maxChatSubscriptions = 0;
	const peerMessages = new Map(peers.map(peer => [peer.id, Array.from({ length: 20 }, (_, index) => ({ ...message(index), id: `${peer.id}-${String(index).padStart(10, '0')}`, fromUserId: peer.id }))]));
	let socket: WebSocketRoute | undefined;
	let sendRequests = 0;
	const deletedAttachments: string[] = [];
	let releaseSend = (): void => undefined;
	const sendGate = options.deferSend ? new Promise<void>(resolve => { releaseSend = resolve; }) : Promise.resolve();
	page.on('pageerror', error => errors.push(error.message));
	await page.addInitScript(({ account, denyOutboxStorage, pendingExpiresSoon }) => {
		if (denyOutboxStorage) {
			const setItem = Storage.prototype.setItem;
			Storage.prototype.setItem = function (key, value) {
				if (this === window.sessionStorage && key.startsWith('chatProOutbox:')) throw new DOMException('Synthetic storage denial', 'QuotaExceededError');
				setItem.call(this, key, value);
			};
		}
		const probe = { created: [] as string[], revoked: [] as string[] };
		Object.defineProperty(window, '__chatBlobProbe', { value: probe });
		const resources = { maxRows: 0, maxMessages: 0, maxElements: 0, maxActiveBlobs: 0, animationCount: 0 };
		Object.defineProperty(window, '__chatResourceProbe', { value: resources });
		window.document.addEventListener('transitionrun', event => {
			if (event.target instanceof HTMLElement && event.target.matches('[data-timeline-row]')) resources.animationCount++;
		});
		const create = URL.createObjectURL.bind(URL); const revoke = URL.revokeObjectURL.bind(URL);
		URL.createObjectURL = blob => { const url = create(blob); probe.created.push(url); return url; };
		URL.revokeObjectURL = url => { probe.revoked.push(url); revoke(url); };
		localStorage.setItem('account', JSON.stringify(account));
		localStorage.setItem('lang', 'en-US');
		localStorage.setItem('ui', 'zen');
		localStorage.setItem('modifiedVersionMustProminentlyOfferInAgplV3Section13Read', 'true');
		localStorage.setItem('pizzax::base::cache::qa-alice', JSON.stringify({ accountSetupWizard: -1 }));
		if (pendingExpiresSoon) sessionStorage.setItem('chatProOutbox:qa-alice:qa-bob', JSON.stringify([{ createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000 + 10_000).toISOString(), status: 'failed', snapshot: { clientMessageId: 'qa-expiring-nonce', toUserId: 'qa-bob', text: 'Expiring synthetic draft', attachmentIds: ['qa-expiring-attachment'] } }]));

		function observe(): void {
			resources.maxRows = Math.max(resources.maxRows, window.document.querySelectorAll('[data-scroll-anchor]').length);
			resources.maxMessages = Math.max(resources.maxMessages, window.document.querySelectorAll('[data-chat-readable]').length);
			resources.maxElements = Math.max(resources.maxElements, window.document.querySelectorAll('*').length);
			resources.maxActiveBlobs = Math.max(resources.maxActiveBlobs, probe.created.filter(url => !probe.revoked.includes(url)).length);
			for (const row of window.document.querySelectorAll<HTMLElement>('[data-chat-readable]')) {
				const r = row.getBoundingClientRect();
				const top = Math.max(0, r.top); const bottom = Math.min(window.innerHeight, r.bottom);
				const hit = window.document.elementFromPoint((r.left + r.right) / 2, (top + bottom) / 2);
				const visible = window.document.hasFocus() && !window.document.hidden && bottom - top >= Math.min(80, r.height / 2) && hit && row.contains(hit);
				if (visible && !row.dataset.qaVisibleSince) row.dataset.qaVisibleSince = String(Date.now());
				if (!visible) delete row.dataset.qaVisibleSince;
			}
			requestAnimationFrame(observe);
		}

		requestAnimationFrame(observe);
	}, { account: alice, denyOutboxStorage: options.denyOutboxStorage ?? false, pendingExpiresSoon: options.pendingExpiresSoon ?? false });
	await page.route('**/*', async route => {
		const url = new URL(route.request().url());
		if (url.origin !== 'http://127.0.0.1:61819') { await route.abort(); return; }
		if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
		const endpoint = url.pathname.slice(5);
		if (endpoint === 'chat/attachments/qa-image/preview') {
			expect(route.request().headers()['authorization']).toBe('Bearer qa-only-not-a-real-token');
			await route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') }); return;
		}
		const body = route.request().postDataJSON() ?? {};
		let result: unknown = [];
		if (endpoint === 'i') result = alice;
		else if (endpoint === 'users/show') result = peers.find(peer => peer.id === body.userId) ?? bob;
		else if (endpoint === 'meta') result = { version: '2026.9.0', name: 'Chat Pro QA', uri: url.origin, repositoryUrl: 'https://github.com/misskey-dev/misskey', maintainerName: 'QA', disableRegistration: true, serverRules: [], ads: [], pinnedUsers: [], policies: alice.policies, features: {}, iconUrl: avatar, defaultLightTheme: null, defaultDarkTheme: null, maxNoteTextLength: 3000 };
		else if (endpoint === 'emojis') result = { emojis: [] };
		else if (endpoint === 'i/registry/get-all') result = { accountSetupWizard: -1 };
		else if (endpoint === 'i/registry/get') { await route.fulfill({ status: 404, json: { error: { code: 'NO_SUCH_KEY' } } }); return; } else if (endpoint === 'chat/unread-summary') result = { unreadCount: messages.filter(item => !item.readAt).length, hasLegacyUnread: false, hasUnreadRoom: false };
		else if (endpoint === 'chat/conversations') result = [{ user: bob, lastMessage: messages.at(-1), unreadCount: messages.filter(item => !item.readAt).length, hasLegacyUnread: false }, ...peers.map(peer => ({ user: peer, lastMessage: peerMessages.get(peer.id)!.at(-1), unreadCount: 20, hasLegacyUnread: false }))];
		else if (endpoint === 'chat/messages/user-timeline') {
			requests.push(body);
			result = (peerMessages.get(body.userId) ?? messages).filter(item => (!body.untilId || item.id < body.untilId) && (!body.sinceId || item.id > body.sinceId)).sort((a, b) => body.sinceId ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id)).slice(0, body.limit ?? 10);
		} else if (endpoint === 'chat/messages/state') result = { messages: (peerMessages.get(body.userId) ?? messages).filter(item => body.messageIds.includes(item.id)), missingIds: [] };
		else if (endpoint === 'chat/messages/read') {
			const dwell = await page.evaluate((ids: string[]) => ids.map(id => { const row = window.document.querySelector<HTMLElement>(`[data-chat-readable="${id}"]`); return row?.dataset.qaVisibleSince ? Date.now() - Number(row.dataset.qaVisibleSince) : -1; }), body.messageIds);
			reads.push({ ids: body.messageIds, dwell });
			const changed = (peerMessages.get(body.userId) ?? messages).filter(item => body.messageIds.includes(item.id));
			for (const item of changed) { item.readAt = new Date().toISOString(); item.readState = 'read'; }
			result = { messages: changed };
		} else if (endpoint === 'chat/messages/create-to-user') {
			sendRequests++;
			await sendGate;
			const created: Message = { ...message(messages.length), text: body.text, fromUserId: alice.id, toUserId: bob.id, clientMessageId: body.clientMessageId };
			messages.push(created); result = created;
		} else if (endpoint === 'chat/attachments/delete') deletedAttachments.push(body.attachmentId);
		await route.fulfill({ json: result });
	});
	await page.routeWebSocket('**/streaming*', ws => {
		socket = ws;
		ws.onMessage(raw => {
			if (String(raw) === 'h') return;
			if (String(raw) === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return; }
			const event = JSON.parse(String(raw));
			if (event.type === 'connect') {
				channels.set(event.body.channel, event.body.id);
				subscriptions.set(event.body.id, { channel: event.body.channel, socket: ws });
				maxChatSubscriptions = Math.max(maxChatSubscriptions, [...subscriptions.values()].filter(item => item.channel === 'chatUser').length);
			} else if (event.type === 'disconnect') subscriptions.delete(event.body.id);
		});
		ws.onClose(() => { for (const [id, item] of subscriptions) if (item.socket === ws) subscriptions.delete(id); });
	});
	await page.goto('/chat/user/qa-bob?zen');
	await expect(page.locator('[data-chat-readable]').first()).toBeVisible({ timeout: 60_000 });
	await page.bringToFront();
	return { messages, reads, requests, errors, deletedAttachments, sendRequests: () => sendRequests, releaseSend, activeChatSubscriptions: () => [...subscriptions.values()].filter(item => item.channel === 'chatUser').length, maxChatSubscriptions: () => maxChatSubscriptions, disconnect: () => socket?.close(), send: (type: string, body: unknown) => socket?.send(JSON.stringify({ type: 'channel', body: { id: channels.get('chatUser'), type, body } })) };
}

test('private chat responsive layout, real viewport read dwell and bounded history', async ({ page }, testInfo) => {
	const qa = await setup(page);
	expect(qa.requests[0].limit).toBe(20);
	await expect(page.locator('aside')).toBeVisible();
	await expect.poll(() => qa.reads.length).toBeGreaterThan(0);
	expect(qa.reads.flatMap(read => read.ids).length).toBeLessThan(20);
	expect(qa.reads.flatMap(read => read.dwell).every(dwell => dwell >= 480)).toBe(true);
	await page.screenshot({ path: testInfo.outputPath('desktop-light.png') });
	await page.evaluate(() => {
		const overlay = window.document.createElement('div'); overlay.id = 'qa-occluder'; overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:transparent'; window.document.body.append(overlay);
		let container = window.document.querySelector('[data-chat-readable]')?.parentElement;
		while (container && !['auto', 'scroll'].includes(getComputedStyle(container).overflowY)) container = container.parentElement;
		if (container) container.scrollTop -= 600;
	});
	const readsBeforeOcclusion = qa.reads.length;
	await page.waitForTimeout(750);
	expect(qa.reads.length).toBe(readsBeforeOcclusion);
	await page.evaluate(() => window.document.getElementById('qa-occluder')?.remove());
	await expect.poll(() => qa.reads.length).toBeGreaterThan(readsBeforeOcclusion);
	for (let index = 0; index < 6; index++) {
		const load = page.getByRole('button', { name: 'Load more', exact: true });
		await load.click();
		await expect.poll(() => qa.requests.filter(request => request.untilId).length).toBe(index + 1);
		await expect.poll(() => page.locator('[data-scroll-anchor]').count()).toBe(Math.min(120, 20 + 30 * (index + 1)));
	}
	expect(await page.locator('[data-chat-readable]').count()).toBeLessThan(120);
	await page.setViewportSize({ width: 959, height: 900 });
	await expect(page.locator('aside')).toBeHidden();
	await page.setViewportSize({ width: 960, height: 900 });
	await expect(page.locator('aside')).toBeVisible();
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(page.locator('aside')).toBeHidden();
	const input = page.locator('textarea').last();
	await input.fill('Mobile composer should remain reachable.');
	const bounds = await input.boundingBox();
	expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
	expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
	await page.screenshot({ path: testInfo.outputPath('mobile-light.png') });
	const lightBackground = await page.evaluate(() => getComputedStyle(window.document.documentElement).getPropertyValue('--MI_THEME-bg'));
	await page.emulateMedia({ colorScheme: 'dark' });
	await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'dark');
	await expect.poll(() => page.evaluate(() => getComputedStyle(window.document.documentElement).getPropertyValue('--MI_THEME-bg'))).not.toBe(lightBackground);
	// The native theme overlay fades after applying the new CSS variables.
	await page.waitForTimeout(350);
	await page.screenshot({ path: testInfo.outputPath('mobile-dark.png') });
	expect(qa.errors).toEqual([]);
});

test('protected image uses an authorized Blob and releases it when scrolled away', async ({ page }) => {
	const qa = await setup(page, true);
	await expect(page.getByAltText('synthetic-image.png')).toBeVisible();
	const urls = await page.evaluate(() => (window as unknown as { __chatBlobProbe: { created: string[] } }).__chatBlobProbe.created);
	expect(urls.length).toBeGreaterThan(0);
	await page.getByRole('button', { name: 'Load more', exact: true }).click();
	await expect(page.getByAltText('synthetic-image.png')).toHaveCount(0);
	await expect.poll(() => page.evaluate((created: string[]) => (window as unknown as { __chatBlobProbe: { revoked: string[] } }).__chatBlobProbe.revoked.some(url => created.includes(url)), urls)).toBe(true);
	expect(qa.errors).toEqual([]);
});

test('live changes stay monotonic and reconnect resets a missing history interval', async ({ page }) => {
	const qa = await setup(page);
	await expect.poll(() => qa.reads.length).toBeGreaterThan(0);
	const last = qa.messages.at(-1)!;
	last.text = 'Edited in another synthetic device'; last.revision = 2;
	qa.send('updated', last);
	await expect(page.getByText(last.text, { exact: true })).toBeVisible();
	qa.send('updated', { ...last, text: 'Stale revision must not win', revision: 1 });
	await expect(page.getByText('Stale revision must not win', { exact: true })).toHaveCount(0);
	last.recalledAt = new Date().toISOString(); last.revision = 3;
	qa.send('recalled', last);
	await expect(page.locator(`[data-chat-readable="${last.id}"]`)).not.toContainText(last.text);
	qa.disconnect();
	for (let index = 600; index < 645; index++) qa.messages.push(message(index));
	await expect(page.getByText(qa.messages.at(-1)!.text, { exact: true })).toBeVisible({ timeout: 25_000 });
	const indices = await page.locator('[data-scroll-anchor]').evaluateAll(rows => rows.map(row => Number(row.getAttribute('data-scroll-anchor')!.slice(2))).sort((a, b) => a - b));
	expect(indices).toHaveLength(30);
	expect(indices.at(-1)).toBe(644);
	expect(indices.every((value, index) => index === 0 || value === indices[index - 1] + 1)).toBe(true);
	expect(qa.errors).toEqual([]);
});

test('storage denial and a delayed receipt preserve a rewritten identical draft', async ({ page }) => {
	const qa = await setup(page, false, { denyOutboxStorage: true, deferSend: true });
	const input = page.locator('textarea').last();
	await input.fill('Same words, a new draft');
	await page.getByRole('button', { name: 'Send', exact: true }).click();
	await expect.poll(qa.sendRequests).toBe(1);
	await expect(input).toHaveValue('Same words, a new draft');
	await input.fill('');
	await input.fill('Same words, a new draft');
	qa.releaseSend();
	await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
	await expect(input).toHaveValue('Same words, a new draft');
	expect(qa.errors).toEqual([]);
});

test('animated long conversation keeps resources bounded across 1000 messages and 20 switches', async ({ page }, testInfo) => {
	test.setTimeout(270_000);
	const qa = await setup(page, true, { pendingExpiresSoon: true });
	const startedAt = Date.now();
	const image = { ...qa.messages.at(-1)!.attachments[0] };
	const unique = new Set<string>();
	for (let batch = 0; batch < 100; batch++) {
		for (let offset = 0; offset < 10; offset++) {
			const item = message(600 + batch * 10 + offset);
			if (offset === 9 && batch % 5 === 0) item.attachments.push(image);
			qa.messages.push(item);
			unique.add(item.id);
			qa.send('message', item);
		}
		await expect(page.locator(`[data-chat-readable="${qa.messages.at(-1)!.id}"]`)).toBeVisible();
		await expect.poll(() => page.locator('[data-scroll-anchor]').count()).toBe(Math.min(120, 30 + batch * 10));
		expect(await page.evaluate(() => (window as unknown as { __chatResourceProbe: { maxRows: number } }).__chatResourceProbe.maxRows)).toBeLessThanOrEqual(120);
		await page.waitForTimeout(Math.max(1, startedAt + (batch + 1) * 1800 - Date.now()));
		if ((batch + 1) % 25 === 0) console.log(`Chat resource run: ${batch + 1} batches / ${unique.size} messages / ${Date.now() - startedAt} ms`);
	}
	const streamDurationMs = Date.now() - startedAt;
	const expired = page.getByText('Expiring synthetic draft', { exact: true }).locator('..');
	await expect(expired.getByRole('alert')).toBeVisible();
	await expect(expired.getByRole('button')).toHaveCount(1);
	expect(qa.sendRequests()).toBe(0);
	expect(await page.evaluate(() => sessionStorage.getItem('chatProOutbox:qa-alice:qa-bob'))).toBeNull();
	await expired.getByRole('button').click();
	await expect(page.getByText('Expiring synthetic draft', { exact: true })).toHaveCount(0);
	await expect.poll(() => qa.deletedAttachments).toContain('qa-expiring-attachment');
	for (let index = 0; index < 20; index++) {
		const peerId = index % 2 === 0 ? peers[index / 2].id : bob.id;
		await page.locator(`aside a[href="/chat/user/${peerId}"]`).click();
		await expect(page).toHaveURL(new RegExp(`/chat/user/${peerId}(?:\\?|$)`));
		await expect(page.locator('[data-chat-readable]').first()).toBeVisible();
		await expect.poll(qa.activeChatSubscriptions).toBe(1);
		await page.waitForTimeout(250);
	}
	const metrics = await page.evaluate(() => {
		const windowProbe = window as unknown as { __chatResourceProbe: { maxRows: number; maxMessages: number; maxElements: number; maxActiveBlobs: number; animationCount: number }; __chatBlobProbe: { created: string[]; revoked: string[] } };
		return { ...windowProbe.__chatResourceProbe, finalActiveBlobs: windowProbe.__chatBlobProbe.created.filter(url => !windowProbe.__chatBlobProbe.revoked.includes(url)).length, createdBlobs: windowProbe.__chatBlobProbe.created.length, revokedBlobs: new Set(windowProbe.__chatBlobProbe.revoked).size };
	});
	const evidence = { streamDurationMs, totalDurationMs: Date.now() - startedAt, uniqueMessages: unique.size, conversationSwitches: 20, maxChatSubscriptions: qa.maxChatSubscriptions(), activeChatSubscriptions: qa.activeChatSubscriptions(), ...metrics };
	await writeFile(testInfo.outputPath('resource-metrics.json'), JSON.stringify(evidence, null, 2));
	await testInfo.attach('resource-metrics.json', { path: testInfo.outputPath('resource-metrics.json'), contentType: 'application/json' });
	console.log('Chat resource metrics:', evidence);
	expect(streamDurationMs).toBeGreaterThanOrEqual(180_000);
	expect(unique.size).toBe(1000);
	expect(metrics.animationCount).toBeGreaterThan(0);
	expect(metrics.maxRows).toBeLessThanOrEqual(120);
	expect(metrics.maxMessages).toBeLessThanOrEqual(60);
	expect(metrics.maxElements).toBeLessThan(2500);
	expect(metrics.maxActiveBlobs).toBeLessThanOrEqual(3);
	expect(metrics.finalActiveBlobs).toBeLessThanOrEqual(1);
	expect(qa.maxChatSubscriptions()).toBeLessThanOrEqual(2);
	expect(qa.errors).toEqual([]);
});
