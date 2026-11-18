/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class VerificationApplications1790700663944 {
	name = 'VerificationApplications1790700663944';

	async up(queryRunner) {
		await queryRunner.query(`CREATE TABLE "verification_application" ("id" character varying(32) NOT NULL, "userId" character varying(32) NOT NULL, "requestedType" character varying(32) NOT NULL, "approvedType" character varying(32), "description" character varying(2000) NOT NULL, "contact" character varying(512) NOT NULL, "consentVersion" character varying(64) NOT NULL, "consentedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'pending', "submittedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "reviewedAt" TIMESTAMP WITH TIME ZONE, "reviewerId" character varying(32), "reviewReason" character varying(512), CONSTRAINT "PK_verification_application" PRIMARY KEY ("id"), CONSTRAINT "CHK_verification_application_status" CHECK ("status" IN ('pending', 'approved', 'rejected', 'revoked')), CONSTRAINT "CHK_verification_application_requested_type" CHECK ("requestedType" IN ('actor', 'singer', 'model', 'contentCreator', 'novelist', 'other')), CONSTRAINT "CHK_verification_application_approved_type" CHECK ("approvedType" IS NULL OR "approvedType" IN ('actor', 'singer', 'model', 'contentCreator', 'novelist', 'other')))`);
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_verification_application_user" ON "verification_application" ("userId")`);
		await queryRunner.query(`CREATE INDEX "IDX_verification_application_status_submitted" ON "verification_application" ("status", "submittedAt")`);
		await queryRunner.query(`ALTER TABLE "verification_application" ADD CONSTRAINT "FK_verification_application_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
		await queryRunner.query(`ALTER TABLE "verification_application" ADD CONSTRAINT "FK_verification_application_reviewer" FOREIGN KEY ("reviewerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);

		await queryRunner.query(`CREATE TABLE "verification_document" ("id" character varying(32) NOT NULL, "userId" character varying(32) NOT NULL, "applicationId" character varying(32), "side" character varying(16) NOT NULL, "storageKey" character varying(128) NOT NULL, "mime" character varying(128) NOT NULL, "size" integer NOT NULL, "sha256" character varying(64) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_verification_document" PRIMARY KEY ("id"), CONSTRAINT "CHK_verification_document_side" CHECK ("side" IN ('front', 'back')))`);
		await queryRunner.query(`CREATE INDEX "IDX_verification_document_user_created" ON "verification_document" ("userId", "createdAt")`);
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_verification_document_application_side" ON "verification_document" ("applicationId", "side")`);
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_verification_document_staged_side" ON "verification_document" ("userId", "side") WHERE "applicationId" IS NULL`);
		await queryRunner.query(`ALTER TABLE "verification_document" ADD CONSTRAINT "FK_verification_document_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
		await queryRunner.query(`ALTER TABLE "verification_document" ADD CONSTRAINT "FK_verification_document_application" FOREIGN KEY ("applicationId") REFERENCES "verification_application"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP INDEX "public"."IDX_verification_document_staged_side"`);
		await queryRunner.query(`ALTER TABLE "verification_document" DROP CONSTRAINT "FK_verification_document_application"`);
		await queryRunner.query(`ALTER TABLE "verification_document" DROP CONSTRAINT "FK_verification_document_user"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_verification_document_application_side"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_verification_document_user_created"`);
		await queryRunner.query(`DROP TABLE "verification_document"`);
		await queryRunner.query(`ALTER TABLE "verification_application" DROP CONSTRAINT "FK_verification_application_user"`);
		await queryRunner.query(`ALTER TABLE "verification_application" DROP CONSTRAINT "FK_verification_application_reviewer"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_verification_application_status_submitted"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_verification_application_user"`);
		await queryRunner.query(`DROP TABLE "verification_application"`);
	}
}
