/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { describe, expect, beforeAll, beforeEach, afterAll, afterEach, test, vi } from 'vitest';
import type { Mocked } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import { Test } from '@nestjs/testing';
import { GlobalModule } from '@/GlobalModule.js';
import { AnnouncementService, InvalidMarqueeAnnouncementError } from '@/core/AnnouncementService.js';
import { AnnouncementEntityService } from '@/core/entities/AnnouncementEntityService.js';
import type {
	AnnouncementReadsRepository,
	AnnouncementsRepository,
	MiAnnouncement,
	MiUser,
	UsersRepository,
} from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { genAidx } from '@/misc/id/aidx.js';
import { CacheService } from '@/core/CacheService.js';
import { IdService } from '@/core/IdService.js';
import { QueryService } from '@/core/QueryService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';
import { secureRndstr } from '@/misc/secure-rndstr.js';
import AnnouncementsEndpoint from '@/server/api/endpoints/announcements.js';
import CreateAnnouncementEndpoint from '@/server/api/endpoints/admin/announcements/create.js';
import UpdateAnnouncementEndpoint from '@/server/api/endpoints/admin/announcements/update.js';
import type { MiLocalUser } from '@/models/User.js';
import type { TestingModule } from '@nestjs/testing';

describe('AnnouncementService', () => {
	let app: TestingModule;
	let announcementService: AnnouncementService;
	let usersRepository: UsersRepository;
	let announcementsRepository: AnnouncementsRepository;
	let announcementReadsRepository: AnnouncementReadsRepository;
	let globalEventService: Mocked<GlobalEventService>;
	let moderationLogService: Mocked<ModerationLogService>;

	function createUser(data: Partial<MiUser> = {}) {
		const un = secureRndstr(16);
		return usersRepository.insert({
			id: genAidx(Date.now()),
			username: un,
			usernameLower: un.toLowerCase(),
			...data,
		})
			.then(x => usersRepository.findOneByOrFail(x.identifiers[0]));
	}

	function createAnnouncement(data: Partial<MiAnnouncement & { createdAt: Date }> = {}) {
		return announcementsRepository.insert({
			id: genAidx(data.createdAt?.getTime() ?? Date.now()),
			updatedAt: null,
			title: 'Title',
			text: 'Text',
			...data,
		})
			.then(x => announcementsRepository.findOneByOrFail(x.identifiers[0]));
	}

	beforeAll(async () => {
		app = await Test.createTestingModule({
			imports: [
				GlobalModule,
			],
			providers: [
				AnnouncementService,
				AnnouncementEntityService,
				CacheService,
				IdService,
				QueryService,
				AnnouncementsEndpoint,
				CreateAnnouncementEndpoint,
				UpdateAnnouncementEndpoint,
			],
		})
			.useMocker((token) => {
				if (token === GlobalEventService) {
					return {
						publishMainStream: vi.fn(),
						publishBroadcastStream: vi.fn(),
					};
				} else if (token === ModerationLogService) {
					return {
						log: vi.fn(),
					};
				} else if (typeof token === 'function') {
					return mockDeep<typeof token>();
				}
			})
			.compile();

		app.enableShutdownHooks();

		announcementService = app.get<AnnouncementService>(AnnouncementService);
		usersRepository = app.get<UsersRepository>(DI.usersRepository);
		announcementsRepository = app.get<AnnouncementsRepository>(DI.announcementsRepository);
		announcementReadsRepository = app.get<AnnouncementReadsRepository>(DI.announcementReadsRepository);
		globalEventService = app.get<GlobalEventService>(GlobalEventService) as Mocked<GlobalEventService>;
		moderationLogService = app.get<ModerationLogService>(ModerationLogService) as Mocked<ModerationLogService>;
	});

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(async () => {
		await Promise.all([
			app.get(DI.metasRepository).createQueryBuilder().delete().execute(),
			usersRepository.createQueryBuilder().delete().execute(),
			announcementsRepository.createQueryBuilder().delete().execute(),
			announcementReadsRepository.createQueryBuilder().delete().execute(),
		]);
	});

	afterAll(async () => {
		await app.close();
	});

		describe('getUnreadAnnouncements', () => {
		test('通常', async () => {
			const user = await createUser();
			const announcement = await createAnnouncement({
				title: '1',
			});

			const result = await announcementService.getUnreadAnnouncements(user);

			expect(result.length).toBe(1);
			expect(result[0].title).toBe(announcement.title);
		});

		test('isActiveがfalseは除外', async () => {
			const user = await createUser();
			await createAnnouncement({
				isActive: false,
			});

			const result = await announcementService.getUnreadAnnouncements(user);

			expect(result.length).toBe(0);
		});

		test('marquees are excluded even when an old row has silence disabled', async () => {
			const user = await createUser();
			await createAnnouncement({ display: 'marquee', silence: false });
			const normal = await createAnnouncement({ display: 'normal', silence: false });

			expect((await announcementService.getUnreadAnnouncements(user)).map(a => a.id)).toEqual([normal.id]);
		});

		test('forExistingUsers', async () => {
			const user = await createUser();
			const [announcementAfter, announcementBefore, announcementBefore2] = await Promise.all([
				createAnnouncement({
					title: 'after',
					createdAt: new Date(),
					forExistingUsers: true,
				}),
				createAnnouncement({
					title: 'before',
					createdAt: new Date(Date.now() - 1000),
					forExistingUsers: true,
				}),
				createAnnouncement({
					title: 'before2',
					createdAt: new Date(Date.now() - 1000),
					forExistingUsers: false,
				}),
			]);

			const result = await announcementService.getUnreadAnnouncements(user);

			expect(result.length).toBe(2);
			expect(result.some(a => a.title === announcementAfter.title)).toBe(true);
			expect(result.some(a => a.title === announcementBefore.title)).toBe(false);
			expect(result.some(a => a.title === announcementBefore2.title)).toBe(true);
		});
	});

	describe('create', () => {
		test('marquees enforce public silent settings without emitting an announcement notification', async () => {
			const moderator = await createUser();
			const result = await announcementService.create({
				title: 'Welcome', text: 'Welcome', display: 'marquee',
				forExistingUsers: true, silence: false, needConfirmationToRead: true,
			}, moderator);

			expect(result.raw).toMatchObject({
				display: 'marquee', userId: null,
				forExistingUsers: false, silence: true, needConfirmationToRead: false,
			});
			expect(result.packed).toMatchObject({ display: 'marquee', silence: true, needConfirmationToRead: false });
			expect(globalEventService.publishBroadcastStream).not.toHaveBeenCalled();
			expect(globalEventService.publishMainStream).not.toHaveBeenCalled();
			expect(moderationLogService.log).toHaveBeenCalled();
		});

		test('a personal marquee is rejected before inserting or notifying', async () => {
			const user = await createUser();
			await expect(announcementService.create({
				title: 'Private', text: 'Private', display: 'marquee', userId: user.id,
			})).rejects.toBeInstanceOf(InvalidMarqueeAnnouncementError);
			expect(await announcementsRepository.count()).toBe(0);
			expect(globalEventService.publishBroadcastStream).not.toHaveBeenCalled();
			expect(globalEventService.publishMainStream).not.toHaveBeenCalled();
		});

		test('通常', async () => {
			const me = await createUser();
			const result = await announcementService.create({
				title: 'Title',
				text: 'Text',
			}, me);

			expect(result.raw.title).toBe('Title');
			expect(result.packed.title).toBe('Title');

			expect(globalEventService.publishBroadcastStream).toHaveBeenCalled();
			expect(globalEventService.publishBroadcastStream.mock.lastCall![0]).toBe('announcementCreated');
			expect((globalEventService.publishBroadcastStream.mock.lastCall![1] as any).announcement).toBe(result.packed);
			expect(moderationLogService.log).toHaveBeenCalled();
		});

		test('ユーザー指定', async () => {
			const me = await createUser();
			const user = await createUser();
			const result = await announcementService.create({
				title: 'Title',
				text: 'Text',
				userId: user.id,
			}, me);

			expect(result.raw.title).toBe('Title');
			expect(result.packed.title).toBe('Title');

			expect(globalEventService.publishBroadcastStream).not.toHaveBeenCalled();
			expect(globalEventService.publishMainStream).toHaveBeenCalled();
			expect(globalEventService.publishMainStream.mock.lastCall![0]).toBe(user.id);
			expect(globalEventService.publishMainStream.mock.lastCall![1]).toBe('announcementCreated');
			expect((globalEventService.publishMainStream.mock.lastCall![2] as any).announcement).toBe(result.packed);
			expect(moderationLogService.log).toHaveBeenCalled();
		});
	});

	describe('update', () => {
		test('partial marquee edits cannot re-enable reminders or erase unrelated content', async () => {
			const announcement = await createAnnouncement({
				display: 'marquee', silence: true, imageUrl: 'https://example.com/image.png',
			});
			await announcementService.update(announcement, {
				title: 'Updated', silence: false, forExistingUsers: true, needConfirmationToRead: true,
			});

			expect(await announcementsRepository.findOneByOrFail({ id: announcement.id })).toMatchObject({
				title: 'Updated', text: announcement.text, display: 'marquee',
				imageUrl: announcement.imageUrl, silence: true, forExistingUsers: false, needConfirmationToRead: false,
			});
		});

		test('converting a global announcement normalizes the resulting marquee', async () => {
			const announcement = await createAnnouncement({
				display: 'dialog', forExistingUsers: true, silence: false, needConfirmationToRead: true,
			});
			await announcementService.update(announcement, { display: 'marquee' });
			expect(await announcementsRepository.findOneByOrFail({ id: announcement.id })).toMatchObject({
				display: 'marquee', silence: true, forExistingUsers: false, needConfirmationToRead: false,
			});
		});

		test('converting a personal announcement to marquee never makes it public', async () => {
			const user = await createUser();
			const announcement = await createAnnouncement({ userId: user.id });
			await expect(announcementService.update(announcement, { display: 'marquee', userId: null }))
				.rejects.toBeInstanceOf(InvalidMarqueeAnnouncementError);
			expect(await announcementsRepository.findOneByOrFail({ id: announcement.id })).toMatchObject({
				display: 'normal', userId: user.id,
			});
		});

		test.each(['normal', 'banner', 'dialog'] as const)('%s preserves existing options on partial updates', async (display) => {
			const announcement = await createAnnouncement({
				display, imageUrl: 'https://example.com/image.png', forExistingUsers: true,
				silence: false, needConfirmationToRead: true,
			});
			await announcementService.update(announcement, { isActive: false });
			expect(await announcementsRepository.findOneByOrFail({ id: announcement.id })).toMatchObject({
				display, isActive: false, imageUrl: announcement.imageUrl, forExistingUsers: true,
				silence: false, needConfirmationToRead: true,
			});
		});

		test('leaving marquee allows the normal notification options again', async () => {
			const announcement = await createAnnouncement({ display: 'marquee', silence: true });
			await announcementService.update(announcement, {
				display: 'banner', silence: false, forExistingUsers: true, needConfirmationToRead: true,
				imageUrl: '',
			});
			expect(await announcementsRepository.findOneByOrFail({ id: announcement.id })).toMatchObject({
				display: 'banner', silence: false, forExistingUsers: true, needConfirmationToRead: true,
				imageUrl: null,
			});
		});
	});

	describe('announcement endpoints', () => {
		test('marquee filtering precedes pagination and excludes private or archived rows', async () => {
			const user = await createUser();
			const older = await createAnnouncement({ display: 'marquee', createdAt: new Date(Date.now() - 5000) });
			const newer = await createAnnouncement({ display: 'marquee', createdAt: new Date(Date.now() - 4000) });
			await createAnnouncement({ display: 'dialog' });
			await createAnnouncement({ display: 'marquee', isActive: false });
			await createAnnouncement({ display: 'marquee', userId: user.id });
			const endpoint = app.get(AnnouncementsEndpoint);

			const guest = await endpoint.exec({ display: 'marquee', limit: 1 }, null, null);
			const loggedIn = await endpoint.exec({ display: 'marquee', limit: 1 }, user as MiLocalUser, null);
			expect(guest.map((a: MiAnnouncement) => a.id)).toEqual([newer.id]);
			expect(loggedIn.map((a: MiAnnouncement) => a.id)).toEqual([newer.id]);
			const secondPage = await endpoint.exec({ display: 'marquee', limit: 1, untilId: newer.id }, null, null);
			expect(secondPage.map((a: MiAnnouncement) => a.id)).toEqual([older.id]);
		});

		test('omitting the filter preserves the existing global and personal visibility rules', async () => {
			const user = await createUser();
			const other = await createUser();
			const global = await createAnnouncement({ display: 'banner' });
			const personal = await createAnnouncement({ display: 'normal', userId: user.id });
			await createAnnouncement({ display: 'dialog', userId: other.id });
			const endpoint = app.get(AnnouncementsEndpoint);

			const guest = await endpoint.exec({}, null, null);
			const loggedIn = await endpoint.exec({}, user as MiLocalUser, null);
			expect(guest.map((a: MiAnnouncement) => a.id)).toEqual([global.id]);
			expect(new Set(loggedIn.map((a: MiAnnouncement) => a.id))).toEqual(new Set([global.id, personal.id]));
		});

		test('invalid display filters fail parameter validation', async () => {
			await expect(app.get(AnnouncementsEndpoint).exec({ display: 'unknown' }, null, null))
				.rejects.toMatchObject({ code: 'INVALID_PARAM' });
		});

		test('create and update map invalid personal marquees to a client error', async () => {
			const moderator = await createUser();
			const personal = await createAnnouncement({ userId: moderator.id });
			await expect(app.get(CreateAnnouncementEndpoint).exec({
				title: 'Private', text: 'Private', imageUrl: null, display: 'marquee', userId: moderator.id,
			}, moderator as MiLocalUser, null)).rejects.toMatchObject({ code: 'INVALID_MARQUEE_ANNOUNCEMENT' });
			await expect(app.get(UpdateAnnouncementEndpoint).exec({
				id: personal.id, display: 'marquee',
			}, moderator as MiLocalUser, null)).rejects.toMatchObject({ code: 'INVALID_MARQUEE_ANNOUNCEMENT' });
		});

		test('a partial API edit preserves an existing image and enforces marquee options', async () => {
			const moderator = await createUser();
			const announcement = await createAnnouncement({ display: 'marquee', imageUrl: 'https://example.com/image.png' });
			await app.get(UpdateAnnouncementEndpoint).exec({
				id: announcement.id, title: 'Updated', silence: false, forExistingUsers: true, needConfirmationToRead: true,
			}, moderator as MiLocalUser, null);
			expect(await announcementsRepository.findOneByOrFail({ id: announcement.id })).toMatchObject({
				title: 'Updated', imageUrl: announcement.imageUrl, display: 'marquee',
				silence: true, forExistingUsers: false, needConfirmationToRead: false,
			});
		});
	});

	describe('read', () => {
		test('reading a marquee does not archive it', async () => {
			const user = await createUser();
			const announcement = await createAnnouncement({ display: 'marquee', silence: true });
			await announcementService.read(user, announcement.id);
			expect(await announcementsRepository.findOneByOrFail({ id: announcement.id })).toMatchObject({ isActive: true });
			expect(await announcementService.getUnreadAnnouncements(user)).toEqual([]);
			expect(await announcementService.getAnnouncement(announcement.id, null)).toMatchObject({ display: 'marquee' });
		});
	});
});
