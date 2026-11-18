/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import bcrypt from 'bcryptjs';
import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { SmsService } from '@/core/SmsService.js';

export const meta = { tags: ['reset password'], requireCredential: false } as const;
export const paramDef = { type: 'object', properties: { phoneNumber: { type: 'string' }, smsCode: { type: 'string', minLength: 6, maxLength: 6 }, password: { type: 'string', minLength: 1 }, newPassword: { type: 'string', minLength: 1 } }, required: ['phoneNumber', 'smsCode'] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(@Inject(DI.db) private db: DataSource, private sms: SmsService) {
		super(meta, paramDef, async ps => {
			const newPassword = ps.password ?? ps.newPassword;
			if (!newPassword) throw new Error('PASSWORD_REQUIRED');
			const phone = this.sms.normalize(ps.phoneNumber);
			const rows = await this.db.query('SELECT * FROM "sms_verification" WHERE "phoneHash" = $1 AND "purpose" = $2 AND "consumedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1', [this.sms.hash(phone), 'reset']);
			const challenge = rows[0];
			if (!challenge || new Date(challenge.expiresAt).getTime() < Date.now() || challenge.attempts >= 5 || this.sms.hash(ps.smsCode) !== challenge.codeHash) {
				if (challenge) await this.db.query('UPDATE "sms_verification" SET "attempts" = "attempts" + 1 WHERE "id" = $1', [challenge.id]);
				throw new Error('INVALID_SMS_CODE');
			}
			const profile = await this.db.query('SELECT "userId" FROM "user_profile" WHERE "phoneNumber" = $1 AND "phoneVerified" = true LIMIT 1', [phone]);
			if (profile.length === 0) throw new Error('PHONE_NOT_FOUND');
			const hash = await bcrypt.hash(newPassword, await bcrypt.genSalt(8));
			await this.db.query('UPDATE "user_profile" SET "password" = $1 WHERE "userId" = $2', [hash, profile[0].userId]);
			await this.db.query('UPDATE "sms_verification" SET "consumedAt" = now() WHERE "id" = $1', [challenge.id]);
		});
	}
}
