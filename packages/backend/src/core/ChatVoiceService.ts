/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import { Injectable } from '@nestjs/common';

const execute = promisify(execFile);
export class ChatVoiceRejectedError extends Error {}

export function calculateChatPeaks(pcm: Buffer, count = 128): number[] {
	const samples = Math.floor(pcm.length / 2);
	if (samples === 0) return [];
	return Array.from({ length: Math.min(count, samples) }, (_, index) => {
		const start = Math.floor(index * samples / Math.min(count, samples));
		const end = Math.floor((index + 1) * samples / Math.min(count, samples));
		let peak = 0;
		for (let i = start; i < end; i++) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i * 2)) / 32768);
		return Math.round(peak * 1000) / 1000;
	});
}

@Injectable()
export class ChatVoiceService {
	private active = 0;

	public async convert(source: string, destination: string): Promise<{ durationMs: number; peaks: number[] }> {
		// Bound per-process CPU/memory. A busy client keeps its recording and may retry.
		if (this.active >= 2) throw new ChatVoiceRejectedError('Voice processing is busy; retry later');
		this.active++;
		try {
			const { stdout } = await execute('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_entries', 'format=duration:stream=codec_type,duration', '-of', 'json', source], { timeout: 10_000, windowsHide: true, maxBuffer: 1024 * 1024 });
			const info = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_type?: string; duration?: string }[] };
			const advertisedDuration = Number(info.format?.duration ?? info.streams?.find(s => s.codec_type === 'audio')?.duration);
			if (!info.streams?.some(s => s.codec_type === 'audio') || info.streams.some(s => s.codec_type === 'video') || (Number.isFinite(advertisedDuration) && advertisedDuration > 301)) {
				throw new ChatVoiceRejectedError('A valid audio-only recording of at most five minutes is required');
			}
			// MediaRecorder WebM often has no duration header. Decode at most 301 seconds,
			// measure samples, then reject overlong input instead of silently clipping it.
			const result = await execute('ffmpeg', ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-i', source, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '24000', '-t', '301', '-f', 's16le', 'pipe:1'], { timeout: 90_000, windowsHide: true, encoding: 'buffer', maxBuffer: 15 * 1024 * 1024 });
			const sampleCount = Math.floor(result.stdout.length / 2);
			if (sampleCount === 0 || sampleCount > 300 * 24000) throw new ChatVoiceRejectedError('A valid recording of at most five minutes is required');
			const pcmPath = `${destination}.pcm`;
			try {
				await fs.writeFile(pcmPath, result.stdout, { mode: 0o600, flag: 'wx' });
				await execute('ffmpeg', ['-nostdin', '-v', 'error', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', pcmPath, '-map_metadata', '-1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '64k', '-f', 'mp3', '-y', destination], { timeout: 60_000, windowsHide: true, maxBuffer: 1024 * 1024 });
			} finally { await fs.rm(pcmPath, { force: true }); }
			return { durationMs: Math.round(sampleCount * 1000 / 24000), peaks: calculateChatPeaks(result.stdout) };
		} catch (error) {
			if (error instanceof ChatVoiceRejectedError) throw error;
			// Never expose tool stderr, paths or private media metadata to API clients.
			throw new ChatVoiceRejectedError('Voice conversion failed or timed out');
		} finally {
			this.active--;
		}
	}
}
