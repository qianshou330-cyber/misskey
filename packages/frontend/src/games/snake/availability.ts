/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue';
import { instance } from '@/instance.js';
import { misskeyApi } from '@/utility/misskey-api.js';

/** Refresh the public launch flag on entry; cached global metadata is not changed by this view. */
export function useSnakeAvailability() {
	const enabled = ref(instance.snakeGameEnabled === true);
	let controller: AbortController | null = null;

	function activate(): void {
		if (controller) return;
		const request = controller = new AbortController();
		void misskeyApi('meta', { detail: true }, null, request.signal).then(meta => {
			if (!request.signal.aborted && controller === request) enabled.value = meta.snakeGameEnabled === true;
		}).catch(() => { /* Keep the last public flag; the session endpoint always enforces the live gate. */ });
	}

	function deactivate(): void { controller?.abort(); controller = null; }

	onMounted(activate);
	onActivated(activate);
	onDeactivated(deactivate);
	onBeforeUnmount(deactivate);
	return enabled;
}
