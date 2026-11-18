/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { collectViteAssets } from './vite-assets.js';
import { resolve } from 'node:path';
import { promises as fsp } from 'node:fs';
import { languages } from 'i18n/const';
import { Injectable, Inject } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import { htmlSafeJsonStringify } from '@/misc/json-stringify-html-safe.js';
import { MetaEntityService } from '@/core/entities/MetaEntityService.js';
import type { FastifyReply } from 'fastify';
import type { Manifest } from 'vite';
import type { Config } from '@/config.js';
import type { MiMeta } from '@/models/Meta.js';
import type { CommonData, ViteFiles } from './views/_.js';

@Injectable()
export class HtmlTemplateService {
	private frontendAssetsFetched = false;
	private readonly frontendViteBuilt: string;
	private readonly frontendEmbedViteBuilt: string;
	public frontendViteFiles: ViteFiles | null = null;
	public frontendBootloaderJs: string | null = null;
	public frontendBootloaderCss: string | null = null;
	public frontendEmbedViteFiles: ViteFiles | null = null;
	public frontendEmbedBootloaderJs: string | null = null;
	public frontendEmbedBootloaderCss: string | null = null;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meta)
		private meta: MiMeta,

		private metaEntityService: MetaEntityService,
	) {
		this.frontendViteBuilt = resolve(this.config.rootDir, 'built/_frontend_vite_');
		this.frontendEmbedViteBuilt = resolve(this.config.rootDir, 'built/_frontend_embed_vite_');
	}

	@bindThis
	private async prepareFrontendAssets() {
		if (this.frontendAssetsFetched) return;
		this.frontendAssetsFetched = true;

		const [
			bootJs,
			bootCss,
			embedBootJs,
			embedBootCss,
		] = await Promise.all([
			fsp.readFile(resolve(this.frontendViteBuilt, 'loader/boot.js'), 'utf-8').catch(() => null),
			fsp.readFile(resolve(this.frontendViteBuilt, 'loader/style.css'), 'utf-8').catch(() => null),
			fsp.readFile(resolve(this.frontendEmbedViteBuilt, 'loader/boot.js'), 'utf-8').catch(() => null),
			fsp.readFile(resolve(this.frontendEmbedViteBuilt, 'loader/style.css'), 'utf-8').catch(() => null),
		]);

		let feViteManifest: Manifest | null = null;
		let embedFeViteManifest: Manifest | null = null;

		if (this.config.frontendManifestExists) {
			const manifestContent = await fsp.readFile(resolve(this.frontendViteBuilt, 'manifest.json'), 'utf-8').catch(() => null);
			feViteManifest = manifestContent ? JSON.parse(manifestContent) : null;
		}

		if (this.config.frontendEmbedManifestExists) {
			const manifestContent = await fsp.readFile(resolve(this.frontendEmbedViteBuilt, 'manifest.json'), 'utf-8').catch(() => null);
			embedFeViteManifest = manifestContent ? JSON.parse(manifestContent) : null;
		}

		if (feViteManifest != null) {
			this.frontendViteFiles = collectViteAssets(feViteManifest);
		}

		if (bootJs != null) {
			this.frontendBootloaderJs = bootJs;
		}

		if (bootCss != null) {
			this.frontendBootloaderCss = bootCss;
		}

		if (embedFeViteManifest != null) {
			this.frontendEmbedViteFiles = collectViteAssets(embedFeViteManifest);
		}

		if (embedBootJs != null) {
			this.frontendEmbedBootloaderJs = embedBootJs;
		}

		if (embedBootCss != null) {
			this.frontendEmbedBootloaderCss = embedBootCss;
		}
	}

	@bindThis
	public async getCommonData(): Promise<CommonData> {
		await this.prepareFrontendAssets();

		return {
			version: this.config.version,
			config: this.config,
			langs: [...languages],
			instanceName: this.meta.name ?? 'PUBO',
			icon: this.meta.iconUrl,
			appleTouchIcon: this.meta.app512IconUrl,
			themeColor: this.meta.themeColor,
			serverErrorImageUrl: this.meta.serverErrorImageUrl ?? 'https://xn--931a.moe/assets/error.jpg',
			infoImageUrl: this.meta.infoImageUrl ?? 'https://xn--931a.moe/assets/info.jpg',
			notFoundImageUrl: this.meta.notFoundImageUrl ?? 'https://xn--931a.moe/assets/not-found.jpg',
			instanceUrl: this.config.url,
			metaJson: htmlSafeJsonStringify(await this.metaEntityService.packDetailed(this.meta)),
			now: Date.now(),
			federationEnabled: this.meta.federation !== 'none',
			frontendViteFiles: this.frontendViteFiles,
			frontendBootloaderJs: this.frontendBootloaderJs,
			frontendBootloaderCss: this.frontendBootloaderCss,
			frontendEmbedViteFiles: this.frontendEmbedViteFiles,
			frontendEmbedBootloaderJs: this.frontendEmbedBootloaderJs,
			frontendEmbedBootloaderCss: this.frontendEmbedBootloaderCss,
		};
	}

	public static async replyHtml(reply: FastifyReply, html: string | Promise<string>) {
		reply.header('Content-Type', 'text/html; charset=utf-8');
		const _html = await html;
		return reply.send(_html);
	}
}
