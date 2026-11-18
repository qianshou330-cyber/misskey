/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash, createPrivateKey, sign } from 'node:crypto';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { connect } from 'node:http2';
import type { KeyObject } from 'node:crypto';

export type NativePushConfig = {
	enabled?: boolean;
	teamId?: string;
	keyId?: string;
	privateKeyFile?: string;
	bundleId?: string;
	environment?: 'development' | 'production';
};

export type NativePushCredentials = {
	teamId: string;
	keyId: string;
	key: KeyObject;
	bundleId: string;
	environment: 'development' | 'production';
};

export async function nativePushCredentials(config: NativePushConfig | undefined): Promise<NativePushCredentials | null> {
	if (config?.enabled !== true || config.bundleId !== 'com.bolubo.native' ||
		!['development', 'production'].includes(config.environment ?? '') ||
		!/^[A-Z0-9]{10}$/.test(config.teamId ?? '') || !/^[A-Z0-9]{10}$/.test(config.keyId ?? '') ||
		!config.privateKeyFile || !isAbsolute(config.privateKeyFile)) return null;
	try {
		const file = await open(config.privateKeyFile, 'r');
		try {
			const info = await file.stat();
			if (!info.isFile() || info.size > 8192 || info.size < 64 || (process.platform !== 'win32' && (info.mode & 0o077) !== 0)) return null;
			const buffer = Buffer.alloc(8193);
			const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
			if (bytesRead !== info.size) return null;
			const key = createPrivateKey(buffer.subarray(0, bytesRead));
			if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return null;
			return { teamId: config.teamId!, keyId: config.keyId!, key, bundleId: config.bundleId, environment: config.environment! };
		} finally { await file.close(); }
	} catch { return null; }
}

export function nativeCredentialHash(value: string): string { return createHash('sha256').update(value).digest('hex'); }

export function nativePushJWT(credentials: NativePushCredentials, now = Date.now()): string {
	const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: credentials.keyId })).toString('base64url');
	const claims = Buffer.from(JSON.stringify({ iss: credentials.teamId, iat: Math.floor(now / 1000) })).toString('base64url');
	const unsigned = `${header}.${claims}`;
	return `${unsigned}.${sign('sha256', Buffer.from(unsigned), { key: credentials.key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}

export function nativePushPayload(kind: 'notification' | 'chat', userId: string, eventId: string) {
	return {
		aps: { alert: { title: 'PUBO', body: kind === 'chat' ? '你有一条新的私信' : '你有一条新的通知' }, sound: 'default' },
		pubo: { version: 1, kind, accountId: userId, eventId },
	};
}

export type NativePushResponse = { status: number; reason?: string };
export function classifyNativePushResponse(response: NativePushResponse): 'accepted' | 'invalid-device' | 'retry' | 'reject' {
	if (response.status === 200) return 'accepted';
	if (response.status === 410 || ['BadDeviceToken', 'DeviceTokenNotForTopic', 'Unregistered'].includes(response.reason ?? '')) return 'invalid-device';
	if (response.status === 429 || response.status >= 500) return 'retry';
	return 'reject';
}

/** Fixed Apple hosts only. Never log the token, JWT, payload, or key path. */
export async function sendNativePush(credentials: NativePushCredentials, jwt: string, deviceToken: string, payload: ReturnType<typeof nativePushPayload>, apnsId: string): Promise<NativePushResponse> {
	if (!/^(?:[a-f0-9]{2}){16,256}$/.test(deviceToken)) throw new Error('Invalid native push device');
	const body = Buffer.from(JSON.stringify(payload));
	if (body.length > 4096) throw new Error('Native push payload too large');
	const host = credentials.environment === 'production' ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com';
	return new Promise((resolve, reject) => {
		const connection = connect(host);
		let done = false;
		const finish = (error: Error | null, response?: NativePushResponse) => {
			if (done) return;
			done = true; clearTimeout(timer); connection.destroy();
			if (error) reject(error); else resolve(response!);
		};
		const timer = setTimeout(() => finish(new Error('Native push transport timeout')), 10_000);
		connection.on('error', () => finish(new Error('Native push transport unavailable')));
		const request = connection.request({
			':method': 'POST', ':path': `/3/device/${deviceToken}`, authorization: `bearer ${jwt}`,
			'apns-topic': credentials.bundleId, 'apns-push-type': 'alert', 'apns-priority': '10',
			'apns-expiration': '0', 'apns-id': apnsId,
			'apns-collapse-id': nativeCredentialHash(`${payload.pubo.kind}:${payload.pubo.eventId}`),
		});
		let status = 0;
		let response = '';
		request.on('response', headers => { status = Number(headers[':status'] ?? 0); });
		request.on('data', (chunk: Buffer) => {
			response += chunk.toString();
			if (response.length > 4096) finish(new Error('Native push response too large'));
		});
		request.on('error', () => finish(new Error('Native push transport unavailable')));
		request.on('end', () => {
			let reason: string | undefined;
			try { const parsed = JSON.parse(response); if (typeof parsed.reason === 'string') reason = parsed.reason; } catch { /* A successful response has no body. */ }
			if (!status) finish(new Error('Native push response missing')); else finish(null, { status, reason });
		});
		request.end(body);
	});
}
