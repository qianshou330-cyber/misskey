/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { UserProfilesRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { SmsService } from '@/core/SmsService.js';

export const meta = { tags: ['account'], requireCredential: true, kind: 'write:account' } as const;
export const paramDef = { type: 'object', properties: { phoneNumber: { type: 'string' }, smsCode: { type: 'string', minLength: 6, maxLength: 6 } }, required: ['phoneNumber', 'smsCode'] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(@Inject(DI.db) private db: DataSource, @Inject(DI.userProfilesRepository) private profiles: UserProfilesRepository, private sms: SmsService) {
		super(meta, paramDef, async (ps, me) => {
			const phone = this.sms.normalize(ps.phoneNumber);
			const rows = await this.db.query('SELECT * FROM "sms_verification" WHERE "phoneHash" = $1 AND "purpose" = $2 AND "consumedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1', [this.sms.hash(phone), 'signup']);
			const challenge = rows[0];
			if (!challenge || new Date(challenge.expiresAt).getTime() < Date.now() || challenge.attempts >= 5 || this.sms.hash(ps.smsCode) !== challenge.codeHash) {
				if (challenge) await this.db.query('UPDATE "sms_verification" SET "attempts" = "attempts" + 1 WHERE "id" = $1', [challenge.id]);
				throw new Error('INVALID_SMS_CODE');
			}
			await this.db.query('UPDATE "sms_verification" SET "consumedAt" = now() WHERE "id" = $1', [challenge.id]);
			const duplicate = await this.profiles.findOneBy({ phoneNumber: phone });
			if (duplicate && duplicate.userId !== me!.id) throw new Error('PHONE_ALREADY_BOUND');
			await this.profiles.update(me!.id, { phoneNumber: phone, phoneVerified: true });
		});
	}
}
