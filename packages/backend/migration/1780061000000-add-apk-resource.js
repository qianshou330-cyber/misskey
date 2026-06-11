/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddApkResource1780061000000 {
    name = 'AddApkResource1780061000000';

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query('CREATE TABLE "apk_resource" ("id" character varying(32) NOT NULL, "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "userId" character varying(32) NOT NULL, "driveFileId" character varying(32) NOT NULL, "name" character varying(256) NOT NULL, "packageName" character varying(256), "versionName" character varying(128), "versionCode" integer, "description" character varying(2048), "screenshotFileIds" character varying(32) array NOT NULL DEFAULT \'{}\', "status" character varying(32) NOT NULL DEFAULT \'pending\', "downloadCount" integer NOT NULL DEFAULT 0, CONSTRAINT "PK_apk_resource_id" PRIMARY KEY ("id"))');
        await queryRunner.query('CREATE INDEX "IDX_apk_resource_updatedAt" ON "apk_resource" ("updatedAt")');
        await queryRunner.query('CREATE INDEX "IDX_apk_resource_userId" ON "apk_resource" ("userId")');
        await queryRunner.query('CREATE UNIQUE INDEX "IDX_apk_resource_driveFileId" ON "apk_resource" ("driveFileId")');
        await queryRunner.query('CREATE INDEX "IDX_apk_resource_status" ON "apk_resource" ("status")');
        await queryRunner.query('CREATE INDEX "IDX_apk_resource_downloadCount" ON "apk_resource" ("downloadCount")');
        await queryRunner.query('ALTER TABLE "apk_resource" ADD CONSTRAINT "FK_apk_resource_userId" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION');
        await queryRunner.query('ALTER TABLE "apk_resource" ADD CONSTRAINT "FK_apk_resource_driveFileId" FOREIGN KEY ("driveFileId") REFERENCES "drive_file"("id") ON DELETE CASCADE ON UPDATE NO ACTION');
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query('ALTER TABLE "apk_resource" DROP CONSTRAINT "FK_apk_resource_driveFileId"');
        await queryRunner.query('ALTER TABLE "apk_resource" DROP CONSTRAINT "FK_apk_resource_userId"');
        await queryRunner.query('DROP INDEX "public"."IDX_apk_resource_downloadCount"');
        await queryRunner.query('DROP INDEX "public"."IDX_apk_resource_status"');
        await queryRunner.query('DROP INDEX "public"."IDX_apk_resource_driveFileId"');
        await queryRunner.query('DROP INDEX "public"."IDX_apk_resource_userId"');
        await queryRunner.query('DROP INDEX "public"."IDX_apk_resource_updatedAt"');
        await queryRunner.query('DROP TABLE "apk_resource"');
    }
};
