/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class MusicCharts1792011832193 {
	name = 'MusicCharts1792011832193';

	async up(queryRunner) {
		await queryRunner.query(`CREATE TABLE "music_chart_state" ("chartKey" character varying(32) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'pending', "checkedAt" TIMESTAMP WITH TIME ZONE, "nextAttemptAt" TIMESTAMP WITH TIME ZONE, "failureCount" integer NOT NULL DEFAULT 0, "sourcePeriod" TIMESTAMP WITH TIME ZONE, "lastSuccessAt" TIMESTAMP WITH TIME ZONE, "result" character varying(16) NOT NULL DEFAULT 'unknown', "rank" integer, "previousRank" integer, "peakRank" integer, "monitorStartedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_2ab31bb019ae07557aa5ea09a99" PRIMARY KEY ("chartKey"))`);
		await queryRunner.query(`CREATE TABLE "music_chart_snapshot" ("chartKey" character varying(32) NOT NULL, "sourcePeriod" TIMESTAMP WITH TIME ZONE NOT NULL, "observedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "rank" integer, "eligible" boolean NOT NULL, CONSTRAINT "PK_9be8672b8f1d8d735debcc90eaa" PRIMARY KEY ("chartKey", "sourcePeriod"))`);
	}

	async down(queryRunner) {
		// Production rollback retains these tables; down is for isolated rehearsal only.
		await queryRunner.query(`DROP TABLE "music_chart_snapshot"`);
		await queryRunner.query(`DROP TABLE "music_chart_state"`);
	}
}
