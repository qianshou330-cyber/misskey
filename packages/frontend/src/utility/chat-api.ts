/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type * as Misskey from 'misskey-js';
import { misskeyApi } from '@/utility/misskey-api.js';

type ChatEndpoint = Extract<keyof Misskey.Endpoints, `chat/${string}`>;
export type ChatContactGroup = Misskey.Endpoints['chat/contact-groups/list']['res'][number];

/** Use the generated request/response contract with Misskey's existing transport. */
export function chatApi<E extends ChatEndpoint>(endpoint: E, data: Misskey.Endpoints[E]['req'], signal?: AbortSignal): Promise<Misskey.Endpoints[E]['res']> {
	return misskeyApi<Misskey.Endpoints[E]['res'], E, Misskey.Endpoints[E]['req'], Misskey.Endpoints[E]['res']>(endpoint, { ...data }, undefined, signal);
}
