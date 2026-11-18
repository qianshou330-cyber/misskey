/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import ms from 'ms';
import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { SmsService } from '@/core/SmsService.js';

export const meta = { tags: ['reset password'], requireCredential: false, limit: { duration: ms('1hour'), max: 3 } } as const;
export const paramDef = { type: 'object', properties: { phoneNumber: { type: 'string' }, username: { type: 'string', nullable: true } }, required: ['phoneNumber'] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(@Inject(DI.db) private db: DataSource, private sms: SmsService) {
		super(meta, paramDef, async ps => {
			const phone = this.sms.normalize(ps.phoneNumber);
			const profile = await this.db.query('SELECT "userId" FROM "user_profile" WHERE "phoneNumber" = $1 AND "phoneVerified" = true LIMIT 1', [phone]);
			if (profile.length === 0) return;
			const recent = await this.db.query('SELECT 1 FROM "sms_verification" WHERE "phoneHash" = $1 AND "purpose" = $2 AND "createdAt" > now() - interval \'60 seconds\' LIMIT 1', [this.sms.hash(phone), 'reset']);
			if (recent.length > 0) return;
			const code = await this.sms.issue(phone);
			await this.db.query('INSERT INTO "sms_verification" ("id","phoneHash","codeHash","purpose","expiresAt") VALUES ($1,$2,$3,$4,now() + interval \'5 minutes\')', [randomUUID().replace(/-/g, ''), this.sms.hash(phone), this.sms.hash(code), 'reset']);
		});
	}
}
