/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddApkResourceVersion1781159000000 {
    name = 'AddApkResourceVersion1781159000000';

    /**
     * @param {import('typeorm').QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query('CREATE TABLE "apk_resource_version" ("id" character varying(32) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL, "resourceId" character varying(32) NOT NULL, "driveFileId" character varying(32) NOT NULL, "versionName" character varying(128), "versionCode" integer, "changelog" character varying(2048), CONSTRAINT "PK_apk_resource_version_id" PRIMARY KEY ("id"))');
        await queryRunner.query('CREATE INDEX "IDX_apk_resource_version_createdAt" ON "apk_resource_version" ("createdAt")');
        await queryRunner.query('CREATE INDEX "IDX_apk_resource_version_resourceId" ON "apk_resource_version" ("resourceId")');
        await queryRunner.query('ALTER TABLE "apk_resource_version" ADD CONSTRAINT "FK_apk_resource_version_resourceId" FOREIGN KEY ("resourceId") REFERENCES "apk_resource"("id") ON DELETE CASCADE ON UPDATE NO ACTION');
        await queryRunner.query('ALTER TABLE "apk_resource_version" ADD CONSTRAINT "FK_apk_resource_version_driveFileId" FOREIGN KEY ("driveFileId") REFERENCES "drive_file"("id") ON DELETE CASCADE ON UPDATE NO ACTION');
    }

    /**
     * @param {import('typeorm').QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query('ALTER TABLE "apk_resource_version" DROP CONSTRAINT "FK_apk_resource_version_driveFileId"');
        await queryRunner.query('ALTER TABLE "apk_resource_version" DROP CONSTRAINT "FK_apk_resource_version_resourceId"');
        await queryRunner.query('DROP INDEX "public"."IDX_apk_resource_version_resourceId"');
        await queryRunner.query('DROP INDEX "public"."IDX_apk_resource_version_createdAt"');
        await queryRunner.query('DROP TABLE "apk_resource_version"');
    }
}
