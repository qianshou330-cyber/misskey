/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import ListEndpoint, { meta as listMeta } from '@/server/api/endpoints/admin/verification/list.js';
import ApproveEndpoint, { meta as approveMeta } from '@/server/api/endpoints/admin/verification/approve.js';
import { VerificationServiceError } from '@/core/VerificationService.js';
import { VERIFICATION_TYPES } from '@/verification-constants.js';
import type { VerificationService } from '@/core/VerificationService.js';
import type { ModerationLogService } from '@/core/ModerationLogService.js';
import type { VerificationApplicationsRepository, VerificationDocumentsRepository } from '@/models/_.js';
import type { MiLocalUser } from '@/models/User.js';

const admin = { id: 'syntheticadmin' } as MiLocalUser;
const statuses = ['pending', 'approved', 'rejected', 'revoked'] as const;
const applications = statuses.flatMap((status, statusIndex) => VERIFICATION_TYPES.map((type, typeIndex) => ({
	id: `synthetic${statusIndex}${typeIndex}`,
	userId: `syntheticuser${statusIndex}${typeIndex}`,
	status,
	requestedType: type,
	approvedType: status === 'approved' ? type : null,
	description: 'Synthetic application',
	contact: 'synthetic@example.invalid',
	submittedAt: new Date('2026-01-01T00:00:00Z'),
	reviewedAt: null,
	reviewReason: null,
})));

function createListEndpoint() {
	const filters: { status?: string; type?: string } = {};
	let offset = 0;
	let limit = 50;
	const query = {
		orderBy: vi.fn().mockReturnThis(),
		addOrderBy: vi.fn().mockReturnThis(),
		skip: vi.fn((value: number) => { offset = value; return query; }),
		take: vi.fn((value: number) => { limit = value; return query; }),
		where: vi.fn((_sql: string, params: { status: string }) => { filters.status = params.status; return query; }),
		andWhere: vi.fn((_sql: string, params: { type: string }) => { filters.type = params.type; return query; }),
		getMany: vi.fn(async () => applications.filter(row => (
			(filters.status === undefined || row.status === filters.status) &&
			(filters.type === undefined || row.requestedType === filters.type)
		)).slice(offset, offset + limit)),
	};
	const createQueryBuilder = vi.fn(() => query);
	const countBy = vi.fn(async () => 2);
	const log = vi.fn(async () => undefined);
	const endpoint = new ListEndpoint(
		{ createQueryBuilder } as unknown as VerificationApplicationsRepository,
		{ countBy } as unknown as VerificationDocumentsRepository,
		{ log } as unknown as ModerationLogService,
	);
	return { endpoint, query, createQueryBuilder, countBy, log };
}

describe('Verification admin endpoint nullable parameters', () => {
	describe('list', () => {
		it.each([
			{},
			{ status: 'pending', limit: 100, offset: 0 },
			{ type: null },
		])('loads pending applications without a type filter: %j', async params => {
			const { endpoint, query, countBy, log } = createListEndpoint();
			const result = await endpoint.exec({ ...params }, admin, null);
			expect(result.map((row: { id: string }) => row.id)).toEqual(applications.slice(0, 6).map(row => row.id));
			expect(query.where).toHaveBeenCalledWith('application.status = :status', { status: 'pending' });
			expect(query.andWhere).not.toHaveBeenCalled();
			expect(result[0]).toMatchObject({ approvedType: null, documentCount: 2, submittedAt: '2026-01-01T00:00:00.000Z' });
			expect(result[0]).not.toHaveProperty('documents');
			expect(countBy).toHaveBeenCalledTimes(6);
			expect(log).toHaveBeenCalledTimes(6);
			expect(log).toHaveBeenCalledWith(admin, 'viewVerificationApplication', {
				applicationId: 'synthetic00', userId: 'syntheticuser00', view: 'list',
			});
		});

		it.each([...statuses, 'all'])('preserves the %s status filter with nullable type', async status => {
			const { endpoint, query } = createListEndpoint();
			const result = await endpoint.exec({ status, type: null }, admin, null);
			expect(result).toHaveLength(status === 'all' ? 24 : 6);
			if (status === 'all') expect(query.where).not.toHaveBeenCalled();
			else expect(result.every((row: { status: string }) => row.status === status)).toBe(true);
		});

		it.each(VERIFICATION_TYPES)('preserves explicit %s type filtering', async type => {
			const { endpoint, query } = createListEndpoint();
			const result = await endpoint.exec({ status: 'all', type }, admin, null);
			expect(result).toHaveLength(4);
			expect(result.every((row: { requestedType: string }) => row.requestedType === type)).toBe(true);
			expect(query.andWhere).toHaveBeenCalledWith('application.requestedType = :type', { type });
		});

		it('preserves stable pagination and default limits without a type', async () => {
			const first = createListEndpoint();
			await first.endpoint.exec({}, admin, null);
			expect(first.query.skip).toHaveBeenCalledWith(0);
			expect(first.query.take).toHaveBeenCalledWith(50);
			const { endpoint, query } = createListEndpoint();
			const result = await endpoint.exec({ status: 'all', limit: 2, offset: 7 }, admin, null);
			expect(result.map((row: { id: string }) => row.id)).toEqual(['synthetic11', 'synthetic12']);
			expect(query.orderBy).toHaveBeenCalledWith('application.submittedAt', 'ASC');
			expect(query.addOrderBy).toHaveBeenCalledWith('application.id', 'ASC');
		});

		it.each([
			{ type: 'admin' }, { type: '' }, { type: 1 }, { type: [] }, { type: {} },
			{ status: 'unknown' }, { status: null },
			{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { limit: '2' },
			{ offset: -1 }, { offset: 100001 }, { offset: 0.5 },
		])('rejects invalid parameters before accessing applications: %j', async params => {
			const { endpoint, createQueryBuilder, countBy, log } = createListEndpoint();
			await expect(endpoint.exec({ ...params }, admin, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
			expect(createQueryBuilder).not.toHaveBeenCalled();
			expect(countBy).not.toHaveBeenCalled();
			expect(log).not.toHaveBeenCalled();
		});
	});

	describe('approve', () => {
		it.each([undefined, null, ...VERIFICATION_TYPES])('passes %s to the existing review service', async approvedType => {
			const review = vi.fn(async () => undefined);
			const endpoint = new ApproveEndpoint({ review } as unknown as VerificationService);
			const params = approvedType === undefined ? { applicationId: 'synthetic00' } : { applicationId: 'synthetic00', approvedType };
			await endpoint.exec(params, admin, null);
			expect(review).toHaveBeenCalledExactlyOnceWith('synthetic00', 'approve', admin, null, approvedType ?? undefined);
		});

		it.each(['admin', '', 1, [], {}].map(approvedType => ({ approvedType })))('rejects invalid approvedType $approvedType before review', async ({ approvedType }) => {
			const review = vi.fn();
			const endpoint = new ApproveEndpoint({ review } as unknown as VerificationService);
			await expect(endpoint.exec({ applicationId: 'synthetic00', approvedType }, admin, null))
				.rejects.toMatchObject({ code: 'INVALID_PARAM' });
			expect(review).not.toHaveBeenCalled();
		});

		it('preserves the review-service safety error for incomplete documents', async () => {
			const review = vi.fn().mockRejectedValue(new VerificationServiceError('INCOMPLETE_DOCUMENTS'));
			const endpoint = new ApproveEndpoint({ review } as unknown as VerificationService);
			await expect(endpoint.exec({ applicationId: 'synthetic00', approvedType: null }, admin, null))
				.rejects.toMatchObject({ code: 'INCOMPLETE_VERIFICATION_DOCUMENTS' });
		});
	});

	it('keeps admin credentials and scopes required for both endpoints', () => {
		expect(listMeta).toMatchObject({ requireCredential: true, requireAdmin: true, kind: 'read:admin:show-user' });
		expect(approveMeta).toMatchObject({ requireCredential: true, requireAdmin: true, kind: 'write:admin:roles' });
	});
});
