/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { KpopSourceError } from './types.js';
import type { KpopArtist, KpopChartKey, KpopGroupId, KpopSource } from './types.js';

export type KpopChartDefinition = {
	key: KpopChartKey; source: KpopSource; label: string; url: string; robotsUrl: string;
	expectedCount: number; coverage: 'complete' | 'preview'; sourceTotal: number | null;
	rankBasis: 'official_rank' | 'playlist_order'; periodMinutes: number; coverHosts: string[];
};
const define = (key: KpopChartKey, source: KpopSource, label: string, url: string, count: number, coverHosts: string[], extra: Partial<KpopChartDefinition> = {}): KpopChartDefinition => ({
	key, source, label, url, robotsUrl: new URL('/robots.txt', url).href, expectedCount: count,
	coverage: 'complete', sourceTotal: count, rankBasis: 'official_rank', periodMinutes: 60, coverHosts, ...extra,
});
export const KPOP_CHARTS: Record<KpopChartKey, KpopChartDefinition> = {
	'melon-daily': define('melon-daily', 'melon', 'Melon Daily', 'https://www.melon.com/chart/day/index.htm', 100, ['cdnimg.melon.co.kr'], { periodMinutes: 1440 }),
	'melon-hot100': define('melon-hot100', 'melon', 'Melon HOT100 D100', 'https://www.melon.com/chart/hot100/index.htm', 100, ['cdnimg.melon.co.kr']),
	'melon-top100': define('melon-top100', 'melon', 'Melon TOP100', 'https://www.melon.com/chart/index.htm', 100, ['cdnimg.melon.co.kr']),
	'melon-hot100-d30': define('melon-hot100-d30', 'melon', 'Melon HOT100 D30', 'https://www.melon.com/chart/hot100/index.htm?chartType=D30', 100, ['cdnimg.melon.co.kr']),
	'genie-realtime': define('genie-realtime', 'genie', 'Genie TOP200', 'https://genie.co.kr/chart/top200', 200, ['image.genie.co.kr']),
	'bugs-realtime': define('bugs-realtime', 'bugs', 'Bugs Realtime', 'https://music.bugs.co.kr/chart/track/realtime/total', 100, ['image.bugsm.co.kr']),
	flo: define('flo', 'flo', 'FLO TOP100', 'https://www.music-flo.com/browse', 100, ['cdn.music-flo.com']),
	apple: define('apple', 'apple', 'Apple Music Korea TOP100', 'https://music.apple.com/ee/playlist/top-100-south-korea/pl.d3d10c32fbc540b38e266367dc8cb00c', 100, ['is1-ssl.mzstatic.com'], { rankBasis: 'playlist_order', periodMinutes: 1440 }),
	spotify: define('spotify', 'spotify', 'Spotify Korea TOP50', 'https://open.spotify.com/playlist/37i9dQZEVXbNxXF4SkHj9F', 30, ['i.scdn.co'], { rankBasis: 'playlist_order', coverage: 'preview', sourceTotal: 50, periodMinutes: 1440 }),
	tencent: define('tencent', 'tencent', 'Tencent Korean Chart', 'https://yobang.tencentmusic.com/chart/korean-chart/rankList/', 10, ['y.gtimg.cn'], { coverage: 'preview', sourceTotal: null, periodMinutes: 1440 }),
	'billboard-korea-global-k-songs': define('billboard-korea-global-k-songs', 'billboard', 'Billboard Korea Global K-Songs', 'https://billboard.co.kr/charts/billboard-korea-global-k-songs/', 100, ['contents.billboard.co.kr'], { periodMinutes: 10080 }),
};
// IDs are scoped to their platform. Exact artist credits are required too;
// absent platform IDs never borrow an ID from another service.
export const KPOP_GROUPS: { id: KpopGroupId; name: string; aliases: string[]; artistIds: Partial<Record<KpopSource, string[]>> }[] = [
	{ id: 'a2o-lite', name: 'A2O LITE', aliases: ['A2O LITE'], artistIds: { melon: ['5217450'], bugs: ['14891482'], genie: ['83504429'], flo: ['414956759'], apple: ['6820428729'], spotify: ['0Vkn28k7P4K95Ce3knN0hQ'], tencent: ['24243234'] } },
	{ id: 'hearts2hearts', name: 'Hearts2Hearts', aliases: ['Hearts2Hearts', 'Hearts2Hearts (하츠투하츠)', '하츠투하츠'], artistIds: { melon: ['4096106'], bugs: ['80405039'], genie: ['82779545'], flo: ['411132437'], apple: ['1793698498'], spotify: ['1ZLU77nRzQIaP23mVSYpCQ'], tencent: ['17133544'] } },
	{ id: 'kiiikiii', name: 'KiiiKiii', aliases: ['KiiiKiii', 'KiiiKiii (키키)', '키키'], artistIds: { melon: ['4099078'], bugs: ['20229752'], genie: ['82792175'], flo: ['411220542'], apple: ['1795471746'], spotify: ['63sat2XSMKdwKfqspmYQKP'] } },
	{ id: 'baby-dont-cry', name: 'Baby DONT Cry', aliases: ['Baby DONT Cry', 'Baby DON\'T Cry', 'Baby DONT Cry (베이비돈크라이)', '베이비돈크라이'], artistIds: {} },
	{ id: 'ifeye', name: 'ifeye', aliases: ['ifeye', 'ifeye (이프아이)', '이프아이'], artistIds: {} },
	{ id: 'babymonster', name: 'BABYMONSTER', aliases: ['BABYMONSTER'], artistIds: { melon: ['3619984'], bugs: ['20200163'], genie: ['82262194'], apple: ['1715981813'], spotify: ['1SIocsqdEefUTE6XKGUiVS'] } },
	{ id: 'illit', name: 'ILLIT', aliases: ['ILLIT', '아일릿(ILLIT)'], artistIds: { melon: ['3743525'], bugs: ['80392511'], genie: ['82387391'], flo: ['409158025'], apple: ['1734551937'], spotify: ['36cgvBn0aadzOijnjjwqMN'] } },
	{ id: 'meovv', name: 'MEOVV', aliases: ['MEOVV', 'MEOVV (미야오)'], artistIds: { melon: ['3893541'], bugs: ['80398939'], genie: ['82619556'], apple: ['1765256889'], spotify: ['08hHTBHlv0WRXWlyrsb6Kv'] } },
	{ id: 'triples', name: 'tripleS', aliases: ['tripleS', 'tripleS (트리플에스)'], artistIds: { melon: ['3137294'], bugs: ['20171256'], apple: ['1651595986'], spotify: ['5Z71xE9prhpHrqL5thVMyK'] } },
	{ id: 'aespa', name: 'aespa', aliases: ['aespa', '에스파'], artistIds: { melon: ['2899555'], bugs: ['80347326'] } },
	{ id: 'newjeans', name: 'NewJeans', aliases: ['NewJeans', '뉴진스'], artistIds: { melon: ['3114174'], bugs: ['20164333'] } },
	{ id: 'le-sserafim', name: 'LE SSERAFIM', aliases: ['LE SSERAFIM', 'LE SSERAFIM (르세라핌)', '르세라핌'], artistIds: { melon: ['3092950'] } },
	{ id: 'ive', name: 'IVE', aliases: ['IVE', 'IVE (아이브)', '아이브'], artistIds: { melon: ['3055146'] } },
];
const normalize = (text: string) => text.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
// Exact public credits observed on Billboard Korea. These spellings apply only
// to this source; no parenthesis stripping or solo/subunit substring matching.
const billboardAliases: Partial<Record<KpopGroupId, string[]>> = {
	'a2o-lite': ['A2O LITE(에이투오 라이트)'], hearts2hearts: ['Hearts2Hearts(하츠투하츠)'],
	kiiikiii: ['KiiiKiii(키키)'], illit: ['ILLIT(아일릿)'], meovv: ['MEOVV(미야오)'],
	aespa: ['aespa(에스파)'], newjeans: ['NewJeans(뉴진스)'],
	'le-sserafim': ['LE SSERAFIM(르세라핌)'], ive: ['IVE(아이브)'],
};
export function matchKpopGroups(source: KpopSource, artists: KpopArtist[]): KpopGroupId[] {
	return KPOP_GROUPS.filter(group => artists.some(artist => {
		const name = normalize(artist.name);
		const exactName = group.aliases.some(alias => normalize(alias) === name)
			|| (source === 'billboard' && (billboardAliases[group.id] ?? []).some(alias => normalize(alias) === name))
			|| (group.id === 'a2o-lite' && source === 'genie' && name === 'a2o & a2o lite');
		const knownIds = group.artistIds[source];
		if (exactName && artist.id !== null && knownIds?.length && !knownIds.includes(artist.id)) {
			// Do not silently turn a recognized name with a new ID into "not ranked".
			throw new KpopSourceError({ phase: 'parse', reason: 'identity_unverified', httpStatus: null, retryAfterAt: null, elapsedMs: 0 });
		}
		return exactName && (artist.id === null || !knownIds?.length || knownIds.includes(artist.id));
	})).map(group => group.id);
}
