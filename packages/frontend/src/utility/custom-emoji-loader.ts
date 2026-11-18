/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { entities } from 'misskey-js';

type Emoji = entities.EmojiSimple;
type Cache = { emojis: unknown; fetchedAt: unknown };
type Dependencies = {
	readCache: () => Promise<Cache>;
	writeCache: (emojis: Emoji[], fetchedAt: number, isCurrent: () => boolean) => Promise<void>;
	request: (force: boolean, signal: AbortSignal) => Promise<{ emojis: unknown }>;
	changed: (emojis: Emoji[]) => void;
};

function validEmojis(value: unknown): value is Emoji[] {
	if (!Array.isArray(value)) return false;
	const names = new Set<string>();
	return value.every(emoji => {
		if (!emoji || typeof emoji.name !== 'string' || !emoji.name || names.has(emoji.name) ||
			typeof emoji.url !== 'string' || !emoji.url || !Array.isArray(emoji.aliases) ||
			!emoji.aliases.every((alias: unknown) => typeof alias === 'string') ||
			(emoji.category != null && typeof emoji.category !== 'string')) return false;
		names.add(emoji.name);
		return true;
	});
}

/** Loads optional emoji data without making application mounting depend on storage or HTTP. */
export class CustomEmojiLoader {
	private emojis: Emoji[] = [];
	private changes = new Map<string, { revision: number; emoji: Emoji | null }>();
	private revision = 0;
	private generation = 0;
	private hasSnapshot = false;
	private networkApplied = false;
	private fetchedAt = 0;
	private hydrated: Promise<void> | undefined;
	private active: { force: boolean; controller: AbortController; promise: Promise<void> } | undefined;
	private writes: Promise<void> = Promise.resolve();
	private writeRevision = 0;

	constructor(private readonly dependencies: Dependencies) {}

	private publish(emojis: Emoji[]) {
		this.emojis = emojis;
		this.dependencies.changed(emojis);
	}

	private replay(emojis: Emoji[], since: number): Emoji[] {
		const result = new Map(emojis.map(emoji => [emoji.name, emoji]));
		for (const [name, change] of this.changes) {
			if (change.revision <= since) continue;
			if (change.emoji) result.set(name, change.emoji);
			else result.delete(name);
		}
		return [...result.values()];
	}

	private persist() {
		if (!this.hasSnapshot) return;
		const writeRevision = ++this.writeRevision;
		const emojis = this.emojis;
		const fetchedAt = this.fetchedAt;
		const isCurrent = () => writeRevision === this.writeRevision;
		// Serialize storage writes: a slow old transaction must finish before a newer one starts.
		this.writes = this.writes.then(async () => {
			if (isCurrent()) await this.dependencies.writeCache(emojis, fetchedAt, isCurrent);
		}).catch(() => { /* Storage is optional; retain the current in-memory data. */ });
	}

	private hydrate(): Promise<void> {
		if (this.hydrated) return this.hydrated;
		this.hydrated = (async () => {
			let timer: number | undefined;
			try {
				const cache = await Promise.race([
					Promise.resolve().then(() => this.dependencies.readCache()),
					new Promise<undefined>(resolve => { timer = window.setTimeout(() => resolve(undefined), 1000); }),
				]);
				if (!cache || !validEmojis(cache.emojis) || this.networkApplied) return;
				this.hasSnapshot = true;
				this.fetchedAt = typeof cache.fetchedAt === 'number' && Number.isFinite(cache.fetchedAt) ? cache.fetchedAt : 0;
				this.publish(this.replay(cache.emojis, 0));
				if (this.changes.size > 0) this.persist();
			} catch { /* An unavailable cache must not prevent fetching fresh data. */ } finally {
				window.clearTimeout(timer);
			}
		})();
		return this.hydrated;
	}

	fetch(force = false): Promise<void> {
		if (this.active && (!force || this.active.force)) return this.active.promise;
		this.active?.controller.abort(new DOMException('Emoji refresh superseded', 'AbortError'));
		const generation = ++this.generation;
		const revision = this.revision;
		const controller = new AbortController();
		const { signal } = controller;
		let timer: number | undefined;
		let onAbort!: () => void;
		const aborted = new Promise<never>((_resolve, reject) => {
			onAbort = () => reject(signal.reason);
			signal.addEventListener('abort', onAbort, { once: true });
		});
		const operation = (async () => {
			// Even force refreshes may use a timely cached snapshot while their request runs.
			const hydrated = this.hydrate();
			if (!force) await hydrated;
			if (signal.aborted) throw signal.reason;
			const age = Date.now() - this.fetchedAt;
			if (!force && this.hasSnapshot && this.fetchedAt > 0 && age >= 0 && age < 60 * 60 * 1000) return;
			timer = window.setTimeout(() => controller.abort(new DOMException('Emoji request timed out', 'TimeoutError')), 8000);
			const response = await this.dependencies.request(force, signal);
			if (signal.aborted || generation !== this.generation) throw signal.reason ?? new DOMException('Emoji refresh superseded', 'AbortError');
			if (!response || !validEmojis(response.emojis)) throw new Error('Invalid emoji response');
			this.networkApplied = true;
			this.hasSnapshot = true;
			this.fetchedAt = Date.now();
			this.publish(this.replay(response.emojis, revision));
			this.persist();
			for (const [name, change] of this.changes) {
				if (change.revision <= revision) this.changes.delete(name);
			}
		})();
		const promise = Promise.race([operation, aborted]).finally(() => {
			window.clearTimeout(timer);
			signal.removeEventListener('abort', onAbort);
			if (generation === this.generation) this.active = undefined;
		});
		this.active = { force, controller, promise };
		return promise;
	}

	add(emoji: Emoji) {
		this.changes.set(emoji.name, { revision: ++this.revision, emoji });
		this.publish([emoji, ...this.emojis.filter(item => item.name !== emoji.name)]);
		this.persist();
	}

	update(emojis: Emoji[]) {
		const updated = new Map(this.emojis.map(emoji => [emoji.name, emoji]));
		for (const emoji of emojis) {
			this.changes.set(emoji.name, { revision: ++this.revision, emoji });
			updated.set(emoji.name, emoji);
		}
		this.publish([...updated.values()]);
		this.persist();
	}

	remove(emojis: Emoji[]) {
		for (const emoji of emojis) this.changes.set(emoji.name, { revision: ++this.revision, emoji: null });
		const removed = new Set(emojis.map(emoji => emoji.name));
		this.publish(this.emojis.filter(emoji => !removed.has(emoji.name)));
		this.persist();
	}
}
