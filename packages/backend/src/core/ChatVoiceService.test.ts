/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import 'reflect-metadata';
import * as fs from 'node:fs/promises';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatVoiceService, calculateChatPeaks } from './ChatVoiceService.js';

const execute = promisify(execFile);
const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { windowsHide: true, timeout: 5000 }).status === 0 && spawnSync('ffprobe', ['-version'], { windowsHide: true, timeout: 5000 }).status === 0;

describe('bounded voice peaks', () => {
	it('handles silence, signed full scale and incomplete samples without NaN', () => {
		expect(calculateChatPeaks(Buffer.alloc(0))).toEqual([]);
		expect(calculateChatPeaks(Buffer.alloc(800))).toHaveLength(128);
		expect(calculateChatPeaks(Buffer.alloc(800)).every(x => x === 0)).toBe(true);
		const samples = Buffer.alloc(5); samples.writeInt16LE(-32768, 0); samples.writeInt16LE(32767, 2);
		expect(calculateChatPeaks(samples)).toEqual([1, 1]);
	});
});

describe.skipIf(!hasFfmpeg)('real FFmpeg recording interoperability (requires runtime binaries)', () => {
	const directories: string[] = [];
	afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory, { force: true, recursive: true }); });

	async function temporary() { const value = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-voice-test-')); directories.push(value); return value; }

	it('accepts a real pipe-written MediaRecorder-style WebM with no duration', async () => {
		const directory = await temporary();
		const result = await execute('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libopus', '-f', 'webm', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1024 * 1024, windowsHide: true });
		const source = path.join(directory, 'stream.webm'); await fs.writeFile(source, result.stdout);
		const probe = await execute('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', source], { windowsHide: true });
		expect(JSON.parse(probe.stdout).format?.duration).toBeUndefined();
		const destination = path.join(directory, 'voice.mp3');
		const converted = await new ChatVoiceService().convert(source, destination);
		expect(converted.durationMs).toBeGreaterThan(900);
		expect(converted.durationMs).toBeLessThan(1100);
		expect(converted.peaks).toHaveLength(128);
		expect((await fs.stat(destination)).size).toBeGreaterThan(1000);
		await expect(fs.stat(`${destination}.pcm`)).rejects.toMatchObject({ code: 'ENOENT' });
	}, 120_000);

	it('rejects an over-five-minute real stream instead of truncating and reporting success', async () => {
		const directory = await temporary();
		const source = path.join(directory, 'long.wav');
		await execute('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-t', '301', source], { timeout: 60_000, windowsHide: true });
		const destination = path.join(directory, 'voice.mp3');
		await expect(new ChatVoiceService().convert(source, destination)).rejects.toThrow('at most five minutes');
		await expect(fs.stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
	}, 120_000);

	it('rejects an actual video stream even when presented as a voice recording', async () => {
		const directory = await temporary();
		const source = path.join(directory, 'fake-voice.webm');
		await execute('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=16x16:r=1:d=1', '-c:v', 'libvpx', source], { timeout: 60_000, windowsHide: true });
		await expect(new ChatVoiceService().convert(source, path.join(directory, 'voice.mp3'))).rejects.toThrow('audio-only');
	}, 120_000);
});
