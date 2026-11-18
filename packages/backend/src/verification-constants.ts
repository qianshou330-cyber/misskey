/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const VERIFICATION_ROLE_ID = '9verificationbadge00000000000000';
export const VERIFICATION_ROLE_NAME = 'PUBO 已认证';
export const VERIFICATION_ROLE_DESCRIPTION = '通过 PUBO 人工审核的认证账号';
export const VERIFICATION_ICON_URL = '/client-assets/verified-blue.svg';
export const VERIFICATION_CONSENT_VERSION = '2026-09-30';

export const VERIFICATION_TYPES = [
	'actor',
	'singer',
	'model',
	'contentCreator',
	'novelist',
	'other',
] as const;

export type VerificationType = typeof VERIFICATION_TYPES[number];
export type VerificationStatus = 'pending' | 'approved' | 'rejected' | 'revoked';

