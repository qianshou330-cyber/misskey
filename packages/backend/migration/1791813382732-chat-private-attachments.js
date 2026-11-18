/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Table, TableForeignKey, TableIndex } from 'typeorm';

const id = (name, nullable = false) => ({ name, type: 'varchar', length: '32', isNullable: nullable });
const text = (name, length, extra = {}) => ({ name, type: 'varchar', length: String(length), ...extra });
const integer = (name, extra = {}) => ({ name, type: 'integer', ...extra });
const date = (name, nullable = false) => ({ name, type: 'timestamp with time zone', isNullable: nullable });

export class ChatPrivateAttachments1791813382732 {
	name = 'ChatPrivateAttachments1791813382732';
	async up(queryRunner) {
		await queryRunner.createTable(new Table({ name: 'chat_attachment_blob', columns: [
			{ ...id('id'), isPrimary: true }, id('ownerId'), text('storageKey', 64, { isUnique: true }), text('sha256', 64), text('mime', 128), integer('size'), integer('storedSize'), text('kind', 16), integer('durationMs', { isNullable: true }),
			{ name: 'peaks', type: 'jsonb', default: "'[]'" }, integer('width', { isNullable: true }), integer('height', { isNullable: true }), integer('previewSize', { default: '0' }), date('createdAt'),
		] }));
		await queryRunner.createTable(new Table({ name: 'chat_attachment', columns: [
			{ ...id('id'), isPrimary: true }, id('ownerId'), id('toUserId'), id('blobId'), id('messageId', true), { name: 'position', type: 'smallint', default: '0' }, text('name', 256), text('state', 16, { default: "'staged'" }), text('legacyExposure', 16, { default: "'none'" }), { name: 'sourceRetainedShared', type: 'boolean', default: 'false' }, date('createdAt'), date('expiresAt', true),
		] }));
		await queryRunner.createTable(new Table({ name: 'chat_upload_reservation', columns: [{ ...id('id'), isPrimary: true }, id('ownerId'), integer('size'), date('expiresAt')] }));
		await queryRunner.createTable(new Table({ name: 'chat_attachment_migration', columns: [{ ...id('sourceFileId'), isPrimary: true }, id('blobId', true), text('state', 32, { default: "'pending'" }), { name: 'sharedReasons', type: 'jsonb', default: "'[]'" }, { name: 'sourceSnapshot', type: 'jsonb', isNullable: true }, date('updatedAt')] }));
		for (const [table, name, columns, unique] of [
			['chat_attachment_blob', 'IDX_chat_blob_owner_hash', ['ownerId', 'sha256', 'kind'], true],
			['chat_attachment', 'IDX_chat_attachment_message_position', ['messageId', 'position'], true],
			['chat_attachment', 'IDX_chat_attachment_blob', ['blobId'], false],
			['chat_attachment', 'IDX_chat_attachment_expiry', ['state', 'expiresAt'], false],
			['chat_upload_reservation', 'IDX_chat_reservation_owner_expiry', ['ownerId', 'expiresAt'], false],
		]) await queryRunner.createIndex(table, new TableIndex({ name, columnNames: columns, isUnique: unique }));
		for (const [table, name, column, target, onDelete] of [
			['chat_attachment_blob', 'FK_chat_blob_owner', 'ownerId', 'user', 'CASCADE'],
			['chat_attachment', 'FK_chat_attachment_owner', 'ownerId', 'user', 'CASCADE'],
			['chat_attachment', 'FK_chat_attachment_recipient', 'toUserId', 'user', 'CASCADE'],
			['chat_attachment', 'FK_chat_attachment_blob', 'blobId', 'chat_attachment_blob', 'RESTRICT'],
			['chat_attachment', 'FK_chat_attachment_message', 'messageId', 'chat_message', 'CASCADE'],
			['chat_upload_reservation', 'FK_chat_reservation_owner', 'ownerId', 'user', 'CASCADE'],
		]) await queryRunner.createForeignKey(table, new TableForeignKey({ name, columnNames: [column], referencedTableName: target, referencedColumnNames: ['id'], onDelete }));
	}
	async down(queryRunner) {
		const [row] = await queryRunner.query('SELECT (SELECT count(*) FROM chat_attachment_blob) + (SELECT count(*) FROM chat_attachment_migration) AS count');
		if (Number(row.count) !== 0) throw new Error('Export private Chat data before removing its schema; rollback must never republish attachments');
		for (const table of ['chat_attachment_migration', 'chat_upload_reservation', 'chat_attachment', 'chat_attachment_blob']) await queryRunner.dropTable(table);
	}
}
