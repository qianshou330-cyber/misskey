/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { misskeyApiGet, pendingApiRequestsCount } from '@/utility/misskey-api.js';

vi.mock('@/i.js', () => ({ $i: null }));
vi.mock('@@/js/config.js', () => ({ apiUrl: 'https://example.test/api' }));

describe('optional GET cancellation', () => {
	afterEach(() => { vi.restoreAllMocks(); });

	it('passes cancellation to fetch and releases the pending request count', async () => {
		const controller = new AbortController();
		const fetch = vi.spyOn(window, 'fetch').mockImplementation((_input, options) => new Promise((_resolve, reject) => {
			options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
		}));
		const request = misskeyApiGet('emojis', {}, controller.signal);
		expect(pendingApiRequestsCount.value).toBe(1);
		expect(fetch).toHaveBeenCalledWith('https://example.test/api/emojis?', expect.objectContaining({
			method: 'GET', credentials: 'omit', cache: 'default', signal: controller.signal,
		}));
		controller.abort(new DOMException('Timed out', 'TimeoutError'));
		await expect(request).rejects.toMatchObject({ name: 'TimeoutError' });
		expect(pendingApiRequestsCount.value).toBe(0);
	});

	it('keeps existing GET callers working without a signal', async () => {
		vi.spyOn(window, 'fetch').mockResolvedValue(new Response(JSON.stringify({ emojis: [] }), { status: 200 }));
		await expect(misskeyApiGet('emojis', {})).resolves.toEqual({ emojis: [] });
		expect(pendingApiRequestsCount.value).toBe(0);
	});
});
