/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ChatProContacts1791814000000 {
	name = 'ChatProContacts1791814000000';

	async up(queryRunner) {
		await queryRunner.query(`CREATE TABLE "chat_contact_group" ("id" character varying(32) NOT NULL, "userId" character varying(32) NOT NULL, "name" character varying(100) NOT NULL, CONSTRAINT "PK_0238256a03fd25315fce192ddb1" PRIMARY KEY ("id"), CONSTRAINT "FK_75970c96ae8510fc7ea04c0ea77" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE)`);
		await queryRunner.query(`CREATE INDEX "IDX_75970c96ae8510fc7ea04c0ea7" ON "chat_contact_group" ("userId")`);
		await queryRunner.query(`CREATE TABLE "chat_contact_group_member" ("groupId" character varying(32) NOT NULL, "userId" character varying(32) NOT NULL, CONSTRAINT "PK_bcf1880accebf90e8a6d06f57f1" PRIMARY KEY ("groupId", "userId"), CONSTRAINT "FK_846f1c1f76c7e08c3b2d76df9da" FOREIGN KEY ("groupId") REFERENCES "chat_contact_group"("id") ON DELETE CASCADE, CONSTRAINT "FK_2905b34148af36f952df7a90cb6" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE)`);
		await queryRunner.query(`CREATE INDEX "IDX_2905b34148af36f952df7a90cb" ON "chat_contact_group_member" ("userId")`);
		await queryRunner.query(`CREATE TABLE "chat_blocking" ("id" character varying(32) NOT NULL, "userId" character varying(32) NOT NULL, "targetId" character varying(32) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_9c70fc691d7442d9e8870ebdd25" PRIMARY KEY ("id"), CONSTRAINT "FK_211a72cd5f1d36c0b421ea4b75c" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE, CONSTRAINT "FK_2edbe6e0fe97b69474d78e95790" FOREIGN KEY ("targetId") REFERENCES "user"("id") ON DELETE CASCADE)`);
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_1d3f342193ded654ee5c93b262" ON "chat_blocking" ("userId", "targetId")`);
		await queryRunner.query(`CREATE INDEX "IDX_2edbe6e0fe97b69474d78e9579" ON "chat_blocking" ("targetId")`);
	}

	async down(queryRunner) {
		// Test rollback only: production keeps these tables and uses a compatible build.
		await queryRunner.query(`DROP TABLE "chat_blocking"`);
		await queryRunner.query(`DROP TABLE "chat_contact_group_member"`);
		await queryRunner.query(`DROP TABLE "chat_contact_group"`);
	}
}
