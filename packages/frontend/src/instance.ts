/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { reactive } from 'vue';
import * as Misskey from 'misskey-js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { miLocalStorage } from '@/local-storage.js';

function isObject(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === 'object' && !Array.isArray(value);
}

// Check the fields needed to render the entrance without inventing permissions.
export function isValidInstanceMeta(value: unknown): value is Misskey.entities.MetaDetailed {
	return isObject(value) && typeof value.version === 'string' && value.version.length > 0 &&
		typeof value.requireSetup === 'boolean' && typeof value.disableRegistration === 'boolean' &&
		isObject(value.clientOptions) && isObject(value.policies) &&
		typeof value.policies.ltlAvailable === 'boolean' && typeof value.policies.gtlAvailable === 'boolean';
}

function parseMeta(text: string | null): Misskey.entities.MetaDetailed | null {
	try {
		const value: unknown = text ? JSON.parse(text) : null;
		return isValidInstanceMeta(value) ? value : null;
	} catch {
		return null;
	}
}

function persistMeta(meta: Misskey.entities.MetaDetailed, fetchedAt: number) {
	try {
		miLocalStorage.setItem('instance', JSON.stringify(meta));
		miLocalStorage.setItem('instanceCachedAt', fetchedAt.toString());
	} catch {
		// Storage restrictions must not hide an otherwise usable entrance.
	}
}

const providedMetaEl = window.document.getElementById('misskey_meta');
const providedMeta = parseMeta(providedMetaEl?.textContent ?? null);
// Server timestamps may be ahead of this device. This response was received now.
const providedAt = Date.now();
let cachedMeta: Misskey.entities.MetaDetailed | null = null;
let cachedAt = 0;
try {
	cachedMeta = parseMeta(miLocalStorage.getItem('instance'));
	cachedAt = Number(miLocalStorage.getItem('instanceCachedAt') ?? 0);
} catch {
	// HTML-provided metadata remains available when storage cannot be read.
}

// The current response is authoritative for entrance style and guest policies.
const initialMeta = providedMeta ?? cachedMeta;
let lastFetchedAt = providedMeta ? providedAt : cachedAt;
if (!Number.isFinite(lastFetchedAt)) lastFetchedAt = 0;
if (providedMeta) persistMeta(providedMeta, lastFetchedAt);
// Keep the existing shared type contract; the entrance validates this empty startup placeholder.
export const instance = reactive((initialMeta ?? {}) as Misskey.entities.MetaDetailed);

let requestGeneration = 0;
let pendingRequest: Promise<Misskey.entities.MetaDetailed> | undefined;
let entranceRefresh: Promise<Misskey.entities.MetaDetailed> | undefined;
let entranceRefreshAt = 0;

export function refreshEntranceInstance(): Promise<Misskey.entities.MetaDetailed> {
	const age = Date.now() - entranceRefreshAt;
	if (entranceRefresh && (pendingRequest === entranceRefresh || (age >= 0 && age < 3600000))) return entranceRefresh;
	entranceRefreshAt = Date.now();
	entranceRefresh = pendingRequest ?? fetchInstance(true, { timeoutMs: 8000 });
	// Re-entering the same page shares the successful refresh; a local retry is
	// allowed after failure. Explicit administrator force-refresh remains separate.
	void entranceRefresh.catch(() => { entranceRefresh = undefined; });
	return entranceRefresh;
}

export function fetchInstance(force = false, options: { timeoutMs?: number } = {}): Promise<Misskey.entities.MetaDetailed> {
	if (!force) {
		const age = Date.now() - lastFetchedAt;
		if (isValidInstanceMeta(instance) && age >= 0 && age < 1000 * 60 * 60) return Promise.resolve(instance);
		if (pendingRequest) return pendingRequest;
	}

	const generation = ++requestGeneration;
	const controller = options.timeoutMs != null ? new AbortController() : undefined;
	const timer = controller ? window.setTimeout(() => controller.abort(), options.timeoutMs) : undefined;
	const request = misskeyApi('meta', { detail: true }, undefined, controller?.signal).then(meta => {
		if (!isValidInstanceMeta(meta)) throw new Error('Invalid instance metadata');
		if (controller?.signal.aborted) throw new Error('Instance metadata request timed out');
		if (generation === requestGeneration) {
			Object.assign(instance, meta);
			lastFetchedAt = Date.now();
			persistMeta(instance, lastFetchedAt);
		}
		return instance;
	}).finally(() => {
		if (timer !== undefined) window.clearTimeout(timer);
		if (pendingRequest === request) pendingRequest = undefined;
	});
	pendingRequest = request;
	return request;
}
