/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import { importChatLegacyUnread } from './chat-legacy-unread-import.js';

describe('legacy unread import', () => {
	it('scans prefixed physical keys and dryrun never writes', async () => {
		const scan = vi.fn().mockResolvedValue(['0', ['site:newUserChatMessageExists:reader:sender']]);
		const get = vi.fn().mockResolvedValue('message');
		const query = vi.fn().mockResolvedValue({ rows: [{ existing: false, available: true }], rowCount: 1 });
		expect(await importChatLegacyUnread({ scan, get }, { query }, 'site:', false)).toEqual({ scanned: 1, imported: 1, existing: 0, skipped: 0 });
		expect(scan).toHaveBeenCalledWith('0', 'MATCH', 'site:newUserChatMessageExists:*', 'COUNT', 100);
		expect(get).toHaveBeenCalledWith('site:newUserChatMessageExists:reader:sender');
		expect(query.mock.calls.every(([sql]) => sql.startsWith('SELECT'))).toBe(true);
	});

	it('imports once and never overwrites a persisted cleared badge', async () => {
		const source = { scan: vi.fn().mockResolvedValue(['0', ['site:newUserChatMessageExists:reader:sender']]), get: vi.fn().mockResolvedValue('message') };
		const query = vi.fn().mockResolvedValueOnce({ rows: [], rowCount: 0 }).mockResolvedValueOnce({ rows: [{ existing: true, available: true }], rowCount: 1 });
		expect(await importChatLegacyUnread(source, { query }, 'site:', true)).toEqual({ scanned: 1, imported: 0, existing: 1, skipped: 0 });
		expect(query.mock.calls[0][0]).toContain('DO NOTHING');
		expect(query.mock.calls[0][1]).toEqual(['reader', 'sender', 'message']);
	});

	it('skips malformed, vanished and deleted-user markers and follows cursors', async () => {
		const source = {
			scan: vi.fn().mockResolvedValueOnce(['1', ['site:newUserChatMessageExists:broken', 'other:key']]).mockResolvedValueOnce(['0', ['site:newUserChatMessageExists:reader:sender', 'site:newUserChatMessageExists:reader:deleted']]),
			get: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('message'),
		};
		const query = vi.fn().mockResolvedValue({ rows: [{ existing: false, available: false }], rowCount: 0 });
		expect(await importChatLegacyUnread(source, { query }, 'site:', true)).toEqual({ scanned: 4, imported: 0, existing: 0, skipped: 4 });
		expect(source.scan.mock.calls[1][0]).toBe('1');
	});
});
