/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class NativePushSubscription1793557671914 {
    name = 'NativePushSubscription1793557671914';

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "native_push_subscription" ("id" character varying(32) NOT NULL, "userId" character varying(32) NOT NULL, "accessTokenId" character varying(32), "credentialHash" character varying(64) NOT NULL, "installationId" character varying(36) NOT NULL, "deviceToken" character varying(512), "revision" bigint NOT NULL, "environment" character varying(16) NOT NULL, "bundleId" character varying(128) NOT NULL, "enabled" boolean NOT NULL DEFAULT true, "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_native_push_subscription" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_native_push_device" ON "native_push_subscription" ("deviceToken", "environment", "bundleId")`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_native_push_install" ON "native_push_subscription" ("installationId", "environment", "bundleId", "userId")`);
        await queryRunner.query(`CREATE INDEX "IDX_native_push_user" ON "native_push_subscription" ("userId")`);
        await queryRunner.query(`ALTER TABLE "native_push_subscription" ADD CONSTRAINT "FK_native_push_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "native_push_subscription" ADD CONSTRAINT "FK_native_push_access_token" FOREIGN KEY ("accessTokenId") REFERENCES "access_token"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP TABLE "native_push_subscription"`);
    }
}
