/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { nextTick } from 'vue';
import Welcome from '@/pages/welcome.vue';
import { instance } from '@/instance.js';

const request = vi.hoisted(() => vi.fn());
vi.mock('@/instance.js', async () => {
	const { reactive } = await import('vue');
	return { instance: reactive<Record<string, unknown>>({}), refreshEntranceInstance: request, isValidInstanceMeta: (value: { version?: string }) => value.version === 'valid' };
});
vi.mock('@@/js/config.js', () => ({ instanceName: 'PUBO' }));
vi.mock('@/page.js', () => ({ definePage: vi.fn() }));
vi.mock('@/pages/welcome.setup.vue', () => ({ default: { template: '<div>Setup</div>' } }));
vi.mock('@/pages/welcome.entrance.classic.vue', () => ({ default: { template: '<div>Classic</div>' } }));
vi.mock('@/pages/welcome.entrance.simple.vue', () => ({ default: { template: '<div>Login Register</div>' } }));
vi.mock('@/components/global/MkError.vue', () => ({ default: { emits: ['retry'], template: '<button @click="$emit(\'retry\')">Retry</button>' } }));

describe('welcome renders before background metadata refresh', () => {
	beforeEach(() => {
		for (const key of Object.keys(instance)) delete (instance as Record<string, unknown>)[key];
		request.mockReset();
	});
	afterEach(cleanup);

	it('shows login from initial metadata while refresh hangs and after refresh fails', async () => {
		Object.assign(instance, { version: 'valid', requireSetup: false, clientOptions: { entrancePageStyle: 'simple' } });
		let reject!: (reason: Error) => void;
		request.mockReturnValue(new Promise((_resolve, rejectRequest) => { reject = rejectRequest; }));
		const view = render(Welcome);
		expect(view.getByText('Login Register')).toBeTruthy();
		expect(request).toHaveBeenCalledWith();
		reject(new Error('timeout'));
		await nextTick();
		await nextTick();
		expect(view.getByText('Login Register')).toBeTruthy();
		expect(view.queryByText('Retry')).toBeNull();
	});

	it('shows retry when no metadata is usable and recovers by explicit retry only', async () => {
		request.mockRejectedValueOnce(new Error('timeout')).mockImplementationOnce(async () => {
			Object.assign(instance, { version: 'valid', requireSetup: false, clientOptions: { entrancePageStyle: 'simple' } });
			return instance;
		});
		const view = render(Welcome, { global: { stubs: { MkLoading: { template: '<div>Loading</div>' } } } });
		expect(view.queryByText('Login Register')).toBeNull();
		await view.findByText('Retry');
		expect(request).toHaveBeenCalledTimes(1);
		await fireEvent.click(view.getByText('Retry'));
		await view.findByText('Login Register');
		expect(request).toHaveBeenCalledTimes(2);
	});
});
