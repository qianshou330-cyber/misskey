/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { SnakeInput } from './types.js';

/** The instance only listens to the game surface; it never captures keys from the rest of PUBO. */
export class SnakeControls {
	angle = 0;
	boost = false;
	private seq = 0;
	private lastSent = -Infinity;
	private pointerBoost = false;
	private buttonBoost = false;
	private keyboardBoost = false;
	private steeringPointer: number | null = null;
	private release: (() => void)[] = [];

	constructor(private surface: HTMLElement, private boostButton: HTMLElement) {
		const listen = (element: HTMLElement, name: string, callback: EventListener): void => {
			element.addEventListener(name, callback);
			this.release.push(() => element.removeEventListener(name, callback));
		};
		const direction = (event: PointerEvent): void => {
			if (event.pointerType === 'touch' && event.pointerId !== this.steeringPointer) return;
			const rect = surface.getBoundingClientRect();
			const x = event.clientX - rect.left - rect.width / 2;
			const y = event.clientY - rect.top - rect.height / 2;
			if (x * x + y * y > 16) this.angle = Math.atan2(y, x);
		};
		listen(surface, 'pointermove', event => direction(event as PointerEvent));
		listen(surface, 'pointerdown', event => {
			const pointer = event as PointerEvent;
			if (pointer.button !== 0) return;
			if (pointer.pointerType === 'touch') {
				if (this.steeringPointer !== null && this.steeringPointer !== pointer.pointerId) return;
				this.steeringPointer = pointer.pointerId;
			} else if (!pointer.isPrimary) return;
			direction(pointer);
			surface.focus({ preventScroll: true });
			surface.setPointerCapture?.(pointer.pointerId);
			this.pointerBoost = pointer.pointerType !== 'touch';
			this.updateBoost();
		});
		for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
			listen(surface, name, event => {
				if ((event as PointerEvent).pointerId === this.steeringPointer) this.steeringPointer = null;
				this.pointerBoost = false; this.updateBoost();
			});
		}
		listen(surface, 'pointerleave', () => { this.pointerBoost = false; this.updateBoost(); });
		listen(surface, 'keydown', event => {
			const key = event as KeyboardEvent;
			if (key.code !== 'Space') return;
			key.preventDefault();
			this.keyboardBoost = true;
			this.updateBoost();
		});
		listen(surface, 'keyup', event => {
			if ((event as KeyboardEvent).code !== 'Space') return;
			event.preventDefault();
			this.keyboardBoost = false;
			this.updateBoost();
		});
		listen(surface, 'blur', () => this.resetBoost());
		listen(boostButton, 'pointerdown', event => {
			const pointer = event as PointerEvent;
			event.preventDefault();
			boostButton.setPointerCapture?.(pointer.pointerId);
			this.buttonBoost = true;
			this.updateBoost();
		});
		for (const name of ['pointerup', 'pointercancel', 'lostpointercapture', 'pointerleave', 'blur']) {
			listen(boostButton, name, () => { this.buttonBoost = false; this.updateBoost(); });
		}
		listen(boostButton, 'keydown', event => {
			if (!['Space', 'Enter'].includes((event as KeyboardEvent).code)) return;
			event.preventDefault();
			this.buttonBoost = true;
			this.updateBoost();
		});
		listen(boostButton, 'keyup', () => { this.buttonBoost = false; this.updateBoost(); });
	}

	private updateBoost(): void { this.boost = this.pointerBoost || this.buttonBoost || this.keyboardBoost; }
	resetBoost(): void { this.pointerBoost = this.buttonBoost = this.keyboardBoost = this.boost = false; }
	frame(now: number): SnakeInput | null {
		if (now - this.lastSent < 50) return null;
		this.lastSent = now;
		return { seq: ++this.seq, angle: this.angle, boost: this.boost };
	}
	dispose(): void { for (const release of this.release.splice(0)) release(); this.steeringPointer = null; this.resetBoost(); }
}
