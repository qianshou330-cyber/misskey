/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class KpopMusicCharts1792248949504 {
	name = 'KpopMusicCharts1792248949504';

	async up(queryRunner) {
		await queryRunner.query(`CREATE TABLE "kpop_chart_state" ("key" character varying(64) NOT NULL, "source" character varying(16) NOT NULL, "chartKey" character varying(32), "status" character varying(16) NOT NULL DEFAULT 'pending', "disabled" boolean NOT NULL DEFAULT false, "failureCount" integer NOT NULL DEFAULT 0, "checkedAt" TIMESTAMP WITH TIME ZONE, "lastSuccessAt" TIMESTAMP WITH TIME ZONE, "lastChangedAt" TIMESTAMP WITH TIME ZONE, "nextAttemptAt" TIMESTAMP WITH TIME ZONE, "lastSlotAt" TIMESTAMP WITH TIME ZONE, "latestSnapshotId" uuid, "diagnostic" jsonb, "robots" jsonb NOT NULL DEFAULT '[]', CONSTRAINT "PK_kpop_chart_state" PRIMARY KEY ("key"))`);
		await queryRunner.query(`CREATE TABLE "kpop_chart_snapshot" ("id" uuid NOT NULL, "chartKey" character varying(32) NOT NULL, "source" character varying(16) NOT NULL, "periodKey" character varying(128) NOT NULL, "sourcePeriod" character varying(100), "sourceUpdatedAt" TIMESTAMP WITH TIME ZONE, "sourceDate" character varying(10), "observedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "coverage" character varying(16) NOT NULL, "rankBasis" character varying(32) NOT NULL, "expectedCount" integer NOT NULL, "sourceTotal" integer, "contentHash" character varying(64) NOT NULL, "rawHash" character varying(64) NOT NULL, CONSTRAINT "PK_kpop_chart_snapshot" PRIMARY KEY ("id"))`);
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_kpop_snapshot_period" ON "kpop_chart_snapshot" ("chartKey", "periodKey")`);
		await queryRunner.query(`CREATE INDEX "IDX_kpop_snapshot_observed" ON "kpop_chart_snapshot" ("chartKey", "observedAt")`);
		await queryRunner.query(`CREATE TABLE "kpop_chart_entry" ("snapshotId" uuid NOT NULL, "rank" integer NOT NULL, "songId" character varying(200) NOT NULL, "title" character varying(500) NOT NULL, "artists" jsonb NOT NULL, "album" character varying(500), "albumId" character varying(200), "albumCoverUrl" character varying(2048), "groupIds" jsonb NOT NULL, "sourceMovement" jsonb NOT NULL, CONSTRAINT "PK_kpop_chart_entry" PRIMARY KEY ("snapshotId", "rank"), CONSTRAINT "FK_kpop_entry_snapshot" FOREIGN KEY ("snapshotId") REFERENCES "kpop_chart_snapshot"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`);
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_kpop_entry_song" ON "kpop_chart_entry" ("snapshotId", "songId")`);
	}

	async down(queryRunner) {
		await queryRunner.query('DROP TABLE "kpop_chart_entry"');
		await queryRunner.query('DROP TABLE "kpop_chart_snapshot"');
		await queryRunner.query('DROP TABLE "kpop_chart_state"');
	}
}
