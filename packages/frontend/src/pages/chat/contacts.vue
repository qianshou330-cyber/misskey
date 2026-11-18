<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="actions" :leadingActions="leadingActions">
	<div class="_spacer _gaps" style="--MI_SPACER-w: 900px;">
		<MkInfo>{{ i18n.ts._chatPro.chatBlockHint }}</MkInfo>
		<div :class="$style.toolbar"><MkInput v-model="query" type="search" :placeholder="i18n.ts.search" @keydown.enter="search"><template #label>{{ i18n.ts.search }}</template></MkInput><MkButton @click="search">{{ i18n.ts.search }}</MkButton><MkButton primary @click="createGroup">{{ i18n.ts._chatPro.createGroup }}</MkButton></div>
		<MkSelect v-model="selectedGroup" :items="groupOptions"><template #label>{{ i18n.ts._chatPro.groups }}</template></MkSelect>
		<div v-if="currentGroup" class="_buttons"><MkButton @click="renameGroup">{{ i18n.ts.rename }}</MkButton><MkButton danger @click="deleteGroup">{{ i18n.ts.delete }}</MkButton></div>
		<MkLoading v-if="loading"/>
		<MkInfo v-if="failed" warn>{{ i18n.ts._chatPro.loadingFailed }}</MkInfo>
		<div :class="$style.contacts">
			<div v-for="user in visibleUsers" :key="user.id" :class="$style.contact" class="_panel">
				<MkA :to="`/chat/user/${user.id}`" :class="$style.user"><MkAvatar :user="user" :link="false" :class="$style.avatar"/><div><MkUserName :user="user"/><div :class="$style.username">@{{ user.username }}</div></div></MkA>
				<button class="_button" :aria-label="i18n.ts.settings" @click="userMenu(user, $event)"><i class="ti ti-dots"></i></button>
			</div>
		</div>
		<MkInfo v-if="!loading && !visibleUsers.length">{{ i18n.ts._chatPro.noContactResults }}</MkInfo>
		<MkButton v-if="hasMore && selectedGroup === 'all' && !query" :wait="loading" @click="load(true)">{{ i18n.ts.loadMore }}</MkButton>
	</div>
</PageWithHeader>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import * as Misskey from 'misskey-js';
import { chatApi } from '@/utility/chat-api.js';
import type { ChatContactGroup } from '@/utility/chat-api.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { ensureSignin } from '@/i.js';
import { useRouter } from '@/router.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import * as os from '@/os.js';
import MkButton from '@/components/MkButton.vue';
import MkInput from '@/components/MkInput.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkInfo from '@/components/MkInfo.vue';
import type { MenuItem } from '@/types/menu.js';

const $i = ensureSignin();
const router = useRouter();
const groups = ref<ChatContactGroup[]>([]);
const blocked = ref<string[]>([]);
const users = ref<Misskey.entities.UserLite[]>([]);
const query = ref('');
const selectedGroup = ref('all');
const loading = ref(false);
const failed = ref(false);
const hasMore = ref(false);
let followingCursor: string | undefined;
let conversationCursor: string | undefined;
let moreFollowing = true;
let moreConversations = true;

const currentGroup = computed(() => groups.value.find(group => group.id === selectedGroup.value));
const groupOptions = computed(() => [{ value: 'all', label: i18n.ts._chatPro.allContacts }, { value: 'blocked', label: i18n.ts._chatPro.chatBlocked }, ...groups.value.map(group => ({ value: group.id, label: group.name }))]);
const visibleUsers = computed(() => users.value.filter(user => {
	if (user.host != null || user.id === $i.id) return false;
	if (selectedGroup.value === 'blocked' && !blocked.value.includes(user.id)) return false;
	if (currentGroup.value && !currentGroup.value.userIds.includes(user.id)) return false;
	return !query.value || `${user.name ?? ''} ${user.username}`.toLocaleLowerCase().includes(query.value.toLocaleLowerCase());
}).sort((a, b) => (a.name ?? a.username).localeCompare(b.name ?? b.username)));

function mergeUsers(incoming: Misskey.entities.UserLite[]): void {
	const map = new Map(users.value.map(user => [user.id, user]));
	for (const user of incoming) map.set(user.id, user);
	users.value = [...map.values()];
}

async function load(more = false): Promise<void> {
	if (loading.value) return;
	loading.value = true;
	failed.value = false;
	try {
		if (!more) {
			followingCursor = undefined;
			conversationCursor = undefined;
			moreFollowing = true;
			moreConversations = true;
			users.value = [];
			groups.value = await chatApi('chat/contact-groups/list', {});
			blocked.value = [];
			let cursor: string | undefined;
			while (true) {
				const page = await chatApi('chat/blocking/list', { limit: 100, untilId: cursor });
				blocked.value.push(...page.map(item => item.userId));
				if (page.length < 100 || page.at(-1)?.id === cursor) break;
				cursor = page.at(-1)?.id;
			}
			const ids = [...new Set([...blocked.value, ...groups.value.flatMap(group => group.userIds)])];
			for (let index = 0; index < ids.length; index += 100) mergeUsers(await misskeyApi('users/show', { userIds: ids.slice(index, index + 100) }));
		}
		if (moreFollowing) {
			const following = await misskeyApi('users/following', { userId: $i.id, limit: 100, untilId: followingCursor });
			mergeUsers(following.flatMap(item => item.followee ? [item.followee] : []));
			moreFollowing = following.length === 100;
			followingCursor = following.at(-1)?.id;
		}
		if (moreConversations) {
			const conversations = await chatApi('chat/conversations', { limit: 100, untilId: conversationCursor });
			mergeUsers(conversations.map(item => item.user));
			moreConversations = conversations.length === 100;
			conversationCursor = conversations.at(-1)?.lastMessage.id;
		}
		hasMore.value = moreFollowing || moreConversations;
	} catch { failed.value = true; } finally { loading.value = false; }
}

async function search(): Promise<void> {
	if (!query.value.trim()) return;
	try { mergeUsers(await misskeyApi('users/search-by-username-and-host', { username: query.value.trim(), host: '.', limit: 30, detail: false })); } catch { failed.value = true; }
}

async function createGroup(): Promise<void> {
	const result = await os.inputText({ title: i18n.ts._chatPro.createGroup, minLength: 1, maxLength: 100 });
	if (result.canceled) return;
	try { groups.value.push(await chatApi('chat/contact-groups/create', { name: result.result })); } catch { await os.alert({ type: 'error', text: i18n.ts.somethingHappened }); }
}

async function renameGroup(): Promise<void> {
	const group = currentGroup.value;
	if (!group) return;
	const result = await os.inputText({ title: i18n.ts.rename, default: group.name, minLength: 1, maxLength: 100 });
	if (result.canceled) return;
	try { Object.assign(group, await chatApi('chat/contact-groups/update', { groupId: group.id, name: result.result })); } catch { await os.alert({ type: 'error', text: i18n.ts.somethingHappened }); }
}

async function deleteGroup(): Promise<void> {
	const group = currentGroup.value;
	if (!group || (await os.confirm({ type: 'warning', text: i18n.ts._chatPro.confirmGroupDelete })).canceled) return;
	try { await chatApi('chat/contact-groups/delete', { groupId: group.id }); groups.value = groups.value.filter(item => item.id !== group.id); selectedGroup.value = 'all'; } catch { await os.alert({ type: 'error', text: i18n.ts.somethingHappened }); }
}

function userMenu(user: Misskey.entities.UserLite, event: PointerEvent): void {
	const menu: MenuItem[] = groups.value.map(group => ({ text: `${group.userIds.includes(user.id) ? i18n.ts._chatPro.removeFromGroup : i18n.ts._chatPro.addToGroup} · ${group.name}`, icon: 'ti ti-users', action: async () => {
		try {
			const remove = group.userIds.includes(user.id);
			await chatApi(remove ? 'chat/contact-groups/remove-user' : 'chat/contact-groups/add-user', { groupId: group.id, userId: user.id });
			group.userIds = remove ? group.userIds.filter(id => id !== user.id) : [...group.userIds, user.id];
		} catch { await os.alert({ type: 'error', text: i18n.ts.somethingHappened }); }
	} }));
	menu.push({ text: blocked.value.includes(user.id) ? i18n.ts._chatPro.chatUnblock : i18n.ts._chatPro.chatBlock, icon: 'ti ti-ban', danger: !blocked.value.includes(user.id), action: async () => {
		if ((await os.confirm({ type: 'warning', text: i18n.ts._chatPro.chatBlockHint })).canceled) return;
		try { const remove = blocked.value.includes(user.id); await chatApi(remove ? 'chat/blocking/delete' : 'chat/blocking/create', { userId: user.id }); blocked.value = remove ? blocked.value.filter(id => id !== user.id) : [...blocked.value, user.id]; } catch { await os.alert({ type: 'error', text: i18n.ts.somethingHappened }); }
	} });
	os.popupMenu(menu, event.currentTarget ?? event.target);
}

const leadingActions = computed(() => [{ icon: 'ti ti-arrow-left', text: i18n.ts.goBack, handler: () => router.push('/chat') }]);
const actions = computed(() => [{ icon: 'ti ti-refresh', text: i18n.ts.reload, handler: () => { void load(); } }]);
onMounted(() => { void load(); });
definePage(() => ({ title: i18n.ts._chatPro.contacts, icon: 'ti ti-users' }));
</script>

<style module lang="scss">
.toolbar { display: flex; align-items: end; gap: 8px; flex-wrap: wrap; }
.contacts { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
.contact { display: flex; align-items: center; gap: 12px; padding: 14px; border-radius: 12px; }
.user { display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1; }
.avatar { width: 44px; height: 44px; flex-shrink: 0; }
.username { font-size: 80%; opacity: .7; }
</style>
