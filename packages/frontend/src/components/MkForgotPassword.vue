<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialog"
	:width="370"
	:height="400"
	@close="dialog?.close()"
	@closed="emit('closed')"
>
	<template #header>{{ i18n.ts.forgotPassword }}</template>

	<div class="_spacer" style="--MI_SPACER-min: 20px; --MI_SPACER-max: 28px;">
		<form v-if="instance.enableEmail" @submit.prevent="onSubmit">
			<div class="_gaps_m">
				<MkInput v-model="username" type="text" pattern="^[a-zA-Z0-9_]+$" :spellcheck="false" autofocus required>
					<template #label>{{ i18n.ts.username }}</template>
					<template #prefix>@</template>
				</MkInput>

				<MkInput v-model="email" type="email" :spellcheck="false" required>
					<template #label>{{ i18n.ts.emailAddress }}</template>
					<template #caption>{{ i18n.ts._forgotPassword.enterEmail }}</template>
				</MkInput>

				<MkButton type="submit" rounded :disabled="processing" primary style="margin: 0 auto;">{{ i18n.ts.send }}</MkButton>

				<MkInfo>{{ i18n.ts._forgotPassword.ifNoEmail }}</MkInfo>
			</div>
		</form>
		<div v-else>
			{{ i18n.ts._forgotPassword.contactAdmin }}
		</div>
		<div class="_gaps_m" style="margin-top:24px;">
			<MkInput v-model="phoneNumber" type="tel" inputmode="numeric" autocomplete="tel">
				<template #label>{{ '手机号找回密码' }}</template>
			</MkInput>
			<div style="display:flex; gap:8px; align-items:flex-end;">
				<MkInput v-model="smsCode" type="text" inputmode="numeric" autocomplete="one-time-code" style="flex:1;"><template #label>{{ '短信验证码' }}</template></MkInput>
				<MkButton type="button" rounded :disabled="sending || cooldown > 0 || !phoneValid" @click="requestCode">{{ cooldown > 0 ? `${cooldown}s` : '获取验证码' }}</MkButton>
			</div>
			<MkInput v-model="newPassword" type="password" autocomplete="new-password"><template #label>{{ i18n.ts.newPassword }}</template></MkInput>
			<MkButton rounded primary :disabled="processing || !phoneValid || smsCode.length !== 6 || newPassword.length < 8" @click="resetByPhone">{{ i18n.ts.reset }}</MkButton>
		</div>
	</div>
</MkModalWindow>
</template>

<script lang="ts" setup>
import { ref, useTemplateRef, computed, onBeforeUnmount } from 'vue';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkButton from '@/components/MkButton.vue';
import MkInput from '@/components/MkInput.vue';
import MkInfo from '@/components/MkInfo.vue';
import * as os from '@/os.js';
import { instance } from '@/instance.js';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';

const emit = defineEmits<{
	(ev: 'done'): void;
	(ev: 'closed'): void;
}>();

const dialog = useTemplateRef('dialog');

const username = ref('');
const email = ref('');
const processing = ref(false);
const phoneNumber = ref('');
const smsCode = ref('');
const newPassword = ref('');
const sending = ref(false);
const cooldown = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;
const normalizePhone = (value: string): string => value.replace(/[\s-]/g, '').replace(/^\+86/, '');
const phoneValid = computed(() => /^1[3-9]\d{9}$/.test(normalizePhone(phoneNumber.value)));

async function requestCode(): Promise<void> {
	if (sending.value || cooldown.value > 0 || !phoneValid.value) return;
	sending.value = true;
	try {
		await misskeyApi('request-reset-password-phone' as any, { phoneNumber: normalizePhone(phoneNumber.value), username: username.value || undefined });
		cooldown.value = 60;
		timer = setInterval(() => { cooldown.value -= 1; if (cooldown.value <= 0 && timer) { clearInterval(timer); timer = null; } }, 1000);
		os.alert({ type: 'success', text: '验证码已发送，请查收短信' });
	} catch {
		os.alert({ type: 'error', text: '验证码发送失败，请稍后重试' });
	} finally { sending.value = false; }
}

async function resetByPhone(): Promise<void> {
	if (processing.value || !phoneValid.value) return;
	processing.value = true;
	try {
		await misskeyApi('reset-password-phone' as any, { phoneNumber: normalizePhone(phoneNumber.value), smsCode: smsCode.value, newPassword: newPassword.value });
		os.alert({ type: 'success', text: '密码重置成功' });
		emit('done');
		dialog.value?.close();
	} catch {
		os.alert({ type: 'error', text: '密码重置失败，请确认验证码正确' });
	} finally { processing.value = false; }
}

onBeforeUnmount(() => { if (timer) clearInterval(timer); });

async function onSubmit() {
	processing.value = true;
	await os.apiWithDialog('request-reset-password', {
		username: username.value,
		email: email.value,
	});
	emit('done');
	dialog.value?.close();
}
</script>
