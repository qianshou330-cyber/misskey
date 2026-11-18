<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->
<template>
<MkModalWindow ref="dialog" :width="370" :height="360" :withCloseButton="false" @closed="emit('closed')">
	<template #header>{{ i18n.ts.smartphone }}</template>
	<div class="_spacer" style="--MI_SPACER-min: 20px; --MI_SPACER-max: 28px;">
		<form class="_gaps_m" @submit.prevent="submit">
			<MkInfo>{{ i18n.ts.accountInfo }}</MkInfo>
			<MkInput v-model="phoneNumber" type="tel" inputmode="numeric" autocomplete="tel" required>
				<template #label>{{ i18n.ts.smartphone }}</template>
			</MkInput>
			<div style="display:flex; gap:8px; align-items:flex-end;">
				<MkInput v-model="smsCode" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="^[0-9]{6}$" required style="flex:1;"><template #label>{{ i18n.ts.code }}</template></MkInput>
				<MkButton type="button" rounded :disabled="sending || cooldown > 0 || !phoneValid" @click="requestCode">{{ cooldown > 0 ? `${cooldown}s` : i18n.ts.send }}</MkButton>
			</div>
			<MkButton type="submit" rounded primary :disabled="saving || !phoneValid || smsCode.length !== 6" style="margin:0 auto;">{{ i18n.ts.ok }}</MkButton>
		</form>
	</div>
</MkModalWindow>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, ref, useTemplateRef } from 'vue';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkInput from '@/components/MkInput.vue';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import * as os from '@/os.js';
import * as config from '@@/js/config.js';
import { i18n } from '@/i18n.js';

const props = defineProps<{ token: string }>();
const emit = defineEmits<{ (ev: 'done'): void; (ev: 'closed'): void }>();
const dialog = useTemplateRef('dialog');
const phoneNumber = ref('');
const smsCode = ref('');
const sending = ref(false);
const saving = ref(false);
const cooldown = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;
const normalizePhone = (value: string): string => value.replace(/[\s-]/g, '').replace(/^\+86/, '');
const phoneValid = computed(() => /^1[3-9]\d{9}$/.test(normalizePhone(phoneNumber.value)));

async function call(path: string, body: Record<string, unknown>, authenticated = true): Promise<void> {
	const res = await window.fetch(`${config.apiUrl}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(authenticated ? { ...body, i: props.token } : body) });
	if (!res.ok) throw new Error('request failed');
}
async function requestCode(): Promise<void> {
	if (sending.value || cooldown.value > 0 || !phoneValid.value) return;
	sending.value = true;
	try {
		await call('signup/request-phone-code', { phoneNumber: normalizePhone(phoneNumber.value) }, false);
		cooldown.value = 60;
		timer = setInterval(() => { cooldown.value -= 1; if (cooldown.value <= 0 && timer) { clearInterval(timer); timer = null; } }, 1000);
		os.alert({ type: 'success', text: i18n.ts.verificationEmailSent });
	} catch { os.alert({ type: 'error', text: i18n.ts.somethingHappened }); }
	finally { sending.value = false; }
}
async function submit(): Promise<void> {
	if (saving.value || !phoneValid.value) return;
	saving.value = true;
	try {
		await call('i/bind-phone', { phoneNumber: normalizePhone(phoneNumber.value), smsCode: smsCode.value });
		emit('done');
		dialog.value?.close();
	} catch { os.alert({ type: 'error', text: i18n.ts.somethingHappened }); }
	finally { saving.value = false; }
}
onBeforeUnmount(() => { if (timer) clearInterval(timer); });
</script>
