/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeAll, describe, expect, test } from 'vitest';
import type * as Misskey from 'misskey-js';
import { api, castAsError, signup, successfulApiCall } from '../utils.js';

describe('Chat private contacts and blocking', () => {
	let alice: Misskey.entities.SignupResponse;
	let bob: Misskey.entities.SignupResponse;
	let carol: Misskey.entities.SignupResponse;

	beforeAll(async () => {
		alice = await signup({ username: 'chatcontactalice' });
		bob = await signup({ username: 'chatcontactbob' });
		carol = await signup({ username: 'chatcontactcarol' });
		await successfulApiCall({ endpoint: 'i/update', parameters: { chatScope: 'everyone' }, user: alice });
		await successfulApiCall({ endpoint: 'i/update', parameters: { chatScope: 'everyone' }, user: bob });
	}, 120000);

	test('groups are private, allow multiple memberships and never change follows', async () => {
		await successfulApiCall({ endpoint: 'following/create', parameters: { userId: bob.id }, user: alice });
		const first = await successfulApiCall({ endpoint: 'chat/contact-groups/create', parameters: { name: 'Family' }, user: alice });
		const second = await successfulApiCall({ endpoint: 'chat/contact-groups/create', parameters: { name: 'Friends' }, user: alice });
		for (const group of [first, second]) {
			await successfulApiCall({ endpoint: 'chat/contact-groups/add-user', parameters: { groupId: group.id, userId: bob.id }, user: alice });
		}
		const duplicate = await api('chat/contact-groups/add-user', { groupId: first.id, userId: bob.id }, alice);
		expect(duplicate.status).toBe(204);
		const groups = await successfulApiCall({ endpoint: 'chat/contact-groups/list', parameters: {}, user: alice });
		expect(groups.filter(group => group.userIds.includes(bob.id))).toHaveLength(2);
		expect(await successfulApiCall({ endpoint: 'chat/contact-groups/list', parameters: {}, user: bob })).toEqual([]);
		for (const endpoint of ['chat/contact-groups/update', 'chat/contact-groups/delete', 'chat/contact-groups/add-user', 'chat/contact-groups/remove-user'] as const) {
			const response = await api(endpoint, { groupId: first.id, userId: carol.id, name: 'Intrusion' }, bob);
			expect(castAsError(response.body).error.code).toBe('NO_SUCH_CHAT_CONTACT');
		}
		await successfulApiCall({ endpoint: 'chat/contact-groups/delete', parameters: { groupId: first.id }, user: alice });
		const detail = await successfulApiCall({ endpoint: 'users/show', parameters: { userId: bob.id }, user: alice });
		expect(detail.isFollowing).toBe(true);
		expect((await successfulApiCall({ endpoint: 'chat/contact-groups/list', parameters: {}, user: alice }))[0].userIds).toContain(bob.id);
	});

	test('blank names are rejected after trimming', async () => {
		const response = await api('chat/contact-groups/create', { name: '   ' }, alice);
		expect(castAsError(response.body).error.code).toBe('INVALID_CHAT_GROUP_NAME');
	});

	test('Chat block stops both directions and edits, keeps follows, history and recall', async () => {
		const message = await successfulApiCall({ endpoint: 'chat/messages/create-to-user', parameters: { toUserId: bob.id, text: 'Before the block' }, user: alice });
		await successfulApiCall({ endpoint: 'chat/blocking/create', parameters: { userId: bob.id }, user: alice });
		await successfulApiCall({ endpoint: 'chat/blocking/create', parameters: { userId: bob.id }, user: alice });
		expect((await successfulApiCall({ endpoint: 'chat/blocking/list', parameters: {}, user: alice }))).toHaveLength(1);
		expect((await successfulApiCall({ endpoint: 'chat/blocking/list', parameters: {}, user: bob }))).toEqual([]);
		for (const [sender, target] of [[alice, bob], [bob, alice]]) {
			const response = await api('chat/messages/create-to-user', { toUserId: target.id, text: 'Blocked' }, sender);
			expect(castAsError(response.body).error.code).toBe('CHAT_BLOCKED');
		}
		const edit = await api('chat/messages/update', { messageId: message.id, expectedRevision: 0, text: 'Blocked edit' }, alice);
		expect(castAsError(edit.body).error.code).toBe('CHAT_BLOCKED');
		const timeline = await successfulApiCall({ endpoint: 'chat/messages/user-timeline', parameters: { userId: alice.id }, user: bob });
		expect(timeline.some(item => item.id === message.id)).toBe(true);
		expect((await successfulApiCall({ endpoint: 'users/show', parameters: { userId: bob.id }, user: alice })).isFollowing).toBe(true);
		await successfulApiCall({ endpoint: 'chat/messages/delete', parameters: { messageId: message.id }, user: alice });
		await successfulApiCall({ endpoint: 'chat/blocking/delete', parameters: { userId: bob.id }, user: alice });
		await successfulApiCall({ endpoint: 'chat/messages/create-to-user', parameters: { toUserId: bob.id, text: 'After unblock' }, user: alice });
	});

	test('a group does not grant permission through native global blocking', async () => {
		await successfulApiCall({ endpoint: 'blocking/create', parameters: { userId: carol.id }, user: bob });
		const response = await api('chat/messages/create-to-user', { toUserId: bob.id, text: 'Global block' }, carol);
		expect(response.status).toBeGreaterThanOrEqual(400);
	});

	test('native blocking racing a send never permits sends after the block commits', async () => {
		const sender = await signup({ username: 'chatracesender' });
		const recipient = await signup({ username: 'chatracerecipient' });
		await successfulApiCall({ endpoint: 'i/update', parameters: { chatScope: 'everyone' }, user: recipient });
		for (let round = 0; round < 3; round++) {
			const [block, send] = await Promise.all([
				api('blocking/create', { userId: sender.id }, recipient),
				api('chat/messages/create-to-user', { toUserId: recipient.id, text: `Race ${round}` }, sender),
			]);
			expect(block.status).toBe(200);
			// The concurrent send may serialize before or after the block, but never 500.
			expect(send.status).toBeLessThan(500);
			const denied = await api('chat/messages/create-to-user', { toUserId: recipient.id, text: 'After commit' }, sender);
			expect(denied.status).toBeGreaterThanOrEqual(400);
			expect(denied.status).toBeLessThan(500);
			await successfulApiCall({ endpoint: 'blocking/delete', parameters: { userId: sender.id }, user: recipient });
		}
	});
});
