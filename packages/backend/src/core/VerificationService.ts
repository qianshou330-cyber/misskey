/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { IsNull } from 'typeorm';
import type { DataSource } from 'typeorm';
import { MiUser, type MiLocalUser } from '@/models/User.js';
import { MiRole } from '@/models/Role.js';
import { MiRoleAssignment } from '@/models/RoleAssignment.js';
import { MiModerationLog } from '@/models/ModerationLog.js';
import type { RolesRepository, UsersRepository, VerificationApplicationsRepository, VerificationDocumentsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { IdService } from '@/core/IdService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { LoggerService } from '@/core/LoggerService.js';
import type Logger from '@/logger.js';
import { RoleService } from '@/core/RoleService.js';
import {
	VERIFICATION_ICON_URL,
	VERIFICATION_ROLE_DESCRIPTION,
	VERIFICATION_ROLE_ID,
	VERIFICATION_ROLE_NAME,
	VERIFICATION_TYPES,
	type VerificationStatus,
	type VerificationType,
} from '@/verification-constants.js';

export type VerificationDecision = 'approve' | 'reject' | 'revoke';

export class VerificationServiceError extends Error {
	constructor(public readonly code: 'NO_SUCH_APPLICATION' | 'INVALID_STATUS' | 'INCOMPLETE_DOCUMENTS' | 'INVALID_ROLE') {
		super(code);
	}
}

@Injectable()
export class VerificationService {
	private readonly logger: Logger;

	constructor(
		@Inject(DI.db)
		private db: DataSource,

		@Inject(DI.rolesRepository)
		private rolesRepository: RolesRepository,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.verificationApplicationsRepository)
		private applicationsRepository: VerificationApplicationsRepository,

		@Inject(DI.verificationDocumentsRepository)
		private documentsRepository: VerificationDocumentsRepository,

		private roleService: RoleService,
		private idService: IdService,
		private globalEventService: GlobalEventService,
		private notificationService: NotificationService,
		loggerService: LoggerService,
	) {
		this.logger = loggerService.getLogger('verification');
	}

	private assertVerificationRole(role: MiRole): MiRole {
		const formula = role.condFormula as { id?: string; type?: string; values?: unknown[] };
		const policies = role.policies as Record<string, unknown> | null;
		if (
			role.name !== VERIFICATION_ROLE_NAME ||
			role.description !== VERIFICATION_ROLE_DESCRIPTION ||
			role.color !== '#3b82f6' ||
			role.iconUrl !== VERIFICATION_ICON_URL ||
			role.target !== 'manual' ||
			role.isPublic !== true ||
			role.asBadge !== true ||
			role.isModerator !== false ||
			role.isAdministrator !== false ||
			role.isExplorable !== false ||
			role.preserveAssignmentOnMoveAccount !== false ||
			role.canEditMembersByModerator !== false ||
			role.displayOrder !== 1000 ||
			formula?.id !== 'verification-manual' ||
			formula?.type !== 'and' ||
			!Array.isArray(formula?.values) ||
			formula.values.length !== 0 ||
			policies == null ||
			Object.keys(policies).length !== 0
		) throw new VerificationServiceError('INVALID_ROLE');
		return role;
	}

	public isType(value: string): value is VerificationType {
		return (VERIFICATION_TYPES as readonly string[]).includes(value);
	}

	public async ensureVerificationRole(moderator?: MiLocalUser) {
		let role = await this.rolesRepository.findOneBy({ id: VERIFICATION_ROLE_ID });
		if (role != null) return this.assertVerificationRole(role);

		try {
			role = await this.roleService.create({
				id: VERIFICATION_ROLE_ID,
				name: VERIFICATION_ROLE_NAME,
				description: VERIFICATION_ROLE_DESCRIPTION,
				color: '#3b82f6',
				iconUrl: VERIFICATION_ICON_URL,
				target: 'manual',
				condFormula: { id: 'verification-manual', type: 'and', values: [] },
				isPublic: true,
				asBadge: true,
				isModerator: false,
				isAdministrator: false,
				isExplorable: false,
				preserveAssignmentOnMoveAccount: false,
				canEditMembersByModerator: false,
				displayOrder: 1000,
				policies: {},
			}, moderator);
		} catch (error) {
			if ((error as { code?: string }).code !== '23505') throw error;
			role = await this.rolesRepository.findOneByOrFail({ id: VERIFICATION_ROLE_ID });
		}
		return this.assertVerificationRole(role);
	}

	public async review(
		applicationId: string,
		decision: VerificationDecision,
		reviewer: MiLocalUser,
		reason: string | null,
		approvedType?: VerificationType,
	): Promise<{ status: VerificationStatus; approvedType: VerificationType | null }> {
		const role = await this.ensureVerificationRole(reviewer);
		const result = await this.db.transaction(async manager => {
			const applications = manager.getRepository(this.applicationsRepository.metadata.target);
			const application = await applications.createQueryBuilder('application')
				.setLock('pessimistic_write')
				.where('application.id = :id', { id: applicationId })
				.getOne();
			if (application == null) throw new VerificationServiceError('NO_SUCH_APPLICATION');

			const expectedStatus = decision === 'revoke' ? 'approved' : 'pending';
			if (application.status !== expectedStatus) throw new VerificationServiceError('INVALID_STATUS');
			const documents = manager.getRepository(this.documentsRepository.metadata.target);
			const documentCount = await documents.countBy({ applicationId: application.id });
			if (decision === 'approve' && documentCount < 2) throw new VerificationServiceError('INCOMPLETE_DOCUMENTS');

			let assignment: MiRoleAssignment | null = null;
			if (role != null) {
				const assignments = manager.getRepository(MiRoleAssignment);
				const existing = await assignments.findOneBy({ userId: application.userId, roleId: role.id });
				if (decision === 'approve' && existing == null) {
					assignment = assignments.create({
						id: this.idService.gen(),
						userId: application.userId,
						roleId: role.id,
						expiresAt: null,
					});
					await assignments.insert(assignment);
					await manager.getRepository(MiRole).update(role.id, { lastUsedAt: new Date() });
				} else if (decision === 'approve' && existing != null && existing.expiresAt != null) {
					await assignments.update(existing.id, { expiresAt: null });
					existing.expiresAt = null;
					assignment = existing;
					await manager.getRepository(MiRole).update(role.id, { lastUsedAt: new Date() });
				} else if (decision !== 'approve' && existing != null) {
					await assignments.delete(existing.id);
					assignment = existing;
					await manager.getRepository(MiRole).update(role.id, { lastUsedAt: new Date() });
				}
			}

			const nextStatus: VerificationStatus = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'revoked';
			await applications.update(application.id, {
				status: nextStatus,
				approvedType: decision === 'approve' ? (approvedType ?? application.requestedType) : (decision === 'revoke' ? application.approvedType : null),
				reviewedAt: new Date(),
				reviewerId: reviewer.id,
				reviewReason: reason,
			});
			const user = await manager.getRepository(MiUser).findOneByOrFail({ id: application.userId });
			const reviewLog = manager.getRepository(MiModerationLog).create({
				id: this.idService.gen(),
				userId: reviewer.id,
				type: 'reviewVerification',
				info: {
					applicationId,
					userId: user.id,
					userUsername: user.username,
					userHost: user.host,
					decision,
					verificationType: decision === 'approve' ? (approvedType ?? application.requestedType) : (application.approvedType ?? application.requestedType),
					reason,
				} as MiModerationLog['info'],
			});
			await manager.getRepository(MiModerationLog).save(reviewLog);
			return { application, status: nextStatus, approvedType: decision === 'approve' ? (approvedType ?? application.requestedType) : (decision === 'revoke' ? application.approvedType : null), assignment };
		});

		if (result.assignment != null && decision === 'approve') {
			try {
				this.globalEventService.publishInternalEvent('userRoleAssigned', result.assignment);
			} catch (error) {
				this.logger.error(error instanceof Error ? error : `Unable to publish verification role assignment: ${error}`);
			}
			try {
				await this.notificationService.createNotification(result.application.userId, 'roleAssigned', { roleId: role!.id });
			} catch (error) {
				this.logger.error(error instanceof Error ? error : `Unable to notify verified user: ${error}`);
			}
		} else if (result.assignment != null) {
			try {
				this.globalEventService.publishInternalEvent('userRoleUnassigned', result.assignment);
			} catch (error) {
				this.logger.error(error instanceof Error ? error : `Unable to publish verification role removal: ${error}`);
			}
		}

		return { status: result.status, approvedType: result.approvedType };
	}

	public async getApplication(userId: string) {
		return await this.applicationsRepository.findOneBy({ userId });
	}

	public async getDocuments(applicationId: string) {
		return await this.documentsRepository.find({ where: { applicationId }, order: { side: 'ASC' } });
	}

	public async getStagedDocuments(userId: string) {
		return await this.documentsRepository.find({ where: { userId, applicationId: IsNull() }, order: { createdAt: 'ASC' } });
	}
}
