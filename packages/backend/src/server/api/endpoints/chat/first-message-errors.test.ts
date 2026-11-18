/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import 'reflect-metadata';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatMessageStateError } from '@/core/chat-message-state.js';
import type { MiLocalUser } from '@/models/User.js';
import CreateAttachment, { meta as uploadMeta } from './attachments/create.js';
import ImportAttachment, { meta as importMeta } from './attachments/import-drive.js';
import CreateMessage, { meta as messageMeta } from './messages/create-to-user.js';
import { chatFirstMessageErrors } from './chat-pro-errors.js';

vi.mock('@/core/ChatService.js', () => ({ ChatService: class {}, ChatMessageAccessError: class extends Error {} }));
vi.mock('@/core/ChatAttachmentService.js', () => ({ ChatAttachmentService: class {}, ChatAttachmentError: class extends Error {} }));
vi.mock('@/core/UserStorageQuotaService.js', () => ({ StorageQuotaExceededError: class extends Error {} }));
vi.mock('@/core/ChatVoiceService.js', () => ({ ChatVoiceRejectedError: class extends Error {} }));
vi.mock('@/core/ChatAttachmentStorageService.js', () => ({ ChatStorageUnavailableError: class extends Error {} }));
vi.mock('@/server/api/GetterService.js', () => ({ GetterService: class {} }));
vi.mock('@/core/ChatContactService.js', () => ({ chatContactErrors: { blocked: { code: 'CHAT_BLOCKED', message: 'Blocked', id: 'blocked' } } }));

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });

describe('first-message API errors retain a client status and upload cleanup', () => {
	for (const definition of Object.values(chatFirstMessageErrors)) {
		it(`declares ${definition.code} on all three existing endpoints`, () => {
			for (const meta of [uploadMeta, importMeta, messageMeta]) expect(Object.values(meta.errors)).toContainEqual(definition);
		});
		it(`returns ${definition.code} from multipart upload and removes the temporary file`, async () => {
			const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-first-error-')); directories.push(directory);
			const source = path.join(directory, 'upload'); await fs.writeFile(source, 'synthetic');
			const endpoint = new CreateAttachment({ create: async () => { throw new ChatMessageStateError(definition.code); } } as unknown as ConstructorParameters<typeof CreateAttachment>[0]);
			await expect(endpoint.exec({ toUserId: 'bob' }, { id: 'alice' } as MiLocalUser, null, { path: source, name: 'synthetic' })).rejects.toMatchObject({ code: definition.code, kind: 'client' });
			await expect.poll(async () => fs.stat(source).then(() => true, () => false)).toBe(false);
		});
		it(`returns ${definition.code} from Drive import without wrapping it as attachment rejection`, async () => {
			const endpoint = new ImportAttachment({ importDrive: async () => { throw new ChatMessageStateError(definition.code); } } as unknown as ConstructorParameters<typeof ImportAttachment>[0]);
			await expect(endpoint.exec({ toUserId: 'bob', fileId: 'file' }, { id: 'alice' } as MiLocalUser, null)).rejects.toMatchObject({ code: definition.code, kind: 'client' });
		});
		it(`returns ${definition.code} from message creation`, async () => {
			const endpoint = new CreateMessage(
				{ getUser: async () => ({ id: 'bob' }) } as unknown as ConstructorParameters<typeof CreateMessage>[0],
				{ checkChatAvailability: async () => {}, createMessageToUser: async () => { throw new ChatMessageStateError(definition.code); } } as unknown as ConstructorParameters<typeof CreateMessage>[1],
				{} as ConstructorParameters<typeof CreateMessage>[2],
			);
			await expect(endpoint.exec({ toUserId: 'bob', text: 'Synthetic' }, { id: 'alice' } as MiLocalUser, null)).rejects.toMatchObject({ code: definition.code, kind: 'client' });
		});
	}
});
