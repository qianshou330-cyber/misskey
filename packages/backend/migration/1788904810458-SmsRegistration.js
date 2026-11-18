/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class SmsRegistration1788904810458 {
	name = 'SmsRegistration1788904810458';

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "user_profile" ADD "phoneNumber" character varying(32)`);
		await queryRunner.query(`ALTER TABLE "user_profile" ADD "phoneVerified" boolean NOT NULL DEFAULT false`);
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_user_profile_phone_number" ON "user_profile" ("phoneNumber") WHERE "phoneNumber" IS NOT NULL`);
		await queryRunner.query(`CREATE TABLE "sms_verification" ("id" character varying(32) NOT NULL, "phoneHash" character varying(64) NOT NULL, "codeHash" character varying(128) NOT NULL, "purpose" character varying(32) NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "attempts" integer NOT NULL DEFAULT 0, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "consumedAt" TIMESTAMP WITH TIME ZONE, "requestIp" inet, CONSTRAINT "PK_sms_verification" PRIMARY KEY ("id"))`);
		await queryRunner.query(`CREATE INDEX "IDX_sms_verification_phone_purpose" ON "sms_verification" ("phoneHash", "purpose", "createdAt")`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP INDEX "IDX_sms_verification_phone_purpose"`);
		await queryRunner.query(`DROP TABLE "sms_verification"`);
		await queryRunner.query(`DROP INDEX "IDX_user_profile_phone_number"`);
		await queryRunner.query(`ALTER TABLE "user_profile" DROP COLUMN "phoneVerified"`);
		await queryRunner.query(`ALTER TABLE "user_profile" DROP COLUMN "phoneNumber"`);
	}
}
