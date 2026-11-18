/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Blob, FormData } from 'node-fetch';
import { beforeAll, describe, expect, test } from 'vitest';
import type * as Misskey from 'misskey-js';
import type { ChatAttachmentDto } from '@/core/ChatAttachmentService.js';
import { MiUser } from '@/models/User.js';
import { MiAccessToken } from '@/models/AccessToken.js';
import { MiApp } from '@/models/App.js';
import { generateNativeUserToken } from '@/misc/token.js';
import { api, createAppToken, initTestDb, relativeFetch, signup, uploadFile } from '../utils.js';
import type { UserToken } from '../utils.js';

describe('Chat private attachment HTTP and persistence', () => {
	let alice: Misskey.entities.SignupResponse;
	let bob: Misskey.entities.SignupResponse;
	let carol: Misskey.entities.SignupResponse;

	beforeAll(async () => {
		alice = await signup({ username: 'chat_file_alice' });
		bob = await signup({ username: 'chat_file_bob' });
		carol = await signup({ username: 'chat_file_carol' });
		for (const user of [alice, bob, carol]) expect((await api('i/update', { chatScope: 'everyone' }, user)).status).toBe(200);
	});

	async function upload(owner: UserToken, recipient = bob.id, image = false) {
		const bytes = image ? await readFile(new URL('../resources/192.jpg', import.meta.url)) : Buffer.from(`private-${randomUUID()}`);
		return uploadNamed(owner, image ? 'picture.jpg' : 'fixture.txt', bytes, recipient);
	}

	async function uploadNamed(owner: UserToken, name: string, bytes: Buffer, recipient = bob.id) {
		const form = new FormData();
		form.append('file', new Blob([new Uint8Array(bytes)], { type: 'text/plain' }), name);
		form.append('toUserId', recipient);
		form.append('kind', 'file');
		return relativeFetch('api/chat/attachments/create', { method: 'POST', headers: { Authorization: `Bearer ${owner.token}` }, body: form });
	}

	async function staged(owner: UserToken = alice, recipient = bob.id, image = false): Promise<ChatAttachmentDto> {
		const response = await upload(owner, recipient, image);
		if (response.status !== 200) {
			const error = await response.json() as { error?: { code?: string } };
			throw new Error(`Attachment upload rejected: ${error.error?.code ?? response.status}`);
		}
		expect(response.status).toBe(200);
		return await response.json() as ChatAttachmentDto;
	}

	async function media(id: string, user?: UserToken, variant = 'original', headers: Record<string, string> = {}) {
		return relativeFetch(`api/chat/attachments/${id}/${variant}`, { headers: { ...(user ? { Authorization: `Bearer ${user.token}` } : {}), ...headers }, redirect: 'manual' });
	}

	test('matches native Drive text fallback but does not override detected binary types with an extension or MIME hint', async () => {
		for (const [name, mime, contents] of [['fixture.txt', 'text/plain', 'plain text'], ['fixture.csv', 'text/csv', 'one,two\n1,2'], ['fixture.json', 'application/json', '{"fixture":true}']]) {
			const response = await uploadNamed(alice, name, Buffer.from(contents));
			expect(response.status).toBe(200);
			const attachment = await response.json() as ChatAttachmentDto;
			expect(attachment.mime).toBe(mime);
			await api('chat/attachments/delete', { attachmentId: attachment.id }, alice);
		}
		for (const [name, contents] of [['unknown.bin', 'unknown binary fixture'], ['disguised.txt', '%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n']]) {
			const response = await uploadNamed(alice, name, Buffer.from(contents));
			expect(response.status).toBe(400);
			expect((await response.json() as { error: { code: string } }).error.code).toBe('CHAT_ATTACHMENT_REJECTED');
		}
	});

		test('multipart upload stays private and combined quota includes staged bytes', async () => {
		const before = (await api('drive', {}, alice)).body;
		const attachment = await staged();
		expect(attachment.legacyExposure).toBe('none');
		const metadata = await api('chat/attachments/show', { attachmentId: attachment.id }, alice);
		expect(metadata.status).toBe(200); expect(metadata.body).toEqual(attachment);
		for (const reader of [bob, carol]) expect((await api('chat/attachments/show', { attachmentId: attachment.id }, reader)).status).toBeGreaterThanOrEqual(400);
		for (const field of ['url', 'fileId', 'storageKey', 'accessKey']) expect(attachment).not.toHaveProperty(field);
		const after = (await api('drive', {}, alice)).body;
		expect(after.chatUsage - before.chatUsage).toBe(attachment.size);
		expect(after.reservedUsage).toBe(0);
		expect((await media(attachment.id)).status).toBe(401);
		expect((await media(attachment.id, bob)).status).toBe(404);
		expect((await media(attachment.id, alice)).status).toBe(200);
		expect((await api('chat/attachments/delete', { attachmentId: attachment.id }, carol)).status).toBe(204);
		expect((await media(attachment.id, alice)).status).toBe(200);
		expect((await api('chat/attachments/delete', { attachmentId: attachment.id }, alice)).status).toBe(204);
		expect((await media(attachment.id, alice)).status).toBe(404);
		expect((await api('chat/attachments/show', { attachmentId: attachment.id }, alice)).status).toBeGreaterThanOrEqual(400);
		expect((await api('drive', {}, alice)).body.chatUsage).toBe(before.chatUsage);
	});

	test('binds multiple attachments atomically, rejects forged ownership/recipient, and reuses a nonce', async () => {
		const first = await staged(), second = await staged();
		const wrong = await api('chat/messages/create-to-user', { toUserId: carol.id, attachmentIds: [first.id] }, alice);
		expect(wrong.status).toBeGreaterThanOrEqual(400);
		const stolen = await api('chat/messages/create-to-user', { toUserId: bob.id, attachmentIds: [first.id] }, carol);
		expect(stolen.status).toBeGreaterThanOrEqual(400);
		const params = { toUserId: bob.id, attachmentIds: [first.id, second.id], clientMessageId: randomUUID() };
		const responses = await Promise.all([api('chat/messages/create-to-user', params, alice), api('chat/messages/create-to-user', params, alice)]);
		expect(responses.map(response => response.status)).toEqual([200, 200]);
		expect(responses[0].body.id).toBe(responses[1].body.id);
		expect(responses[0].body.attachments.map(value => value.id)).toEqual([first.id, second.id]);
		expect(responses[0].body.fileId).toBeNull(); expect(responses[0].body.file).toBeNull();
		expect((await media(first.id, bob)).status).toBe(200);
		expect((await media(first.id, carol)).status).toBe(404);
		for (const reader of [alice, bob]) expect((await api('chat/attachments/show', { attachmentId: first.id }, reader)).body.id).toBe(first.id);
		expect((await api('chat/attachments/show', { attachmentId: first.id }, carol)).status).toBeGreaterThanOrEqual(400);
		const retry = await api('chat/messages/create-to-user', { ...params, attachmentIds: [second.id, first.id] }, alice);
		expect(retry.status).toBeGreaterThanOrEqual(400);
		expect((await api('chat/attachments/delete', { attachmentId: first.id }, alice)).status).toBeGreaterThanOrEqual(400);
		expect((await api('chat/messages/delete', { messageId: responses[0].body.id }, alice)).status).toBe(204);
		for (const owner of [alice, bob, carol]) {
			expect((await media(first.id, owner)).status).toBe(404);
			expect((await api('chat/attachments/show', { attachmentId: first.id }, owner)).status).toBeGreaterThanOrEqual(400);
		}
	});

	test('image variants recheck bearer scope, ranges, recall and no-store without redirects', async () => {
		const attachment = await staged(alice, bob.id, true);
		expect(attachment.hasPreview).toBe(true);
		const sent = await api('chat/messages/create-to-user', { toUserId: bob.id, attachmentIds: [attachment.id] }, alice);
		expect(sent.status).toBe(200);
		const insufficient = { token: await createAppToken(bob, ['read:account']) };
		const reader = { token: await createAppToken(bob, ['read:chat']) };
		expect((await api('chat/attachments/show', { attachmentId: attachment.id }, insufficient)).status).toBeGreaterThanOrEqual(400);
		expect((await api('chat/attachments/show', { attachmentId: attachment.id }, reader)).body.id).toBe(attachment.id);
		for (const variant of ['original', 'preview', 'download']) {
			expect((await media(attachment.id, insufficient, variant)).status).toBe(403);
			expect((await media(attachment.id, carol, variant)).status).toBe(404);
			const allowed = await media(attachment.id, reader, variant, { Range: 'bytes=0-3' });
			expect(allowed.status).toBe(206);
			expect(allowed.headers.get('cache-control')).toContain('no-store');
			expect(allowed.headers.get('location')).toBeNull();
			expect((await allowed.arrayBuffer()).byteLength).toBe(4);
		}
		expect((await media(attachment.id, bob, 'original', { Range: 'bytes=999999999-' })).status).toBe(416);
		await api('chat/messages/delete', { messageId: sent.body.id }, alice);
		for (const variant of ['original', 'preview', 'download']) expect((await media(attachment.id, reader, variant)).status).toBe(404);
	});

	test('imports only the owner Drive file into separate private grants with exposure disclosure', async () => {
		const drive = await uploadFile(alice);
		expect(drive.status).toBe(200);
		const params = { toUserId: bob.id, fileId: drive.body!.id };
		expect((await api('chat/attachments/import-drive', params, carol)).status).toBeGreaterThanOrEqual(400);
		const imported = await api('chat/attachments/import-drive', params, alice);
		expect(imported.status).toBe(200);
		expect(imported.body.legacyExposure).toBe('possible');
		expect(imported.body.sourceRetainedShared).toBe(true);
		expect(imported.body).not.toHaveProperty('url');
		expect((await media(imported.body.id, bob)).status).toBe(404);
		expect((await api('drive/files/show', { fileId: drive.body!.id }, alice)).status).toBe(200);
	});

	test('requires chat write scope and rechecks a new block at upload and bind', async () => {
		const noScope = { token: await createAppToken(alice, ['read:chat']) };
		expect((await upload(noScope)).status).toBeGreaterThanOrEqual(400);
		const attachment = await staged();
		await api('chat/blocking/create', { userId: alice.id }, bob);
		try {
			expect((await upload(alice)).status).toBeGreaterThanOrEqual(400);
			expect((await api('chat/messages/create-to-user', { toUserId: bob.id, attachmentIds: [attachment.id] }, alice)).status).toBeGreaterThanOrEqual(400);
		} finally { await api('chat/blocking/delete', { userId: alice.id }, bob); }
		expect((await api('chat/attachments/delete', { attachmentId: attachment.id }, alice)).status).toBe(204);
	});

	test('show immediately rejects changed native sessions and revoked app scope despite authentication caches', async () => {
		const attachment = await staged();
		expect((await api('chat/messages/create-to-user', { toUserId: bob.id, attachmentIds: [attachment.id] }, alice)).status).toBe(200);
		const params = { attachmentId: attachment.id };
		const reader = { token: await createAppToken(bob, ['read:chat']) };
		const appResult = await api('app/create', { name: 'Chat metadata test', description: 'Isolated authorization fixture', permission: ['read:chat'] }, bob);
		expect(appResult.status).toBe(200);
		const db = await initTestDb(true);
		try {
			const access = await db.getRepository(MiAccessToken).findOneBy({ token: reader.token });
			if (!access) throw new Error('Isolated authorization fixture token was not created');
			// Exercise the legacy app branch and its app-permission cache using a
			// disposable credential; the ordinary helper creates a MiAuth token.
			await db.getRepository(MiAccessToken).update(access.id, { appId: appResult.body.id });
			const app = await db.getRepository(MiApp).findOneByOrFail({ id: appResult.body.id });
			expect((await api('chat/attachments/show', params, reader)).status).toBe(200);
			expect((await api('chat/attachments/show', params, bob)).status).toBe(200);
			await db.getRepository(MiApp).update(app.id, { permission: [] });
			expect((await api('chat/attachments/show', params, reader)).status).toBeGreaterThanOrEqual(400);
			expect((await media(attachment.id, reader)).status).toBe(403);
			await db.getRepository(MiApp).update(app.id, { permission: app.permission });
			await db.getRepository(MiUser).update(bob.id, { token: generateNativeUserToken() });
			expect((await api('chat/attachments/show', params, bob)).status).toBeGreaterThanOrEqual(400);
			expect((await media(attachment.id, bob)).status).toBe(403);
			await db.getRepository(MiUser).update(bob.id, { token: bob.token });
			await db.getRepository(MiAccessToken).delete(access.id);
			expect((await api('chat/attachments/show', params, reader)).status).toBeGreaterThanOrEqual(400);
		} finally {
			await db.getRepository(MiUser).update(bob.id, { token: bob.token });
			await db.destroy();
		}
	});
});
