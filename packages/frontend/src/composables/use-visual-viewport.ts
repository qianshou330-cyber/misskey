/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { onScopeDispose, ref, watch } from 'vue';
import type { Ref } from 'vue';

/** Keep a mobile surface inside the visual viewport while the keyboard is open. */
export function useVisualViewport(enabled: Ref<boolean>) {
	const style = ref<Record<string, string>>({});
	let frame: number | undefined;

	const update = () => {
		if (frame !== undefined) return;
		frame = window.requestAnimationFrame(() => {
			frame = undefined;
			const viewport = window.visualViewport;
			if (!viewport) {
				style.value = {};
				return;
			}
			style.value = {
				'--MI-chatViewportHeight': `${viewport.height}px`,
				'--MI-chatViewportTop': `${viewport.offsetTop}px`,
				'--MI-chatViewportLeft': `${viewport.offsetLeft}px`,
				'--MI-chatViewportWidth': `${viewport.width}px`,
			};
		});
	};

	watch(enabled, (active, _previous, onCleanup) => {
		if (!active) {
			style.value = {};
			return;
		}
		const viewport = window.visualViewport;
		window.addEventListener('resize', update, { passive: true });
		window.addEventListener('scroll', update, { passive: true });
		viewport?.addEventListener('resize', update, { passive: true });
		viewport?.addEventListener('scroll', update, { passive: true });
		update();
		onCleanup(() => {
			window.removeEventListener('resize', update);
			window.removeEventListener('scroll', update);
			viewport?.removeEventListener('resize', update);
			viewport?.removeEventListener('scroll', update);
			if (frame !== undefined) {
				window.cancelAnimationFrame(frame);
				frame = undefined;
			}
			style.value = {};
		});
	}, { immediate: true });

	onScopeDispose(() => {
		style.value = {};
	});

	return style;
}
