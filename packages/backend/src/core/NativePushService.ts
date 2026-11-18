/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DataSource, MoreThan } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type { MiLocalUser } from '@/models/User.js';
import { MiAccessToken } from '@/models/AccessToken.js';
import { MiApp } from '@/models/App.js';
import { MiNativePushSubscription } from '@/models/NativePushSubscription.js';
import { nativeCredentialHash, nativePushCredentials } from '@/misc/native-push.js';
import type { NativePushQueue } from '@/core/QueueModule.js';
import { IdService } from '@/core/IdService.js';
import Logger from '@/logger.js';

export class NativePushRegistrationError extends Error {
	constructor(public readonly code: 'NATIVE_PUSH_DISABLED' | 'NATIVE_PUSH_DEVICE_LIMIT' | 'NATIVE_PUSH_SCOPE_REQUIRED' | 'NATIVE_PUSH_ENVIRONMENT_MISMATCH' | 'NATIVE_PUSH_STALE_OPERATION') { super(code); }
}

export type NativePushIdentity = { installationId: string; environment: 'development' | 'production'; bundleId: string; revision: number };
export type NativePushRegistration = NativePushIdentity & { deviceToken: string };

@Injectable()
export class NativePushService {
	private readonly logger = new Logger('native-push');
	constructor(
		@Inject(DI.config) private config: Config,
		@Inject(DI.db) private db: DataSource,
		@Inject('queue:nativePush') private queue: NativePushQueue,
		private idService: IdService,
	) {}

	public async register(user: MiLocalUser, token: MiAccessToken | null, input: NativePushRegistration) {
		const credentials = await nativePushCredentials(this.config.nativePush);
		if (!credentials) throw new NativePushRegistrationError('NATIVE_PUSH_DISABLED');
		if (input.environment !== credentials.environment || input.bundleId !== credentials.bundleId) throw new NativePushRegistrationError('NATIVE_PUSH_ENVIRONMENT_MISMATCH');
		const storedToken = token ? await this.db.getRepository(MiAccessToken).findOneBy({ id: token.id, userId: user.id }) : null;
		const permission = storedToken?.appId ? (await this.db.getRepository(MiApp).findOneBy({ id: storedToken.appId }))?.permission : storedToken?.permission;
		if (token && (!storedToken || !permission?.includes('read:notifications') || !permission.includes('write:notifications'))) throw new NativePushRegistrationError('NATIVE_PUSH_SCOPE_REQUIRED');
		const credential = token ? storedToken?.hash : user.token;
		if (!credential) throw new NativePushRegistrationError('NATIVE_PUSH_SCOPE_REQUIRED');
		const credentialHash = nativeCredentialHash(credential);
		const installationId = input.installationId.toLowerCase();
		const deviceToken = input.deviceToken.toLowerCase();
		return this.db.transaction(async manager => {
			// Serialize account limits and both device identities; all writers use this lock order.
			const locks = [`account:${user.id}`, `install:${installationId}:${input.environment}`, `device:${deviceToken}:${input.environment}`].sort();
			for (const lock of locks) await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`native-push:${lock}`]);
			const repository = manager.getRepository(MiNativePushSubscription);
			const installation = await repository.findBy({ installationId, bundleId: input.bundleId, environment: input.environment });
			const previous = installation.find(row => row.userId === user.id);
			const revision = input.revision;
			const now = new Date();
			const expiresAt = new Date(now.getTime() + 30 * 86_400_000);
			if (installation.some(row => BigInt(row.revision) >= BigInt(revision))) {
				if (!installation.some(row => BigInt(row.revision) > BigInt(revision)) && previous?.revision === revision && previous.deviceToken === deviceToken && previous.credentialHash === credentialHash && previous.enabled) return { subscriptionId: previous.id, expiresAt: previous.expiresAt.toISOString() };
				throw new NativePushRegistrationError('NATIVE_PUSH_STALE_OPERATION');
			}
			const active = await repository.findBy({ userId: user.id, enabled: true, expiresAt: MoreThan(now) });
			const remaining = active.filter(row => !(row.environment === input.environment && row.bundleId === input.bundleId && (row.installationId === installationId || row.deviceToken === deviceToken)));
			if (remaining.length >= 10) throw new NativePushRegistrationError('NATIVE_PUSH_DEVICE_LIMIT');
			// Keep former installation revisions as disabled tombstones; old delayed calls cannot resurrect them.
			await repository.update({ deviceToken, bundleId: input.bundleId, environment: input.environment }, { enabled: false, deviceToken: null });
			await repository.update({ installationId, bundleId: input.bundleId, environment: input.environment }, { enabled: false, deviceToken: null });
			if (previous) await repository.delete(previous.id);
			const subscriptionId = this.idService.gen();
			await repository.insert({ id: subscriptionId, userId: user.id, accessTokenId: token?.id ?? null, credentialHash, installationId, deviceToken, revision, environment: input.environment, bundleId: input.bundleId, enabled: true, updatedAt: now, expiresAt });
			return { subscriptionId, expiresAt: expiresAt.toISOString() };
		});
	}

	public async unregister(userId: string, input: NativePushIdentity): Promise<void> {
		// Available while globally disabled. Retain ordering even if the first registration is still in transit.
		const installationId = input.installationId.toLowerCase();
		await this.db.transaction(async manager => {
			for (const lock of [`account:${userId}`, `install:${installationId}:${input.environment}`].sort()) await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`native-push:${lock}`]);
			const repository = manager.getRepository(MiNativePushSubscription);
			const previous = await repository.findOneBy({ userId, installationId, bundleId: input.bundleId, environment: input.environment });
			if (previous && BigInt(previous.revision) >= BigInt(input.revision)) return;
			const now = new Date();
			if (previous) await repository.update(previous.id, { enabled: false, deviceToken: null, revision: input.revision, updatedAt: now, accessTokenId: null, credentialHash: '' });
			else await repository.insert({ id: this.idService.gen(), userId, installationId, environment: input.environment, bundleId: input.bundleId, revision: input.revision, deviceToken: null, accessTokenId: null, credentialHash: '', enabled: false, updatedAt: now, expiresAt: now });
		});
	}

	public async enqueue(userId: string, kind: 'notification' | 'chat', eventId: string): Promise<void> {
		if (this.config.nativePush?.enabled !== true) return;
		try {
			const subscriptions = await this.db.getRepository(MiNativePushSubscription).findBy({ userId, enabled: true, expiresAt: MoreThan(new Date()) });
			for (const subscription of subscriptions) {
				await this.queue.add('deliver', { subscriptionId: subscription.id, userId, kind, eventId, apnsId: randomUUID(), createdAt: Date.now() }, {
					jobId: nativeCredentialHash(`${subscription.id}:${kind}:${eventId}`),
					attempts: 3, backoff: { type: 'exponential', delay: 15_000 },
					removeOnComplete: { age: 86_400, count: 10_000 }, removeOnFail: { age: 86_400, count: 1_000 },
				});
			}
		} catch { this.logger.warn('Unable to enqueue native notification'); }
	}
}
