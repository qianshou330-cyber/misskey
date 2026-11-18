/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ChatDaily1792627200000 {
	name = 'ChatDaily1792627200000';

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "chat_message" ADD "replyToId" character varying(32)`);
		await queryRunner.query(`ALTER TABLE "chat_message" ADD "notificationSuppressed" boolean NOT NULL DEFAULT false`);
		await queryRunner.query(`CREATE TABLE "chat_conversation_setting" ("userId" character varying(32) NOT NULL, "otherId" character varying(32) NOT NULL, "pinnedAt" TIMESTAMP WITH TIME ZONE, "isMuted" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_chat_conversation_setting" PRIMARY KEY ("userId", "otherId"), CONSTRAINT "FK_chat_conversation_setting_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_chat_conversation_setting_other" FOREIGN KEY ("otherId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`);
		await queryRunner.query(`CREATE INDEX "IDX_chat_conversation_pinned" ON "chat_conversation_setting" ("userId", "pinnedAt") WHERE "pinnedAt" IS NOT NULL`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP TABLE "chat_conversation_setting"`);
		await queryRunner.query(`ALTER TABLE "chat_message" DROP COLUMN "notificationSuppressed"`);
		await queryRunner.query(`ALTER TABLE "chat_message" DROP COLUMN "replyToId"`);
	}
}
