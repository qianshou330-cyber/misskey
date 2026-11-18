/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { classifyNativePushResponse, nativePushCredentials, nativePushJWT, nativePushPayload } from '@/misc/native-push.js';

describe('Native push privacy and APNs protocol', () => {
	test('disabled or incomplete configuration never opens an APNs channel', async () => {
		expect(await nativePushCredentials(undefined)).toBeNull();
		expect(await nativePushCredentials({ enabled: false })).toBeNull();
		expect(await nativePushCredentials({ enabled: true, privateKeyFile: 'relative-key' })).toBeNull();
	});

	test('ES256 token uses a raw 64-byte signature and second-based issuance', () => {
		const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
		const token = nativePushJWT({ teamId: 'TESTTEAM01', keyId: 'TESTKEY001', key: privateKey, bundleId: 'com.bolubo.native', environment: 'development' }, 1_800_000_000_123);
		const [header, claims, signature] = token.split('.');
		expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'TESTKEY001' });
		expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({ iss: 'TESTTEAM01', iat: 1_800_000_000 });
		expect(Buffer.from(signature, 'base64url').length).toBe(64);
		expect(verify('sha256', Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'))).toBe(true);
	});

	test('payload contains generic alerts and identifiers only', () => {
		for (const kind of ['chat', 'notification'] as const) {
			const payload = nativePushPayload(kind, 'syntheticUser', 'syntheticEvent');
			expect(Object.keys(payload)).toEqual(['aps', 'pubo']);
			expect(payload.pubo).toEqual({ version: 1, kind, accountId: 'syntheticUser', eventId: 'syntheticEvent' });
			expect(JSON.stringify(payload)).not.toMatch(/https?:|attachment|Bearer|private text|deviceToken/);
			expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThan(4096);
		}
	});

	test('invalid devices are disabled, rate limits retry, auth errors terminate', () => {
		expect(classifyNativePushResponse({ status: 200 })).toBe('accepted');
		expect(classifyNativePushResponse({ status: 410, reason: 'Unregistered' })).toBe('invalid-device');
		expect(classifyNativePushResponse({ status: 400, reason: 'BadDeviceToken' })).toBe('invalid-device');
		expect(classifyNativePushResponse({ status: 400, reason: 'DeviceTokenNotForTopic' })).toBe('invalid-device');
		expect(classifyNativePushResponse({ status: 429 })).toBe('retry');
		expect(classifyNativePushResponse({ status: 503 })).toBe('retry');
		expect(classifyNativePushResponse({ status: 403, reason: 'InvalidProviderToken' })).toBe('reject');
		expect(classifyNativePushResponse({ status: 400, reason: 'BadTopic' })).toBe('reject');
	});

	test('only a bounded, restricted P-256 key can enable the feature', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'pubo-native-push-test-'));
		try {
			const privateKeyFile = join(directory, 'synthetic.p8');
			const config = { enabled: true, teamId: 'TESTTEAM01', keyId: 'TESTKEY001', privateKeyFile, bundleId: 'com.bolubo.native', environment: 'development' as const };
			const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
			await writeFile(privateKeyFile, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
			expect(await nativePushCredentials(config)).not.toBeNull();
			expect(await nativePushCredentials({ ...config, bundleId: 'unrelated.app' })).toBeNull();
			await writeFile(privateKeyFile, Buffer.alloc(9000));
			expect(await nativePushCredentials(config)).toBeNull();
		} finally { await rm(directory, { recursive: true, force: true }); }
	});
});
