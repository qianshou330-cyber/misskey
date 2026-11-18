/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { DataSource, IsNull } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { RegistrationTicketsRepository, UsedUsernamesRepository, UserPendingsRepository, UserProfilesRepository, UsersRepository, MiRegistrationTicket, MiMeta } from '@/models/_.js';
import type { Config } from '@/config.js';
import { CaptchaService } from '@/core/CaptchaService.js';
import { IdService } from '@/core/IdService.js';
import { SignupService } from '@/core/SignupService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { EmailService } from '@/core/EmailService.js';
import { MiLocalUser } from '@/models/User.js';
import { FastifyReplyError } from '@/misc/fastify-reply-error.js';
import { bindThis } from '@/decorators.js';
import { L_CHARS, secureRndstr } from '@/misc/secure-rndstr.js';
import { SigninService } from './SigninService.js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { SmsService } from '@/core/SmsService.js';

@Injectable()
export class SignupApiService {
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meta)
		private meta: MiMeta,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.userPendingsRepository)
		private userPendingsRepository: UserPendingsRepository,

		@Inject(DI.usedUsernamesRepository)
		private usedUsernamesRepository: UsedUsernamesRepository,

		@Inject(DI.registrationTicketsRepository)
		private registrationTicketsRepository: RegistrationTicketsRepository,

		private userEntityService: UserEntityService,
		private idService: IdService,
		private captchaService: CaptchaService,
		private signupService: SignupService,
		private signinService: SigninService,
		private emailService: EmailService,
		@Inject(DI.db)
		private db: DataSource,
		private smsService: SmsService,
	) {
	}

	@bindThis
	public async requestPhoneCode(request: FastifyRequest<{ Body: { phoneNumber: string } }>, reply: FastifyReply) {
		const phone = this.smsService.normalize(request.body.phoneNumber);
		const phoneHash = this.smsService.hash(phone);
		const recent = await this.db.query('SELECT 1 FROM "sms_verification" WHERE "phoneHash" = $1 AND "purpose" = $2 AND "createdAt" > now() - interval \'60 seconds\' LIMIT 1', [phoneHash, this.smsService.getPurpose()]);
		if (recent.length > 0) throw new FastifyReplyError(429, 'SMS_RATE_LIMITED');
		const hourly = await this.db.query('SELECT count(*)::int AS count FROM "sms_verification" WHERE "phoneHash" = $1 AND "purpose" = $2 AND "createdAt" > now() - interval \'1 hour\'', [phoneHash, this.smsService.getPurpose()]);
		if (hourly[0]?.count >= 10) throw new FastifyReplyError(429, 'SMS_RATE_LIMITED');
		const ipHourly = await this.db.query('SELECT count(*)::int AS count FROM "sms_verification" WHERE "requestIp" = $1 AND "createdAt" > now() - interval \'1 hour\'', [request.ip]);
		if (ipHourly[0]?.count >= 30) throw new FastifyReplyError(429, 'SMS_RATE_LIMITED');
		const code = await this.smsService.issue(phone);
		await this.db.query('INSERT INTO "sms_verification" ("id", "phoneHash", "codeHash", "purpose", "expiresAt", "requestIp") VALUES ($1,$2,$3,$4,now() + interval \'5 minutes\',$5)', [this.idService.gen(), phoneHash, this.smsService.hash(code), this.smsService.getPurpose(), request.ip]);
		reply.code(204).send();
	}

	@bindThis
	public async signup(
		request: FastifyRequest<{
			Body: {
				username: string;
				password: string;
				host?: string;
				invitationCode?: string;
				emailAddress?: string;
				'hcaptcha-response'?: string;
				'g-recaptcha-response'?: string;
				'turnstile-response'?: string;
				'm-captcha-response'?: string;
			'testcaptcha-response'?: string;
				phoneNumber?: string;
				smsCode?: string;
			}
		}>,
		reply: FastifyReply,
	) {
		const body = request.body;

		// Verify *Captcha
		// ただしテスト時はこの機構は障害となるため無効にする
		if (process.env.NODE_ENV !== 'test') {
			if (this.meta.enableHcaptcha && this.meta.hcaptchaSecretKey) {
				await this.captchaService.verifyHcaptcha(this.meta.hcaptchaSecretKey, body['hcaptcha-response']).catch(err => {
					throw new FastifyReplyError(400, err);
				});
			}

			if (this.meta.enableMcaptcha && this.meta.mcaptchaSecretKey && this.meta.mcaptchaSitekey && this.meta.mcaptchaInstanceUrl) {
				await this.captchaService.verifyMcaptcha(this.meta.mcaptchaSecretKey, this.meta.mcaptchaSitekey, this.meta.mcaptchaInstanceUrl, body['m-captcha-response']).catch(err => {
					throw new FastifyReplyError(400, err);
				});
			}

			if (this.meta.enableRecaptcha && this.meta.recaptchaSecretKey) {
				await this.captchaService.verifyRecaptcha(this.meta.recaptchaSecretKey, body['g-recaptcha-response']).catch(err => {
					throw new FastifyReplyError(400, err);
				});
			}

			if (this.meta.enableTurnstile && this.meta.turnstileSecretKey) {
				await this.captchaService.verifyTurnstile(this.meta.turnstileSecretKey, body['turnstile-response']).catch(err => {
					throw new FastifyReplyError(400, err);
				});
			}

			if (this.meta.enableTestcaptcha) {
				await this.captchaService.verifyTestcaptcha(body['testcaptcha-response']).catch(err => {
					throw new FastifyReplyError(400, err);
				});
			}
		}

		const username = body['username'];
		const password = body['password'];
		const host: string | null = process.env.NODE_ENV === 'test' ? (body['host'] ?? null) : null;
		const invitationCode = body['invitationCode'];
		const emailAddress = body['emailAddress'];
		const phoneNumber = body.phoneNumber;
		const smsCode = body.smsCode;
		let normalizedPhone: string | null = null;
		if (process.env.NODE_ENV !== 'test') {
			if (typeof phoneNumber !== 'string' || typeof smsCode !== 'string') throw new FastifyReplyError(400, 'PHONE_VERIFICATION_REQUIRED');
			normalizedPhone = this.smsService.normalize(phoneNumber);
			const rows = await this.db.query('SELECT * FROM "sms_verification" WHERE "phoneHash" = $1 AND "purpose" = $2 AND "consumedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1', [this.smsService.hash(normalizedPhone), this.smsService.getPurpose()]);
			const challenge = rows[0];
			if (!challenge || new Date(challenge.expiresAt).getTime() < Date.now() || challenge.attempts >= 5 || this.smsService.hash(smsCode) !== challenge.codeHash) {
				if (challenge) await this.db.query('UPDATE "sms_verification" SET "attempts" = "attempts" + 1 WHERE "id" = $1', [challenge.id]);
				throw new FastifyReplyError(400, 'INVALID_SMS_CODE');
			}
			await this.db.query('UPDATE "sms_verification" SET "consumedAt" = now() WHERE "id" = $1', [challenge.id]);
			if ((await this.userProfilesRepository.findOneBy({ phoneNumber: normalizedPhone })) != null) throw new FastifyReplyError(400, 'PHONE_ALREADY_BOUND');
		}

		if (this.meta.emailRequiredForSignup) {
			if (emailAddress == null || typeof emailAddress !== 'string') {
				reply.code(400);
				return;
			}

			const res = await this.emailService.validateEmailForAccount(emailAddress);
			if (!res.available) {
				reply.code(400);
				return;
			}
		}

		let ticket: MiRegistrationTicket | null = null;

		// テスト時はこの機構は障害となるため無効にする
		if (process.env.NODE_ENV !== 'test' && this.meta.disableRegistration) {
			if (invitationCode == null || typeof invitationCode !== 'string') {
				reply.code(400);
				return;
			}

			ticket = await this.registrationTicketsRepository.findOneBy({
				code: invitationCode,
			});

			if (ticket == null || ticket.usedById != null) {
				reply.code(400);
				return;
			}

			if (ticket.expiresAt && ticket.expiresAt < new Date()) {
				reply.code(400);
				return;
			}

			// メアド認証が有効の場合
			if (this.meta.emailRequiredForSignup) {
				// メアド認証済みならエラー
				if (ticket.usedBy) {
					reply.code(400);
					return;
				}

				// 認証しておらず、メール送信から30分以内ならエラー
				if (ticket.usedAt && ticket.usedAt.getTime() + (1000 * 60 * 30) > Date.now()) {
					reply.code(400);
					return;
				}
			} else if (ticket.usedAt) {
				reply.code(400);
				return;
			}
		}

		if (this.meta.emailRequiredForSignup) {
			if (await this.usersRepository.exists({ where: { usernameLower: username.toLowerCase(), host: IsNull() } })) {
				throw new FastifyReplyError(400, 'DUPLICATED_USERNAME');
			}

			// Check deleted username duplication
			if (await this.usedUsernamesRepository.exists({ where: { username: username.toLowerCase() } })) {
				throw new FastifyReplyError(400, 'USED_USERNAME');
			}

			const isPreserved = this.meta.preservedUsernames.map(x => x.toLowerCase()).includes(username.toLowerCase());
			if (isPreserved) {
				throw new FastifyReplyError(400, 'DENIED_USERNAME');
			}

			const code = secureRndstr(16, { chars: L_CHARS });

			// Generate hash of password
			const salt = await bcrypt.genSalt(8);
			const hash = await bcrypt.hash(password, salt);

			const pendingUser = await this.userPendingsRepository.insertOne({
				id: this.idService.gen(),
				code,
				email: emailAddress!,
				username: username,
				password: hash,
			});

			const link = `${this.config.url}/signup-complete/${code}`;

			this.emailService.sendEmail(emailAddress!, 'Signup',
				`To complete signup, please click this link:<br><a href="${link}">${link}</a>`,
				`To complete signup, please click this link: ${link}`);

			if (ticket) {
				await this.registrationTicketsRepository.update(ticket.id, {
					usedAt: new Date(),
					pendingUserId: pendingUser.id,
				});
			}

			reply.code(204);
			return;
		} else {
			try {
				if (normalizedPhone && await this.userProfilesRepository.findOneBy({ phoneNumber: normalizedPhone })) {
					throw new FastifyReplyError(400, 'PHONE_ALREADY_BOUND');
				}
				const { account, secret } = await this.signupService.signup({
					username, password, host,
				});
				if (normalizedPhone) {
					await this.userProfilesRepository.update(account.id, { phoneNumber: normalizedPhone, phoneVerified: true });
				}

				const res = await this.userEntityService.pack(account, account, {
					schema: 'MeDetailed',
					includeSecrets: true,
				});

				if (ticket) {
					await this.registrationTicketsRepository.update(ticket.id, {
						usedAt: new Date(),
						usedBy: account,
						usedById: account.id,
					});
				}

				return {
					...res,
					token: secret,
				};
			} catch (err) {
				throw new FastifyReplyError(400, typeof err === 'string' ? err : (err as Error).toString());
			}
		}
	}

	@bindThis
	public async signupPending(request: FastifyRequest<{ Body: { code: string; } }>, reply: FastifyReply) {
		const body = request.body;

		const code = body['code'];

		try {
			const pendingUser = await this.userPendingsRepository.findOneByOrFail({ code });

			if (this.idService.parse(pendingUser.id).date.getTime() + (1000 * 60 * 30) < Date.now()) {
				throw new FastifyReplyError(400, 'EXPIRED');
			}

			const { account } = await this.signupService.signup({
				username: pendingUser.username,
				passwordHash: pendingUser.password,
			});

			this.userPendingsRepository.delete({
				id: pendingUser.id,
			});

			const profile = await this.userProfilesRepository.findOneByOrFail({ userId: account.id });

			await this.userProfilesRepository.update({ userId: profile.userId }, {
				email: pendingUser.email,
				emailVerified: true,
				emailVerifyCode: null,
			});

			const ticket = await this.registrationTicketsRepository.findOneBy({ pendingUserId: pendingUser.id });
			if (ticket) {
				await this.registrationTicketsRepository.update(ticket.id, {
					usedBy: account,
					usedById: account.id,
					pendingUserId: null,
				});
			}

			return this.signinService.signin(request, reply, account as MiLocalUser);
		} catch (err) {
			throw new FastifyReplyError(400, typeof err === 'string' ? err : (err as Error).toString());
		}
	}
}
