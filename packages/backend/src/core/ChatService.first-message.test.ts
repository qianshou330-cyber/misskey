/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntityManager } from 'typeorm';
import { MiUser } from '@/models/User.js';
import { MiChatMessage } from '@/models/ChatMessage.js';
import { MiChatApproval } from '@/models/ChatApproval.js';
import { MiChatAttachment } from '@/models/ChatAttachment.js';
import { MiChatBlocking } from '@/models/ChatBlocking.js';
import { MiBlocking } from '@/models/Blocking.js';
import { MiFollowing } from '@/models/Following.js';
import { ChatService } from './ChatService.js';
import { ChatContactService } from './ChatContactService.js';
import { ChatPermissionService } from './ChatPermissionService.js';
import type { RoleService } from './RoleService.js';

vi.mock('@/core/QueueService.js', () => ({ QueueService: class {} }));
vi.mock('@/core/GlobalEventService.js', () => ({ GlobalEventService: class {} }));
vi.mock('@/core/entities/UserEntityService.js', () => ({ UserEntityService: class {} }));
vi.mock('@/core/entities/ChatEntityService.js', () => ({ ChatEntityService: class {} }));
vi.mock('@/core/activitypub/ApRendererService.js', () => ({ ApRendererService: class {} }));
vi.mock('@/core/PushNotificationService.js', () => ({ PushNotificationService: class {} }));
vi.mock('@/core/UserBlockingService.js', () => ({ UserBlockingService: class {} }));
vi.mock('@/core/UserFollowingService.js', () => ({ UserFollowingService: class {} }));
vi.mock('@/core/RoleService.js', () => ({ RoleService: class {} }));
vi.mock('@/core/CustomEmojiService.js', () => ({ CustomEmojiService: class {} }));
vi.mock('@/core/NotificationService.js', () => ({ NotificationService: class {} }));
vi.mock('@/core/ModerationLogService.js', () => ({ ModerationLogService: class {} }));
vi.mock('@/core/LoggerService.js', () => ({ LoggerService: class {} }));
vi.mock('@/core/ChatAttachmentService.js', () => ({ ChatAttachmentService: class {} }));
vi.mock('@/core/ChatConversationService.js', () => ({ ChatConversationService: class {} }));

/** Real services with serialized, rollback-capable repositories; HTTP tests cover PostgreSQL. */
function setup() {
	const users = ['alice', 'bob'].map(id => ({ id, host: null, isSuspended: false, isDeleted: false, chatScope: 'mutual' } as MiUser));
	const state = {
		messages: [] as MiChatMessage[], approvals: [] as { userId: string; otherId: string }[],
		activeTransaction: false, failApproval: false, blocked: false, muted: false,
	};
	const matches = (row: MiChatMessage, where: Record<string, unknown>) => Object.entries(where).every(([key, value]) =>
		typeof value === 'object' && value != null && 'type' in value ? value.type === 'isNull' && row[key as keyof MiChatMessage] == null : row[key as keyof MiChatMessage] === value);
	const find = async (where: Record<string, unknown>) => {
		const row = state.messages.find(item => matches(item, where));
		return row ? structuredClone(row) : null;
	};
	const repository = {
		findOneBy: find,
		findOneByOrFail: async (where: Record<string, unknown>) => { const row = await find(where); if (!row) throw new Error('Missing message'); return row; },
		findOne: ({ where }: { where: Record<string, unknown> }) => find(where),
		save: async (input: MiChatMessage) => { const row = { ...input, toRoomId: null }; state.messages.push(structuredClone(row)); return row; },
		createQueryBuilder: () => {
			let values: Record<string, unknown> = {}, where: { id?: string; userId?: string; revision?: number } = {};
			const builder = {
				update: () => builder,
				set: (value: Record<string, unknown>) => { values = value; return builder; },
				where: (_sql: string, value: typeof where) => { where = value; return builder; },
				execute: async () => {
					const row = state.messages.find(item => item.id === where.id && item.fromUserId === where.userId && (where.revision == null || item.revision === where.revision));
					if (!row) return { affected: 0 };
					for (const [key, value] of Object.entries(values)) Object.assign(row, { [key]: typeof value === 'function' ? key === 'revision' ? row.revision + 1 : new Date() : value });
					return { affected: 1 };
				},
			};
			return builder;
		},
	};
	const approvalRepository = {
		existsBy: async ({ userId, otherId }: { userId: string; otherId: string }) => state.approvals.some(row => row.userId === userId && row.otherId === otherId),
		createQueryBuilder: () => {
			let row: { userId: string; otherId: string };
			const builder = {
				insert: () => builder, values: (value: typeof row) => { row = value; return builder; }, orIgnore: () => builder,
				execute: async () => {
					if (state.failApproval) { state.failApproval = false; throw new Error('Approval persistence failed'); }
					if (!await approvalRepository.existsBy(row)) state.approvals.push({ userId: row.userId, otherId: row.otherId });
				},
			};
			return builder;
		},
	};
	const query = vi.fn(async (_sql: string, _parameters: unknown[]) => []);
	const manager = { query, getRepository: (model: unknown) => {
		if (model === MiUser) return { findBy: async () => users };
		if (model === MiChatMessage) return repository;
		if (model === MiChatApproval) return approvalRepository;
		if (model === MiChatBlocking || model === MiBlocking) return { existsBy: async () => state.blocked };
		if (model === MiFollowing) return { countBy: async () => 0 };
		if (model === MiChatAttachment) return { existsBy: async () => false };
		throw new Error('Unexpected repository');
	} } as unknown as EntityManager;
	let pending: Promise<unknown> = Promise.resolve();
	const committed = new Set<string>();
	const transaction = <T>(work: (manager: EntityManager) => Promise<T>): Promise<T> => {
		const result = pending.then(async () => {
			const before = structuredClone({ messages: state.messages, approvals: state.approvals });
			state.activeTransaction = true;
			try {
				const value = await work(manager);
				for (const row of state.messages) committed.add(row.id);
				return value;
			} catch (error) { Object.assign(state, before); throw error; } finally { state.activeTransaction = false; }
		});
		pending = result.catch(() => {});
		return result;
	};
	const contacts: ChatContactService = Object.create(ChatContactService.prototype);
	Object.assign(contacts, { db: { transaction } });
	const policies = { getUserPolicies: async () => ({ chatAvailability: 'available' }), isAdministrator: async () => false } as unknown as RoleService;
	const permissions = new ChatPermissionService(contacts, policies);
	const checkPermission = vi.spyOn(permissions, 'assertCanSend');
	const publish = vi.fn((...args: unknown[]) => {
		const message = args.at(-1);
		if (typeof message === 'object' && message != null && 'id' in message) expect(committed.has(message.id as string)).toBe(true);
	});
	const push = vi.fn(async () => {});
	const warn = vi.fn();
	let serial = 0;
	const service: ChatService = Object.create(ChatService.prototype);
	Object.assign(service, {
		db: { manager },
		chatContactService: contacts, chatPermissionService: permissions, chatMessagesRepository: repository,
		usersRepository: { findOneBy: async ({ id }: { id: string }) => users.find(user => user.id === id) },
		chatConversationService: { isMuted: async () => state.muted }, roleService: policies,
		chatAttachmentService: { revokeMessage: vi.fn(async () => {}) },
		idService: { gen: () => `message${++serial}`, parse: () => ({ date: new Date() }) },
		chatEntityService: { packMessageLiteFor1on1: async (message: MiChatMessage) => message, packMessageDetailed: async (message: MiChatMessage) => message },
		globalEventService: { publishChatUserStream: publish, publishMainStream: publish },
		pushNotificationService: { pushNotification: push }, loggerService: { getLogger: () => ({ warn }) },
	});
	const send = (text = 'Hello 😊', nonce = 'first', from = users[0], to = users[1], extra: Partial<Parameters<ChatService['createMessageToUser']>[2]> = {}) =>
		service.createMessageToUser(from, to, { text, clientMessageId: nonce, ...extra });
	return { service, state, send, users, query, manager, checkPermission, publish, push, warn };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('first message transaction and existing-message operations', () => {
	it('commits a first text and only one directional approval, then rejects a second nonce', async () => {
		const { send, state } = setup();
		await send();
		expect(state.approvals).toEqual([{ userId: 'alice', otherId: 'bob' }]);
		await expect(send('Second', 'second')).rejects.toMatchObject({ code: 'CHAT_REPLY_REQUIRED' });
		expect(state.messages).toHaveLength(1);
	});

	it('serializes simultaneous first sends before checking approvals', async () => {
		const { send, state, query } = setup();
		const results = await Promise.allSettled([send('One', 'one'), send('Two', 'two')]);
		expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
		expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'CHAT_REPLY_REQUIRED' } });
		expect(state.messages).toHaveLength(1);
		expect(query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', ['chat-pair', 'alice:bob']);
	});

	it('returns the same committed message for concurrent nonce retries and rejects altered content', async () => {
		const { send, state, publish } = setup();
		const [first, retry] = await Promise.all([send(), send()]);
		expect(retry.id).toBe(first.id);
		expect(state.messages).toHaveLength(1);
		expect(publish).toHaveBeenCalledTimes(4);
		await expect(send('Changed')).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
	});

	it('rolls the message back if approval persistence fails and leaves the first chance available', async () => {
		const { send, state, publish } = setup();
		state.failApproval = true;
		await expect(send()).rejects.toThrow('Approval persistence failed');
		expect(state.messages).toEqual([]); expect(state.approvals).toEqual([]); expect(publish).not.toHaveBeenCalled();
		await expect(send()).resolves.toMatchObject({ text: 'Hello 😊' });
	});

	it('rejects invalid reply targets and blank messages without consuming the first chance', async () => {
		const { send, state, users } = setup();
		await expect(send(' ', 'blank')).rejects.toMatchObject({ code: 'CONTENT_REQUIRED' });
		await expect(send('Hi', 'badReply', users[0], users[1], { replyToId: 'missing' })).rejects.toMatchObject({ code: 'REPLY_TARGET_UNAVAILABLE' });
		expect(state.approvals).toEqual([]); expect(state.messages).toEqual([]);
		await expect(send()).resolves.toBeTruthy();
	});

	it('rejects a first attachment before its binding callback or either persistence write', async () => {
		const { send, state, users } = setup();
		const bindAttachments = vi.fn(async () => {});
		await expect(send('Hi', 'withFile', users[0], users[1], { attachmentIds: ['file'], bindAttachments })).rejects.toMatchObject({ code: 'CHAT_FIRST_MESSAGE_TEXT_ONLY' });
		expect(bindAttachments).not.toHaveBeenCalled(); expect(state.messages).toEqual([]); expect(state.approvals).toEqual([]);
		await send();
		await expect(send('Hi', 'secondFile', users[0], users[1], { attachmentIds: ['file'], bindAttachments })).rejects.toMatchObject({ code: 'CHAT_REPLY_REQUIRED' });
	});

	it('requires a successfully committed reply before normal chatting resumes', async () => {
		const { send, state, users } = setup();
		await send();
		state.failApproval = true;
		await expect(send('Reply', 'reply', users[1], users[0])).rejects.toThrow('Approval persistence failed');
		await expect(send('Still waiting', 'waiting')).rejects.toMatchObject({ code: 'CHAT_REPLY_REQUIRED' });
		await send('Reply', 'reply', users[1], users[0]);
		await expect(send('Now allowed', 'normal')).resolves.toBeTruthy();
		expect(state.approvals).toHaveLength(2);
	});

	it('edits an existing first text while retaining the pending reply limit', async () => {
		const { send, service, state, checkPermission, manager } = setup();
		const first = await send();
		await expect(service.updateUserMessage('alice', first.id, 'Edited 😊', 0)).resolves.toMatchObject({ text: 'Edited 😊', revision: 1 });
		expect(checkPermission).toHaveBeenCalledWith('alice', 'bob', 'existingMessage', manager);
		await expect(send('Another', 'another')).rejects.toMatchObject({ code: 'CHAT_REPLY_REQUIRED' });
		expect(state.messages).toHaveLength(1);
	});

	it('delivers the first delayed notification after its approval is committed', async () => {
		const { send, service, push, warn, checkPermission, manager } = setup();
		const first = await send();
		await expect(service.canNotifyUserMessage('bob', first.id)).resolves.toBe(true);
		await vi.advanceTimersByTimeAsync(3000);
		expect(push).toHaveBeenCalledOnce(); expect(warn).not.toHaveBeenCalled();
		expect(checkPermission).toHaveBeenCalledWith('alice', 'bob', 'existingMessage', manager);
	});

	it('still blocks delayed notification and edit when a block is added after the first send', async () => {
		const { send, service, state, push } = setup();
		const first = await send(); state.blocked = true;
		await vi.advanceTimersByTimeAsync(3000);
		expect(push).not.toHaveBeenCalled();
		await expect(service.updateUserMessage('alice', first.id, 'Cannot edit', 0)).rejects.toMatchObject({ code: 'CHAT_BLOCKED' });
	});

	it('recall does not restore the first-message allowance or lose an idempotent receipt', async () => {
		const { send, service, state } = setup();
		const first = await send();
		await service.deleteMessage(state.messages[0]);
		await expect(send('Again', 'another')).rejects.toMatchObject({ code: 'CHAT_REPLY_REQUIRED' });
		await expect(send()).resolves.toMatchObject({ id: first.id, text: null });
		expect(state.approvals).toHaveLength(1);
	});

	it('a new service instance uses persisted approvals rather than an in-memory allowance', async () => {
		const first = setup(); await first.send();
		const restarted = setup(); restarted.state.approvals = structuredClone(first.state.approvals);
		await expect(restarted.send('After restart', 'restart')).rejects.toMatchObject({ code: 'CHAT_REPLY_REQUIRED' });
	});
});
