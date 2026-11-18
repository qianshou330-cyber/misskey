/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ChatProMessageState1791813354559 {
	name = 'ChatProMessageState1791813354559';

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "chat_message" ADD "clientMessageId" character varying(64), ADD "requestFingerprint" character varying(64), ADD "readTracked" boolean NOT NULL DEFAULT false, ADD "readAt" TIMESTAMP WITH TIME ZONE, ADD "revision" integer NOT NULL DEFAULT 0, ADD "editedAt" TIMESTAMP WITH TIME ZONE, ADD "recalledAt" TIMESTAMP WITH TIME ZONE`);
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_chat_message_client_nonce" ON "chat_message" ("fromUserId", "clientMessageId")`);
		await queryRunner.query(`CREATE INDEX "IDX_chat_message_unread" ON "chat_message" ("toUserId", "fromUserId") WHERE "readTracked" = true AND "readAt" IS NULL AND "recalledAt" IS NULL`);
		await queryRunner.query(`CREATE TABLE "chat_legacy_unread" ("userId" character varying(32) NOT NULL, "otherId" character varying(32) NOT NULL, "hasUnread" boolean NOT NULL DEFAULT false, "messageId" character varying(32), CONSTRAINT "PK_chat_legacy_unread" PRIMARY KEY ("userId", "otherId"), CONSTRAINT "FK_chat_legacy_unread_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE, CONSTRAINT "FK_chat_legacy_unread_other" FOREIGN KEY ("otherId") REFERENCES "user"("id") ON DELETE CASCADE)`);
	}

	async down(queryRunner) {
		// A data-bearing production rollback keeps this schema and uses the compatible app.
		// This destructive rollback is only for an empty test DB or after exporting state.
		await queryRunner.query(`DROP TABLE "chat_legacy_unread"`);
		await queryRunner.query(`DROP INDEX "IDX_chat_message_unread"`);
		await queryRunner.query(`DROP INDEX "IDX_chat_message_client_nonce"`);
		await queryRunner.query(`ALTER TABLE "chat_message" DROP COLUMN "recalledAt", DROP COLUMN "editedAt", DROP COLUMN "revision", DROP COLUMN "readAt", DROP COLUMN "readTracked", DROP COLUMN "requestFingerprint", DROP COLUMN "clientMessageId"`);
	}
}
