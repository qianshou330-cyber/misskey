/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddApkResourceReviewFields1781157600000 {
    name = 'AddApkResourceReviewFields1781157600000';

    /**
     * @param {import('typeorm').QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query('ALTER TABLE "apk_resource" ADD "reviewerId" character varying(32)');
        await queryRunner.query('ALTER TABLE "apk_resource" ADD "reviewedAt" TIMESTAMP WITH TIME ZONE');
        await queryRunner.query('ALTER TABLE "apk_resource" ADD "reviewNote" character varying(2048)');
        await queryRunner.query('ALTER TABLE "apk_resource" ADD "rejectionReason" character varying(2048)');
        await queryRunner.query('CREATE INDEX "IDX_apk_resource_reviewerId" ON "apk_resource" ("reviewerId")');
        await queryRunner.query('ALTER TABLE "apk_resource" ADD CONSTRAINT "FK_apk_resource_reviewerId" FOREIGN KEY ("reviewerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION');
    }

    /**
     * @param {import('typeorm').QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query('ALTER TABLE "apk_resource" DROP CONSTRAINT "FK_apk_resource_reviewerId"');
        await queryRunner.query('DROP INDEX "public"."IDX_apk_resource_reviewerId"');
        await queryRunner.query('ALTER TABLE "apk_resource" DROP COLUMN "rejectionReason"');
        await queryRunner.query('ALTER TABLE "apk_resource" DROP COLUMN "reviewNote"');
        await queryRunner.query('ALTER TABLE "apk_resource" DROP COLUMN "reviewedAt"');
        await queryRunner.query('ALTER TABLE "apk_resource" DROP COLUMN "reviewerId"');
    }
}
