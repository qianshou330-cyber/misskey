/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { decodeBlurhash } from '@@/js/blurhash.js';
import type { BlurhashRequest } from '@@/js/blurhash.js';

self.onmessage = (event: MessageEvent<BlurhashRequest>) => {
	const response = decodeBlurhash(event.data);
	self.postMessage(response, response.result ? [response.result.pixels] : []);
};
