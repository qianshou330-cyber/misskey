/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const chatAttachmentSchema = {
	type: 'object', optional: false, nullable: false,
	properties: {
		id: { type: 'string', optional: false, nullable: false },
		name: { type: 'string', optional: false, nullable: false },
		mime: { type: 'string', optional: false, nullable: false },
		size: { type: 'integer', optional: false, nullable: false },
		kind: { type: 'string', enum: ['file', 'image', 'voice'], optional: false, nullable: false },
		durationMs: { type: 'integer', optional: false, nullable: true },
		peaks: { type: 'array', optional: false, nullable: false, items: { type: 'number', optional: false, nullable: false } },
		width: { type: 'integer', optional: false, nullable: true },
		height: { type: 'integer', optional: false, nullable: true },
		hasPreview: { type: 'boolean', optional: false, nullable: false },
		legacyExposure: { type: 'string', enum: ['none', 'possible'], optional: false, nullable: false },
		sourceRetainedShared: { type: 'boolean', optional: false, nullable: false },
		expiresAt: { type: 'string', format: 'date-time', optional: false, nullable: true },
	},
} as const;
