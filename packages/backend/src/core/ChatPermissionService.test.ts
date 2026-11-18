/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from 'typeorm';
import { MiUser } from '@/models/User.js';
import { MiBlocking } from '@/models/Blocking.js';
import { MiChatBlocking } from '@/models/ChatBlocking.js';
import { MiChatApproval } from '@/models/ChatApproval.js';
import { MiFollowing } from '@/models/Following.js';
import { MiRole } from '@/models/Role.js';
import { MiRoleAssignment } from '@/models/RoleAssignment.js';
import { ChatContactService } from './ChatContactService.js';
import { ChatPermissionService } from './ChatPermissionService.js';
import { RoleService } from './RoleService.js';

vi.mock('@/core/CacheService.js', () => ({ CacheService: class {} }));
vi.mock('@/core/entities/UserEntityService.js', () => ({ UserEntityService: class {} }));
vi.mock('@/core/GlobalEventService.js', () => ({ GlobalEventService: class {} }));
vi.mock('@/core/ModerationLogService.js', () => ({ ModerationLogService: class {} }));
vi.mock('@/core/FanoutTimelineService.js', () => ({ FanoutTimelineService: class {} }));
vi.mock('@/core/NotificationService.js', () => ({ NotificationService: class {} }));

type AccountKind = 'root' | 'administrator' | 'moderator' | 'ordinary';
type Pair = { from: string; to: string };
const scopes: MiUser['chatScope'][] = ['everyone', 'followers', 'following', 'mutual', 'none'];
const restrictedScopes = scopes.filter(scope => scope !== 'everyone');

function setup(kind: AccountKind = 'administrator', scope: MiUser['chatScope'] = 'none') {
	const sender = { id: 'sender', host: null as string | null, isSuspended: false, isDeleted: false, chatScope: 'mutual' };
	const recipient = { id: 'recipient', host: null as string | null, isSuspended: false, isDeleted: false, chatScope: scope };
	const state = {
		users: [sender, recipient],
		roles: [{ id: 'role', target: 'manual', isAdministrator: kind === 'administrator', isModerator: kind === 'moderator', condFormula: { type: 'isLocal' } }],
		assignments: [{ roleId: 'role', userId: sender.id, expiresAt: null as Date | null }],
		blocks: [] as Pair[], chatBlocks: [] as Pair[], approvals: [] as Pair[], follows: [] as Pair[],
		policies: { sender: 'available', recipient: 'available' } as Record<string, 'available' | 'readonly' | 'unavailable'>,
	};
	const matches = (rows: Pair[], from: string, to: string) => rows.some(row => row.from === from && row.to === to);
	const approvalExists = vi.fn(async ({ userId, otherId }: { userId: string; otherId: string }) => matches(state.approvals, userId, otherId));
	const roleRows = vi.fn(async () => state.roles);
	const assignmentRows = vi.fn(async ({ userId }: { userId: string }) => state.assignments.filter(row => row.userId === userId));
	const query = vi.fn(async (_sql: string, _parameters?: unknown[]) => []);
	const manager = {
		query,
		getRepository: (entity: unknown) => {
			if (entity === MiUser) return {
				findBy: async () => state.users,
				findOneByOrFail: async ({ id }: { id: string }) => state.users.find(user => user.id === id),
			};
			if (entity === MiRole) return { findBy: roleRows };
			if (entity === MiRoleAssignment) return { findBy: assignmentRows };
			if (entity === MiBlocking) return { existsBy: async (pairs: { blockerId: string; blockeeId: string }[]) => pairs.some(pair => matches(state.blocks, pair.blockerId, pair.blockeeId)) };
			if (entity === MiChatBlocking) return { existsBy: async (pairs: { userId: string; targetId: string }[]) => pairs.some(pair => matches(state.chatBlocks, pair.userId, pair.targetId)) };
			if (entity === MiChatApproval) return { existsBy: approvalExists };
			if (entity === MiFollowing) return {
				existsBy: async ({ followerId, followeeId }: { followerId: string; followeeId: string }) => matches(state.follows, followerId, followeeId),
				countBy: async (pairs: { followerId: string; followeeId: string }[]) => pairs.filter(pair => matches(state.follows, pair.followerId, pair.followeeId)).length,
			};
			throw new Error('Unexpected test repository');
		},
	} as unknown as EntityManager;
	const transaction = vi.fn(async (callback: (manager: EntityManager) => Promise<void>) => callback(manager));
	const contacts: ChatContactService = Object.create(ChatContactService.prototype);
	Object.assign(contacts, { db: { transaction } });
	// Exercise the actual administrator and getUserRoles methods. Stale cache access
	// deliberately fails: send authorization must use the supplied transaction.
	const staleCache = vi.fn(() => { throw new Error('Must not use a cached administrator role'); });
	const roles: RoleService = Object.create(RoleService.prototype);
	Object.assign(roles, {
		meta: { rootUserId: kind === 'root' ? sender.id : 'other-root' },
		rolesCache: { fetch: staleCache },
		roleAssignmentByUserIdCache: { fetch: staleCache },
		cacheService: { findUserById: staleCache },
		userEntityService: { isLocalUser: (user: typeof sender) => user.host == null },
	});
	Object.defineProperty(roles, 'getUserPolicies', {
		value: vi.fn(async (id: string, actualManager: EntityManager) => {
			expect(actualManager).toBe(manager);
			return { chatAvailability: state.policies[id] };
		}),
	});
	const isAdministrator = vi.spyOn(roles, 'isAdministrator');
	const service = new ChatPermissionService(contacts, roles);
	return { service, roles, state, sender, recipient, manager, transaction, query, isAdministrator, staleCache, roleRows, assignmentRows, approvalExists };
}

describe('administrator Chat scope exception', () => {
	for (const kind of ['root', 'administrator'] as const) {
		it.each(scopes)(`${kind} may initiate a conversation for scope %s without follows or approval`, async scope => {
			const { service, manager, isAdministrator, approvalExists } = setup(kind, scope);
			await expect(service.assertCanSend('sender', 'recipient', 'newMessage', manager)).resolves.toBeUndefined();
			expect(isAdministrator).toHaveBeenCalledWith({ id: 'sender' }, manager);
			expect(approvalExists).not.toHaveBeenCalled();
		});
	}

	for (const kind of ['ordinary', 'moderator'] as const) {
		it.each(restrictedScopes)(`${kind} preserves scope %s except for a first mutual text`, async scope => {
			const { service, manager } = setup(kind, scope);
			const result = service.assertCanSend('sender', 'recipient', 'newMessage', manager);
			if (scope === 'mutual') await expect(result).resolves.toBeUndefined();
			else await expect(result).rejects.toMatchObject({ code: 'RECIPIENT_UNAVAILABLE' });
		});
	}

	it.each([
		['everyone', [], true],
		['followers', [{ from: 'sender', to: 'recipient' }], true],
		['followers', [{ from: 'recipient', to: 'sender' }], false],
		['following', [{ from: 'recipient', to: 'sender' }], true],
		['following', [{ from: 'sender', to: 'recipient' }], false],
		['mutual', [{ from: 'sender', to: 'recipient' }], true],
		['mutual', [{ from: 'sender', to: 'recipient' }, { from: 'recipient', to: 'sender' }], true],
	] as [MiUser['chatScope'], Pair[], boolean][])('preserves ordinary-user %s follow rules (%j)', async (scope, follows, allowed) => {
		const { service, manager, state } = setup('ordinary', scope);
		state.follows = follows;
		const result = service.assertCanSend('sender', 'recipient', 'newMessage', manager);
		if (allowed) await expect(result).resolves.toBeUndefined();
		else await expect(result).rejects.toMatchObject({ code: 'RECIPIENT_UNAVAILABLE' });
	});

	it('preserves directional conversation approval without granting sender privileges', async () => {
		const { service, manager, state } = setup('ordinary');
		state.approvals = [{ from: 'sender', to: 'recipient' }];
		await expect(service.assertCanSend('sender', 'recipient', 'newMessage', manager)).rejects.toMatchObject({ code: 'RECIPIENT_UNAVAILABLE' });
		state.approvals = [{ from: 'recipient', to: 'sender' }];
		await expect(service.assertCanSend('sender', 'recipient', 'newMessage', manager)).resolves.toBeUndefined();
	});

	it('does not use a recipient administrator role to authorize an ordinary sender', async () => {
		const { service, manager, state } = setup();
		state.assignments[0].userId = 'recipient';
		await expect(service.assertCanSend('sender', 'recipient', 'newMessage', manager)).rejects.toMatchObject({ code: 'RECIPIENT_UNAVAILABLE' });
	});

	for (const kind of ['root', 'administrator'] as const) {
		for (const direction of [{ from: 'sender', to: 'recipient' }, { from: 'recipient', to: 'sender' }]) {
			it.each(['blocks', 'chatBlocks'] as const)(`${kind} cannot bypass %s from ${direction.from}`, async field => {
				const { service, manager, state, isAdministrator } = setup(kind);
				state[field] = [direction];
				await expect(service.assertCanSend('sender', 'recipient', 'newMessage', manager)).rejects.toMatchObject({ code: field === 'chatBlocks' ? 'CHAT_BLOCKED' : 'RECIPIENT_UNAVAILABLE' });
				expect(isAdministrator).not.toHaveBeenCalled();
			});
		}

		for (const side of ['sender', 'recipient'] as const) {
			it.each(['readonly', 'unavailable'] as const)(`${kind} still respects ${side} chatAvailability=%s`, async policy => {
				const { service, manager, state, isAdministrator } = setup(kind);
				state.policies[side] = policy;
				await expect(service.assertCanSend('sender', 'recipient', 'newMessage', manager)).rejects.toMatchObject({ code: 'RECIPIENT_UNAVAILABLE' });
				expect(isAdministrator).not.toHaveBeenCalled();
			});

			it.each(['remote', 'suspended', 'deleted', 'missing'] as const)(`${kind} still rejects a %s ${side}`, async condition => {
				const { service, manager, state, sender, recipient, isAdministrator } = setup(kind);
				const user = side === 'sender' ? sender : recipient;
				if (condition === 'remote') user.host = 'remote.invalid';
				if (condition === 'suspended') user.isSuspended = true;
				if (condition === 'deleted') user.isDeleted = true;
				if (condition === 'missing') state.users = state.users.filter(row => row.id !== user.id);
				await expect(service.assertCanSend('sender', 'recipient', 'newMessage', manager)).rejects.toMatchObject({ code: 'RECIPIENT_UNAVAILABLE' });
				expect(isAdministrator).not.toHaveBeenCalled();
			});
		}

		it(`${kind} still cannot send to itself`, async () => {
			const { service, manager, isAdministrator } = setup(kind);
			await expect(service.assertCanSend('sender', 'sender', 'newMessage', manager)).rejects.toMatchObject({ code: 'RECIPIENT_UNAVAILABLE' });
			expect(isAdministrator).not.toHaveBeenCalled();
		});
	}

	it('rechecks revoked administrator assignments using the transaction, without stale role caches', async () => {
		const { service, manager, state, staleCache, assignmentRows } = setup();
		await expect(service.assertCanSend('sender', 'recipient', 'newMessage', manager)).resolves.toBeUndefined();
		state.assignments = [];
		await expect(service.assertCanSend('sender', 'recipient', 'newMessage', manager)).rejects.toMatchObject({ code: 'RECIPIENT_UNAVAILABLE' });
		expect(assignmentRows).toHaveBeenCalledTimes(2);
		expect(staleCache).not.toHaveBeenCalled();
	});

	it('rejects an expired administrator assignment', async () => {
		const { service, manager, state } = setup();
		state.assignments[0].expiresAt = new Date(Date.now() - 1000);
		await expect(service.assertCanSend('sender', 'recipient', 'newMessage', manager)).rejects.toMatchObject({ code: 'RECIPIENT_UNAVAILABLE' });
	});

	it('rechecks the administrator flag on a currently assigned role', async () => {
		const { service, manager, state } = setup();
		await expect(service.assertCanSend('sender', 'recipient', 'newMessage', manager)).resolves.toBeUndefined();
		state.roles[0].isAdministrator = false;
		state.roles[0].isModerator = true;
		await expect(service.assertCanSend('sender', 'recipient', 'newMessage', manager)).rejects.toMatchObject({ code: 'RECIPIENT_UNAVAILABLE' });
	});

	it('uses current conditional administrator membership from the same transaction', async () => {
		const { service, manager, state, staleCache } = setup();
		state.assignments = [];
		state.roles[0].target = 'conditional';
		await expect(service.assertCanSend('sender', 'recipient', 'newMessage', manager)).resolves.toBeUndefined();
		expect(staleCache).not.toHaveBeenCalled();
	});

	it('starts the existing pair transaction when called without a manager', async () => {
		const { service, manager, transaction, query, isAdministrator } = setup();
		await expect(service.assertCanSend('sender', 'recipient', 'newMessage')).resolves.toBeUndefined();
		expect(transaction).toHaveBeenCalledOnce();
		expect(query.mock.calls[0]).toEqual(['SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', ['chat-pair', 'recipient:sender']]);
		expect(isAdministrator).toHaveBeenCalledWith({ id: 'sender' }, manager);
	});

	it('does not fall back to an administrator grant when current role lookup fails', async () => {
		const { service, manager, roleRows, approvalExists } = setup();
		roleRows.mockRejectedValueOnce(new Error('Current role lookup unavailable'));
		await expect(service.assertCanSend('sender', 'recipient', 'newMessage', manager)).rejects.toThrow('Current role lookup unavailable');
		expect(approvalExists).not.toHaveBeenCalled();
	});

	it('retains the public administrator helper behavior when no transaction is supplied', async () => {
		const { roles } = setup();
		const getRoles = vi.spyOn(roles, 'getUserRoles').mockResolvedValue([{ isAdministrator: true } as MiRole]);
		await expect(roles.isAdministrator(null)).resolves.toBe(false);
		expect(getRoles).not.toHaveBeenCalled();
		await expect(roles.isAdministrator({ id: 'sender' })).resolves.toBe(true);
		expect(getRoles).toHaveBeenCalledWith('sender', undefined);
	});
});

describe('first private message purposes and historical approvals', () => {
	for (const kind of ['ordinary', 'moderator'] as const) {
		it(`${kind} can send a first text, but cannot stage a first attachment`, async () => {
			const { service, manager, state } = setup(kind, 'mutual');
			await expect(service.assertCanSend('sender', 'recipient', 'attachment', manager)).rejects.toMatchObject({ code: 'CHAT_FIRST_MESSAGE_TEXT_ONLY' });
			await expect(service.assertCanSend('sender', 'recipient', 'newMessage', manager)).resolves.toBeUndefined();
			expect(state.approvals).toEqual([]);
		});
	}

	it.each(['newMessage', 'attachment'] as const)('requires a reply for %s when a historical sender approval exists', async purpose => {
		const { service, manager, state } = setup('ordinary', 'mutual');
		state.approvals = [{ from: 'sender', to: 'recipient' }];
		await expect(service.assertCanSend('sender', 'recipient', purpose, manager)).rejects.toMatchObject({ code: 'CHAT_REPLY_REQUIRED' });
	});

	it('does not treat an existing message operation as a second message', async () => {
		const { service, manager, state } = setup('ordinary', 'mutual');
		state.approvals = [{ from: 'sender', to: 'recipient' }];
		await expect(service.assertCanSend('sender', 'recipient', 'existingMessage', manager)).resolves.toBeUndefined();
		state.approvals = []; // Legacy persisted messages may predate approvals.
		await expect(service.assertCanSend('sender', 'recipient', 'existingMessage', manager)).resolves.toBeUndefined();
	});

	for (const purpose of ['newMessage', 'existingMessage', 'attachment'] as const) {
		it.each(scopes)(`a historical recipient approval permits ${purpose} for %s`, async scope => {
			const { service, manager, state } = setup('ordinary', scope);
			state.approvals = [{ from: 'recipient', to: 'sender' }];
			await expect(service.assertCanSend('sender', 'recipient', purpose, manager)).resolves.toBeUndefined();
		});
		it(`mutual follows still permit ${purpose} after an unanswered send`, async () => {
			const { service, manager, state } = setup('ordinary', 'mutual');
			state.approvals = [{ from: 'sender', to: 'recipient' }];
			state.follows = [{ from: 'sender', to: 'recipient' }, { from: 'recipient', to: 'sender' }];
			await expect(service.assertCanSend('sender', 'recipient', purpose, manager)).resolves.toBeUndefined();
		});
		it.each(['root', 'administrator'] as const)(`%s retains the ${purpose} exception while waiting`, async kind => {
			const { service, manager, state } = setup(kind, 'mutual');
			state.approvals = [{ from: 'sender', to: 'recipient' }];
			await expect(service.assertCanSend('sender', 'recipient', purpose, manager)).resolves.toBeUndefined();
		});
	}

	it.each(['followers', 'following', 'none'] as const)('existing operations do not bypass scope %s', async scope => {
		const { service, manager, state } = setup('ordinary', scope);
		state.approvals = [{ from: 'sender', to: 'recipient' }];
		await expect(service.assertCanSend('sender', 'recipient', 'existingMessage', manager)).rejects.toMatchObject({ code: 'RECIPIENT_UNAVAILABLE' });
	});

	it.each(['existingMessage', 'attachment'] as const)('%s retains blocking and current role policy checks', async purpose => {
		const { service, manager, state } = setup('ordinary', 'mutual');
		state.approvals = [{ from: 'recipient', to: 'sender' }];
		state.chatBlocks = [{ from: 'recipient', to: 'sender' }];
		await expect(service.assertCanSend('sender', 'recipient', purpose, manager)).rejects.toMatchObject({ code: 'CHAT_BLOCKED' });
		state.chatBlocks = [];
		state.blocks = [{ from: 'sender', to: 'recipient' }];
		await expect(service.assertCanSend('sender', 'recipient', purpose, manager)).rejects.toMatchObject({ code: 'RECIPIENT_UNAVAILABLE' });
		state.blocks = [];
		state.policies.recipient = 'readonly';
		await expect(service.assertCanSend('sender', 'recipient', purpose, manager)).rejects.toMatchObject({ code: 'RECIPIENT_UNAVAILABLE' });
	});

	it('rejects callers which omit an explicit permission purpose', async () => {
		const { service, manager } = setup('root');
		await expect(service.assertCanSend('sender', 'recipient', undefined as never, manager)).rejects.toThrow('purpose is required');
	});
});
