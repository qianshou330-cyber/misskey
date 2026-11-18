/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import 'reflect-metadata';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatAttachmentService } from './ChatAttachmentService.js';
import { ChatVoiceRejectedError } from './ChatVoiceService.js';
import { ChatMessageStateError } from './chat-message-state.js';

vi.mock('@/core/FileInfoService.js', () => ({ FileInfoService: class {} }));
vi.mock('@/core/RoleService.js', () => ({ RoleService: class {} }));
vi.mock('@/core/S3Service.js', () => ({ S3Service: class {} }));
vi.mock('@/core/ChatPermissionService.js', () => ({ ChatPermissionService: class {} }));
vi.mock('@/core/UserStorageQuotaService.js', () => ({ UserStorageQuotaService: class {} }));

describe('voice staging validates permission, actual signature and role before persistence', () => {
	const directories: string[] = [];
	afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });
	const webm = fileURLToPath(new URL('../../test/resources/kick_gaba7.webm', import.meta.url));

	function setup(allowed = ['audio/*']) {
		const info = { detectType: vi.fn(), getFileInfo: vi.fn() };
		const quota = { release: vi.fn(async () => {}), reserve: vi.fn() };
		const convert = vi.fn(async () => { throw new ChatVoiceRejectedError('audio-only verification required'); });
		const permissions = { assertCanSend: vi.fn(async () => {}) };
		const service = new ChatAttachmentService(...[
			{}, { maxFileSize: 50 * 1024 * 1024 }, {}, {},
			{ getUserPolicies: async () => ({ maxFileSizeMb: 50, uploadableFileTypes: allowed }) },
			info, {}, {}, { convert }, quota, permissions,
		] as unknown as ConstructorParameters<typeof ChatAttachmentService>);
		return { service, info, quota, convert, permissions };
	}

	it('does not let voice mode bypass the native conversation permission', async () => {
		const { service, convert, permissions } = setup();
		permissions.assertCanSend.mockRejectedValueOnce(new ChatMessageStateError('RECIPIENT_UNAVAILABLE'));
		await expect(service.create('owner', 'recipient', webm, 'recording.webm', 'voice')).rejects.toThrow('unavailable');
		expect(convert).not.toHaveBeenCalled();
	});

	for (const code of ['CHAT_FIRST_MESSAGE_TEXT_ONLY', 'CHAT_REPLY_REQUIRED'] as const) {
		it.each(['file', 'voice'] as const)(`preserves ${code} for %s uploads before file processing`, async kind => {
			const { service, info, quota, convert, permissions } = setup();
			permissions.assertCanSend.mockRejectedValueOnce(new ChatMessageStateError(code));
			await expect(service.create('owner', 'recipient', webm, 'fixture', kind)).rejects.toMatchObject({ code });
			expect(permissions.assertCanSend).toHaveBeenCalledWith('owner', 'recipient', 'attachment');
			expect(info.detectType).not.toHaveBeenCalled(); expect(convert).not.toHaveBeenCalled(); expect(quota.reserve).not.toHaveBeenCalled();
		});
		it(`preserves ${code} for Drive import before querying or copying its bytes`, async () => {
			const { service, permissions, quota } = setup();
			permissions.assertCanSend.mockRejectedValueOnce(new ChatMessageStateError(code));
			await expect(service.importDrive('owner', 'recipient', 'file')).rejects.toMatchObject({ code });
			expect(permissions.assertCanSend).toHaveBeenCalledWith('owner', 'recipient', 'attachment');
			expect(quota.reserve).not.toHaveBeenCalled();
		});
		it(`preserves ${code} during binding in the caller transaction`, async () => {
			const { service, permissions } = setup();
			const manager = { getRepository: vi.fn() } as unknown as Parameters<ChatAttachmentService['bindToMessage']>[0];
			permissions.assertCanSend.mockRejectedValueOnce(new ChatMessageStateError(code));
			await expect(service.bindToMessage(manager, { ownerId: 'owner', toUserId: 'recipient', messageId: 'message', attachmentIds: ['file'] })).rejects.toMatchObject({ code });
			expect(permissions.assertCanSend).toHaveBeenCalledWith('owner', 'recipient', 'attachment', manager);
			expect(manager.getRepository).not.toHaveBeenCalled();
		});
	}

	it('rejects a fake audio extension without calling the unbounded native media probe', async () => {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-voice-signature-')); directories.push(directory);
		const source = path.join(directory, 'fake.webm'); await fs.writeFile(source, 'This is plain text, not an audio stream.');
		const { service, convert, info } = setup();
		await expect(service.create('owner', 'recipient', source, 'recording.webm', 'voice')).rejects.toThrow('Unsupported voice');
		expect(convert).not.toHaveBeenCalled(); expect(info.detectType).not.toHaveBeenCalled(); expect(info.getFileInfo).not.toHaveBeenCalled();
	});

	it('retains role MIME restrictions for actual signed audio', async () => {
		const { service, convert, info } = setup(['image/*']);
		await expect(service.create('owner', 'recipient', webm, 'disguised.png', 'voice')).rejects.toThrow('type is not allowed');
		expect(convert).not.toHaveBeenCalled(); expect(info.detectType).not.toHaveBeenCalled();
	});

	it('requires the bounded converter to validate audio-only content before reserving or storing', async () => {
		const { service, convert, quota, info } = setup();
		await expect(service.create('owner', 'recipient', webm, 'recording.webm', 'voice')).rejects.toThrow('audio-only verification required');
		expect(convert).toHaveBeenCalledOnce(); expect(quota.reserve).not.toHaveBeenCalled(); expect(info.detectType).not.toHaveBeenCalled();
	});
});
