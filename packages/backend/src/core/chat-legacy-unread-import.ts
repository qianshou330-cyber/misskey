/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export type LegacyUnreadSource = {
	scan(cursor: string, match: 'MATCH', pattern: string, count: 'COUNT', limit: number): Promise<[string, string[]]>;
	get(key: string): Promise<string | null>;
};

export type LegacyUnreadDatabase = {
	query(sql: string, parameters: string[]): Promise<{ rows: { existing?: boolean; available?: boolean }[]; rowCount: number | null }>;
};

/** Reads raw (unprefixed-client) Redis keys and writes only durable legacy badges. */
export async function importChatLegacyUnread(source: LegacyUnreadSource, db: LegacyUnreadDatabase, prefix: string, apply: boolean) {
	const stem = prefix + 'newUserChatMessageExists:';
	const pattern = stem.replace(/[\\*?\[\]]/g, '\\$&') + '*';
	const summary = { scanned: 0, imported: 0, existing: 0, skipped: 0 };
	let cursor = '0';
	do {
		const [next, keys] = await source.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
		cursor = next;
		for (const key of keys) {
			summary.scanned++;
			if (!key.startsWith(stem)) { summary.skipped++; continue; }
			const pair = /^([a-zA-Z0-9]{1,32}):([a-zA-Z0-9]{1,32})$/.exec(key.slice(stem.length));
			if (!pair || pair[1] === pair[2]) { summary.skipped++; continue; }
			const messageId = await source.get(key);
			if (!messageId || !/^[a-zA-Z0-9]{1,32}$/.test(messageId)) { summary.skipped++; continue; }
			const [, userId, otherId] = pair;
			if (apply) {
				const result = await db.query('INSERT INTO "chat_legacy_unread" ("userId", "otherId", "hasUnread", "messageId") SELECT $1, $2, true, $3 WHERE EXISTS (SELECT 1 FROM "user" WHERE "id"=$1) AND EXISTS (SELECT 1 FROM "user" WHERE "id"=$2) ON CONFLICT ("userId", "otherId") DO NOTHING', [userId, otherId, messageId]);
				if (result.rowCount === 1) { summary.imported++; continue; }
			}
			const result = await db.query('SELECT EXISTS (SELECT 1 FROM "chat_legacy_unread" WHERE "userId"=$1 AND "otherId"=$2) AS existing, (EXISTS (SELECT 1 FROM "user" WHERE "id"=$1) AND EXISTS (SELECT 1 FROM "user" WHERE "id"=$2)) AS available', [userId, otherId]);
			if (result.rows[0]?.existing) summary.existing++;
			else if (!apply && result.rows[0]?.available) summary.imported++;
			else summary.skipped++;
		}
	} while (cursor !== '0');
	return summary;
}
