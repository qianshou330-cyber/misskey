/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash, randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';

const purpose = 'signup';
const template = '【广州蛙声科技有限公司】您的验证码是%，5分钟内有效。请勿泄露给他人。';

function normalize(phone: string): string {
	const value = phone.trim().replace(/[\s-]/g, '').replace(/^\+86/, '');
	if (!/^1[3-9]\d{9}$/.test(value)) throw new Error('INVALID_PHONE_NUMBER');
	return value;
}

function sha(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

@Injectable()
export class SmsService {
	public normalize(phone: string): string { return normalize(phone); }

	public async issue(phoneInput: string): Promise<string> {
		const phone = normalize(phoneInput);
		const account = process.env.MISSKEY_SMS_ACCOUNT;
		const password = process.env.MISSKEY_SMS_PASSWORD;
		const userid = process.env.MISSKEY_SMS_USERID;
		const endpoint = process.env.MISSKEY_SMS_SEND_URL ?? 'http://118.31.174.89:8088/v2sms.aspx?action=send';
		if (!account || !password || !userid) throw new Error('SMS_NOT_CONFIGURED');
		const code = String(randomInt(100000, 1000000));

		// The provider validates timestamp and signature together. Re-sign once when
		// it rejects a request, since a request crossing a timestamp boundary can
		// otherwise fail even when the credentials are correct.
		for (let attempt = 0; attempt < 2; attempt++) {
			const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
			const timestamp = ['year', 'month', 'day', 'hour', 'minute', 'second'].map(type => parts.find(part => part.type === type)?.value ?? '').join('');
			const sign = createHash('md5').update(`${account}${password}${timestamp}`).digest('hex');
			const body = new URLSearchParams({ userid, timestamp, sign, mobile: phone, content: template.replace('%', code), sendTime: '', extno: '', rt: 'json' });
			try {
				const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(10000) });
				const json = await response.json() as { ReturnStatus?: string; SuccessCounts?: number | string };
				const successCount = Number(json.SuccessCounts ?? 0);
				if (response.ok && json.ReturnStatus === 'Success' && successCount >= 1) return code;
			} catch {
				// Retry once with a fresh timestamp and signature.
			}
		}

		throw new Error('SMS_SEND_FAILED');
	}

	public hash(value: string): string { return sha(value); }
	public generateCode(): string { return String(randomInt(100000, 1000000)); }
	public getTemplate(code: string): string { return template.replace('%', code); }
	public getPurpose(): string { return purpose; }
}
