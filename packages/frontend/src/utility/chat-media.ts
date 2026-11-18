/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { apiUrl } from '@@/js/config.js';
import type { ChatAttachment } from '@/types/chat.js';
import { $i } from '@/i.js';
import { ChatMediaBudget } from '@/utility/chat-media-budget.js';
import { getChatSendFailureCode } from '@/utility/chat-send-failure.js';

export const CHAT_ATTACHMENT_LIMIT = 10;
export const CHAT_FILE_LIMIT = 50 * 1024 * 1024;
export const CHAT_PREVIEW_LIMIT = 4 * 1024 * 1024;
const mediaBudget = new ChatMediaBudget(2, 100 * 1024 * 1024);
let playing: HTMLMediaElement | null = null;

export type ChatMediaLease = { size: number; type: string; readChunk: (start: number, end: number) => Promise<Uint8Array>; createObjectURL: () => string; release: () => void };
export function isChatMediaBudgetError(error: unknown): boolean { return error instanceof Error && error.message === 'CHAT_MEDIA_BUDGET'; }

export function claimChatAudio(media: HTMLMediaElement): void {
	if (playing !== media) playing?.pause();
	playing = media;
}

export function releaseChatAudio(media: HTMLMediaElement): void {
	media.pause();
	media.removeAttribute('src');
	media.load();
	if (playing === media) playing = null;
}

export async function fetchChatAttachment(attachmentId: string, variant: 'original' | 'preview' | 'download', signal?: AbortSignal, expectedBytes = CHAT_FILE_LIMIT): Promise<ChatMediaLease> {
	if (!$i) throw new Error('SIGNIN_REQUIRED');
	signal?.throwIfAborted();
	const account = $i;
	const accountId = account.id;
	const limit = variant === 'preview' ? CHAT_PREVIEW_LIMIT : Math.min(CHAT_FILE_LIMIT, expectedBytes);
	const reservation = await mediaBudget.acquire(limit, signal);
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	let objectUrl: string | undefined;
	let blob: Blob | undefined;
	let released = false;

	function release(): void {
		if (released) return;
		released = true;
		signal?.removeEventListener('abort', release);
		void reader?.cancel().catch(() => undefined);
		reader = undefined;
		if (objectUrl) URL.revokeObjectURL(objectUrl);
		objectUrl = undefined;
		blob = undefined;
		reservation.release();
	}

	signal?.addEventListener('abort', release, { once: true });
	try {
		signal?.throwIfAborted();
		if ($i?.id !== accountId) throw new Error('CHAT_ATTACHMENT_UNAVAILABLE');
		const response = await window.fetch(`${apiUrl}/chat/attachments/${encodeURIComponent(attachmentId)}/${variant}`, { headers: { Authorization: `Bearer ${account.token}` }, credentials: 'omit', cache: 'no-store', signal });
		if (released || signal?.aborted) { await response.body?.cancel().catch(() => undefined); signal?.throwIfAborted(); throw new Error('CHAT_ATTACHMENT_UNAVAILABLE'); }
		reader = response.body?.getReader();
		if (!response.ok || $i?.id !== accountId) throw new Error('CHAT_ATTACHMENT_UNAVAILABLE');
		const declaredLength = Number(response.headers.get('Content-Length'));
		if (Number.isFinite(declaredLength) && declaredLength > limit) throw new Error('CHAT_MEDIA_BUDGET');
		if (!reader) throw new Error('CHAT_ATTACHMENT_UNAVAILABLE');
		const chunks: Uint8Array<ArrayBuffer>[] = [];
		let size = 0;
		for (;;) {
			const part = await reader.read();
			if (part.done) break;
			size += part.value.byteLength;
			if (size > limit) throw new Error('CHAT_MEDIA_BUDGET');
			chunks.push(new Uint8Array(part.value));
		}
		signal?.throwIfAborted();
		if (released || $i?.id !== accountId) throw new Error('CHAT_ATTACHMENT_UNAVAILABLE');
		reader.releaseLock();
		reader = undefined;
		blob = new Blob(chunks, { type: response.headers.get('Content-Type') ?? 'application/octet-stream' });
		reservation.complete(blob.size);
		return { size: blob.size, type: blob.type, readChunk: async (start, end) => {
			if (released || !blob || $i?.id !== accountId) throw new Error('CHAT_ATTACHMENT_UNAVAILABLE');
			if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > blob.size || end - start > 65536) throw new Error('CHAT_MEDIA_BUDGET');
			const bytes = new Uint8Array(await blob.slice(start, end).arrayBuffer());
			if (released || $i?.id !== accountId) { bytes.fill(0); throw new Error('CHAT_ATTACHMENT_UNAVAILABLE'); }
			return bytes;
		}, createObjectURL: () => {
			if (released || !blob || $i?.id !== accountId) throw new Error('CHAT_ATTACHMENT_UNAVAILABLE');
			return objectUrl ??= URL.createObjectURL(blob);
		}, release };
	} catch (error) { release(); throw error; }
}

export function uploadChatAttachment(file: File, userId: string, kind: 'file' | 'voice', onProgress: (progress: number) => void): { promise: Promise<ChatAttachment>; abort: () => void } {
	const xhr = new XMLHttpRequest();
	const account = $i;
	const promise = new Promise<ChatAttachment>((resolve, reject) => {
		if (!account || file.size > Math.min(CHAT_FILE_LIMIT, account.policies.maxFileSizeMb * 1024 * 1024)) { reject(new Error('CHAT_ATTACHMENT_SIZE')); return; }
		xhr.open('POST', `${apiUrl}/chat/attachments/create`);
		xhr.setRequestHeader('Authorization', `Bearer ${account.token}`);
		xhr.responseType = 'json';
		xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded / event.total); };
		xhr.onload = () => {
			if (xhr.status === 200 && $i?.id === account.id) resolve(xhr.response as ChatAttachment);
			else {
				const code = $i?.id === account.id ? getChatSendFailureCode(xhr.response?.error) : undefined;
				reject(code ? { code } : new Error('CHAT_ATTACHMENT_UPLOAD_FAILED'));
			}
		};
		xhr.onerror = () => reject(new Error('CHAT_ATTACHMENT_UPLOAD_FAILED'));
		xhr.onabort = () => reject(new Error('CHAT_ATTACHMENT_UPLOAD_ABORTED'));
		const data = new FormData();
		data.append('toUserId', userId);
		data.append('kind', kind);
		data.append('file', file);
		data.append('name', file.name);
		xhr.send(data);
	});
	return { promise, abort: () => xhr.abort() };
}
