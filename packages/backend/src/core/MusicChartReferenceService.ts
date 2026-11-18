/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';
import { Inject, Injectable } from '@nestjs/common';
import type * as Redis from 'ioredis';
import { DI } from '@/di-symbols.js';
import { HttpRequestService } from './HttpRequestService.js';
import { genericChartAccess } from './music-charts/provider.js';
import { parseReferencePage, type ReferenceSnapshot, type ReferenceSource } from './music-charts/reference-parser.js';
import { enabledReferenceCharts, packReference, parseReferenceAttempt, referenceAttemptKey, referenceSnapshotKey, referenceUrl, validateReferenceSnapshot, REFERENCE_CHARTS, REFERENCE_INTERVAL_MS, REFERENCE_FAILURE_INTERVAL_MS, REFERENCE_ORIGIN, REFERENCE_RETENTION_MS, REFERENCE_SOURCES, REFERENCE_WRITE_SCRIPT, type ReferenceMap } from './music-charts/reference-state.js';
import { musicChartCollectionGate, type MusicChartCollectionResult } from './music-charts/schedule.js';
import { parseReferenceDiagnostic, ReferenceReadError, referenceRetryAfter, referenceTransportReason, type ReferenceDiagnostic } from './music-charts/reference-diagnostic.js';
import { prepareMelonReferenceRecovery, REFERENCE_RECOVERY_SCRIPT, type MelonRecoveryExpected, type MelonRecoverySample } from './music-charts/reference-recovery.js';

const REDIS_TIMEOUT_MS = 500;

@Injectable()
export class MusicChartReferenceService {
	constructor(
		@Inject(DI.redis) private redisClient: Redis.Redis,
		private httpRequestService: HttpRequestService,
	) {}

	private async boundedRedis<T>(operation: () => Promise<T>): Promise<T> {
		if (this.redisClient.status !== 'ready') throw new Error('Reference cache unavailable');
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([operation(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Reference cache timeout')), REDIS_TIMEOUT_MS); })]);
		} finally { clearTimeout(timer); }
	}

	/** Public summaries use only bounded cache reads; no provider access or queue writes. */
	public async readReferences(now = new Date()): Promise<ReferenceMap> {
		const charts = enabledReferenceCharts();
		if (!charts.length) return {};
		try {
			const sources = REFERENCE_SOURCES.filter(source => charts.some(key => REFERENCE_CHARTS[key].source === source));
			const keys = [...charts.map(referenceSnapshotKey), ...sources.map(referenceAttemptKey)];
			const values = await this.boundedRedis(() => this.redisClient.mget(...keys));
			const references: ReferenceMap = {};
			for (const [index, key] of charts.entries()) {
				const attempt = values[charts.length + sources.indexOf(REFERENCE_CHARTS[key].source)];
				const reference = packReference(key, values[index], attempt, now);
				if (reference) references[key] = reference;
			}
			return references;
		} catch { return {}; }
	}

	private async readPage(url: string, robots = false): Promise<string> {
		const allowed = robots ? `${REFERENCE_ORIGIN}/robots.txt` : REFERENCE_SOURCES.map(referenceUrl);
		if (typeof allowed === 'string' ? url !== allowed : !allowed.includes(url)) throw new Error('Disallowed reference URL');
		// Reuse the instance's transparent HTTP identity; no browser UA, cookies or proxy override.
		const limit = robots ? 64 * 1024 : 3 * 1024 * 1024;
		const startedAt = Date.now();
		let response: Awaited<ReturnType<HttpRequestService['send']>> | undefined;
		const failure = (reason: ReferenceDiagnostic['reason']) => new ReferenceReadError({ phase: robots ? 'robots' : 'page', reason, httpStatus: response?.status ?? null, retryAfterAt: referenceRetryAfter(response?.headers.get('retry-after') ?? null, Date.now()), elapsedMs: Math.min(600000, Math.max(0, Date.now() - startedAt)) });
		try {
			response = await this.httpRequestService.send(url, { timeout: 10000, size: limit, redirect: 'error' }, { throwErrorWhenResponseNotOk: false });
			if (response.status === 401) throw failure('http_401');
			if (response.status === 403) throw failure('http_403');
			if (response.status === 429) throw failure('http_429');
			if (response.status !== 200) throw failure('http_error');
			const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
			if (robots ? type !== 'text/plain' : !['text/html', 'application/xhtml+xml'].includes(type ?? '')) throw failure('content_type');
			const body = await response.text();
			if (Buffer.byteLength(body, 'utf8') > limit) throw failure('response_too_large');
			return body;
		} catch (error) {
			throw error instanceof ReferenceReadError ? error : failure(referenceTransportReason(error));
		} finally {
			if (response?.body instanceof Readable) response.body.destroy();
		}
	}

	public async collect(source: ReferenceSource, scheduledAt?: number): Promise<MusicChartCollectionResult> {
		if (!REFERENCE_SOURCES.includes(source)) throw new Error('Unknown reference source');
		const enabled = enabledReferenceCharts().filter(key => REFERENCE_CHARTS[key].source === source);
		if (!enabled.length) return;
		const checkedAt = new Date();
		try {
			const current = parseReferenceAttempt(await this.boundedRedis(() => this.redisClient.get(referenceAttemptKey(source))));
			const gate = musicChartCollectionGate(current, checkedAt.getTime(), scheduledAt);
			if (gate.action === 'defer') return { deferUntil: gate.deferUntil };
			if (gate.action === 'skip') return;
		} catch { return; }
		let status: 'available' | 'restricted' | 'unavailable' = 'available';
		let diagnostic: ReferenceDiagnostic | null = null;
		let snapshots: ReferenceSnapshot[] = [];
		let phase: ReferenceDiagnostic['phase'] = 'robots';
		let phaseStartedAt = Date.now();
		try {
			const url = referenceUrl(source);
			const robots = await this.readPage(`${REFERENCE_ORIGIN}/robots.txt`, true);
			const access = genericChartAccess(robots, new URL(url));
			if (access !== 'allowed') throw new ReferenceReadError({ phase, reason: access === 'denied' ? 'robots_denied' : 'robots_invalid', httpStatus: 200, retryAfterAt: null, elapsedMs: Math.min(600000, Math.max(0, Date.now() - phaseStartedAt)) });
			phase = 'page';
			const html = await this.readPage(url);
			phase = 'parse';
			phaseStartedAt = Date.now();
			snapshots = parseReferencePage(source, html, checkedAt);
			const expected = Object.entries(REFERENCE_CHARTS).filter(([, definition]) => definition.source === source).map(([key]) => key).sort();
			if (snapshots.map(snapshot => validateReferenceSnapshot(snapshot, checkedAt)).sort().join(',') !== expected.join(',')) throw new Error('Incomplete reference source');
			snapshots = snapshots.filter(snapshot => enabled.some(key => key === snapshot.chartKey));
		} catch (error) {
			diagnostic = error instanceof ReferenceReadError ? error.diagnostic : { phase, reason: 'invalid_payload', httpStatus: 200, retryAfterAt: null, elapsedMs: Math.min(600000, Math.max(0, Date.now() - phaseStartedAt)) };
			status = ['robots_denied', 'http_401', 'http_403', 'http_429'].includes(diagnostic.reason) ? 'restricted' : 'unavailable';
			snapshots = [];
		}
		await this.recordOutcome(source, status, snapshots, checkedAt, diagnostic);
		return undefined;
	}

	public async recordOutcome(source: ReferenceSource, status: 'available' | 'restricted' | 'unavailable', snapshots: ReferenceSnapshot[], checkedAt: Date, diagnostic: ReferenceDiagnostic | null = null): Promise<void> {
		if (!REFERENCE_SOURCES.includes(source) || !['available', 'restricted', 'unavailable'].includes(status) || !Number.isSafeInteger(checkedAt.getTime()) || checkedAt.getTime() <= 0) throw new Error('Invalid reference outcome');
		const enabled = enabledReferenceCharts().filter(key => REFERENCE_CHARTS[key].source === source);
		if (!enabled.length) return;
		if (diagnostic !== null && !parseReferenceDiagnostic(diagnostic)) throw new Error('Invalid reference diagnostic');
		const storedDiagnostic = status === 'available' ? null : parseReferenceDiagnostic(diagnostic);
		const keys = snapshots.map(snapshot => validateReferenceSnapshot(snapshot, checkedAt));
		if (new Set(keys).size !== keys.length || keys.some(key => !enabled.includes(key)) || (status === 'available' ? keys.length !== enabled.length : keys.length !== 0)) throw new Error('Invalid reference snapshot set');
		const entries = snapshots.map(snapshot => ({ ...snapshot, sourceFetchedMs: Date.parse(snapshot.sourceFetchedAt), lastSuccessAt: checkedAt.toISOString() }));
		const redisKeys = [referenceAttemptKey(source), ...keys.map(referenceSnapshotKey)];
		await this.boundedRedis(() => this.redisClient.eval(REFERENCE_WRITE_SCRIPT, redisKeys.length, ...redisKeys, checkedAt.getTime(), status, JSON.stringify(entries), REFERENCE_RETENTION_MS, REFERENCE_INTERVAL_MS, REFERENCE_FAILURE_INTERVAL_MS, JSON.stringify(storedDiagnostic), storedDiagnostic?.retryAfterAt ? Date.parse(storedDiagnostic.retryAfterAt) : 0));
	}

	/** Operator-only trusted proof application; deliberately not exposed by any API. */
	public async recoverMelon(samples: readonly [MelonRecoverySample, MelonRecoverySample], expected: MelonRecoveryExpected, parserSha256: string): Promise<boolean> {
		const enabled = enabledReferenceCharts();
		if (!enabled.includes('melon-daily') || !enabled.includes('melon-top100')) throw new Error('Melon reference recovery is not enabled');
		const prepared = prepareMelonReferenceRecovery(samples, expected, parserSha256);
		const result = await this.boundedRedis(() => this.redisClient.eval(REFERENCE_RECOVERY_SCRIPT, 3, referenceAttemptKey('melon'), referenceSnapshotKey('melon-daily'), referenceSnapshotKey('melon-top100'), JSON.stringify(expected), prepared.checkedAt, JSON.stringify(prepared.snapshots), REFERENCE_RETENTION_MS, REFERENCE_INTERVAL_MS));
		return result === 1;
	}
}
