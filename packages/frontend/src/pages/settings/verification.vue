<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
	<div class="_spacer" style="--MI_SPACER-w: 700px; --MI_SPACER-min: 16px; --MI_SPACER-max: 32px;">
		<div class="_gaps_m">
			<MkInfo>{{ i18n.ts._verification.description }}</MkInfo>
			<MkInfo v-if="status?.status === 'approved'" class="approved">
				{{ i18n.ts._verification.approved }}
				<span v-if="status.approvedType">{{ i18n.ts._verification.type }}: {{ typeLabel(status.approvedType) }}</span>
			</MkInfo>
			<MkInfo v-else-if="status?.status === 'pending'">{{ i18n.ts._verification.pending }}</MkInfo>
			<MkInfo v-else-if="status?.status === 'rejected'" warn>
				{{ i18n.ts._verification.rejected }}
				<span v-if="status.reviewNote ?? status.reviewReason">{{ i18n.ts._verification.reviewNote }}: {{ status.reviewNote ?? status.reviewReason }}</span>
			</MkInfo>
			<MkInfo v-else-if="status?.status === 'revoked'" warn>
				{{ i18n.ts._verification.revoked }}
				<span v-if="status.reviewNote ?? status.reviewReason">{{ i18n.ts._verification.reviewNote }}: {{ status.reviewNote ?? status.reviewReason }}</span>
			</MkInfo>

			<div class="_panel _gaps_m" :class="$style.form">
				<MkSelect v-model="form.type" :items="typeItems" :disabled="busy || isLocked">
					<template #label>{{ i18n.ts._verification.type }}</template>
					<template #caption>{{ i18n.ts._verification.typeDescription }}</template>
				</MkSelect>

				<MkTextarea v-model="form.description" :disabled="busy || isLocked" tall>
					<template #label>{{ i18n.ts._verification.descriptionLabel }}</template>
					<template #caption>
						{{ i18n.ts._verification.descriptionCaption }} ({{ descriptionLength }} / {{ MAX_DESCRIPTION_LENGTH }})
					</template>
				</MkTextarea>
				<MkInfo v-if="descriptionLength > MAX_DESCRIPTION_LENGTH" warn>
					{{ i18n.tsx._dialog.charactersExceeded({ current: descriptionLength, max: MAX_DESCRIPTION_LENGTH }) }}
				</MkInfo>

				<MkInput v-model="form.contact" :disabled="busy || isLocked">
					<template #label>{{ i18n.ts._verification.contact }}</template>
					<template #caption>
						{{ i18n.ts._verification.contactCaption }} ({{ contactLength }} / {{ MAX_CONTACT_LENGTH }})
					</template>
				</MkInput>
				<MkInfo v-if="contactLength > MAX_CONTACT_LENGTH" warn>
					{{ i18n.tsx._dialog.charactersExceeded({ current: contactLength, max: MAX_CONTACT_LENGTH }) }}
				</MkInfo>

				<div class="_gaps_s">
					<div :class="$style.fileRow">
						<div :class="$style.fileText">
							<div :class="$style.fileLabel">{{ i18n.ts._verification.frontDocument }}</div>
							<div :class="$style.fileName">{{ files.front?.name ?? (hasDocument('front') ? i18n.ts._verification.documentSubmitted : i18n.ts._verification.noFile) }}</div>
						</div>
						<MkButton inline :disabled="busy || isLocked" @click="chooseFile('front')">{{ i18n.ts._verification.chooseFile }}</MkButton>
					</div>
					<div :class="$style.fileRow">
						<div :class="$style.fileText">
							<div :class="$style.fileLabel">{{ i18n.ts._verification.backDocument }}</div>
							<div :class="$style.fileName">{{ files.back?.name ?? (hasDocument('back') ? i18n.ts._verification.documentSubmitted : i18n.ts._verification.noFile) }}</div>
						</div>
						<MkButton inline :disabled="busy || isLocked" @click="chooseFile('back')">{{ i18n.ts._verification.chooseFile }}</MkButton>
					</div>
				</div>

			<MkSwitch v-model="form.consent" :disabled="busy || isLocked">
				{{ i18n.ts._verification.consent }}
				<template #caption>{{ i18n.ts._verification.consentCaption }}</template>
			</MkSwitch>

			<div class="_buttons">
				<MkButton primary :disabled="busy || isLocked || !canSubmit" @click="submit">
					<i class="ti ti-send"></i> {{ busy ? i18n.ts._verification.submitting : i18n.ts._verification.submit }}
				</MkButton>
				<MkButton v-if="status?.status === 'pending' || status?.status === 'approved'" danger :disabled="busy" @click="withdraw">
					<i class="ti ti-x"></i> {{ i18n.ts._verification.withdraw }}
				</MkButton>
			</div>
			<div :class="$style.privacyNote">{{ i18n.ts._verification.privacyNote }}</div>
			</div>
		</div>
	</div>
</template>

<script lang="ts" setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { apiUrl } from '@@/js/config.js';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkInput from '@/components/MkInput.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import * as os from '@/os.js';
import { ensureSignin } from '@/i.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { misskeyApi } from '@/utility/misskey-api.js';

const $i = ensureSignin();
const CONSENT_VERSION = '2026-09-30';
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_CONTACT_LENGTH = 512;

type VerificationType = 'actor' | 'singer' | 'model' | 'contentCreator' | 'novelist' | 'other';
type VerificationStatusValue = 'pending' | 'approved' | 'rejected' | 'revoked';

interface VerificationApplication {
	id: string;
	status: VerificationStatusValue;
	requestedType?: VerificationType | null;
	approvedType?: VerificationType | null;
	description?: string | null;
	contact?: string | null;
	reviewNote?: string | null;
	reviewReason?: string | null;
	submittedAt?: string | null;
	reviewedAt?: string | null;
	documents?: Array<{ side: 'front' | 'back' }>;
}

interface VerificationShowResponse {
	application?: VerificationApplication | null;
	status?: VerificationStatusValue | null;
	id?: string;
	requestedType?: VerificationType | null;
	approvedType?: VerificationType | null;
	description?: string | null;
	contact?: string | null;
	reviewNote?: string | null;
	reviewReason?: string | null;
	submittedAt?: string | null;
	reviewedAt?: string | null;
	documents?: Array<{ side: 'front' | 'back' }>;
}

interface SelectedFile {
	file: File;
	name: string;
}

type VerificationApi = <T>(endpoint: string, data?: Record<string, unknown>) => Promise<T>;
const api = misskeyApi as unknown as VerificationApi;

const status = ref<VerificationApplication | null>(null);
const busy = ref(false);
const files = reactive<{ front: SelectedFile | null; back: SelectedFile | null }>({
	front: null,
	back: null,
});
const form = reactive<{
	type: VerificationType;
	description: string;
	contact: string;
	consent: boolean;
}>({
	type: 'actor',
	description: '',
	contact: '',
	consent: false,
});

const typeItems = computed(() => [
	{ label: i18n.ts._verification._type.actor, value: 'actor' as const },
	{ label: i18n.ts._verification._type.singer, value: 'singer' as const },
	{ label: i18n.ts._verification._type.model, value: 'model' as const },
	{ label: i18n.ts._verification._type.contentCreator, value: 'contentCreator' as const },
	{ label: i18n.ts._verification._type.novelist, value: 'novelist' as const },
	{ label: i18n.ts._verification._type.other, value: 'other' as const },
]);

const isLocked = computed(() => status.value?.status === 'pending' || status.value?.status === 'approved');
const descriptionLength = computed(() => [...form.description.trim()].length);
const contactLength = computed(() => [...form.contact.trim()].length);
const canSubmit = computed(() => {
	const description = form.description.trim();
	const contact = form.contact.trim();
	return [...description].length > 0
		&& [...description].length <= MAX_DESCRIPTION_LENGTH
		&& [...contact].length > 0
		&& [...contact].length <= MAX_CONTACT_LENGTH
		&& form.consent
		&& files.front != null
		&& files.back != null;
});

function errorMessage(error: unknown, fallback: string): string {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === 'object' && error != null && 'message' in error && typeof error.message === 'string' && error.message) return error.message;
	return fallback;
}

function typeLabel(type: VerificationType): string {
	return i18n.ts._verification._type[type];
}

function hasDocument(side: 'front' | 'back'): boolean {
	return status.value?.documents?.some(document => document.side === side) ?? false;
}

function normalizeStatus(response: VerificationShowResponse | null): VerificationApplication | null {
	if (response == null) return null;
	if (response.application !== undefined) return response.application;
	if (response.status == null || response.id == null) return null;
	return {
		id: response.id,
		status: response.status,
		requestedType: response.requestedType,
		approvedType: response.approvedType,
		description: response.description,
		contact: response.contact,
		reviewNote: response.reviewNote,
		reviewReason: response.reviewReason,
		submittedAt: response.submittedAt,
		reviewedAt: response.reviewedAt,
		documents: response.documents,
	};
}

async function loadStatus() {
	const response = await api<VerificationShowResponse | null>('verification/show');
	status.value = normalizeStatus(response);
	if (status.value != null) {
		form.type = status.value.requestedType ?? status.value.approvedType ?? form.type;
		form.description = status.value.description ?? '';
		form.contact = status.value.contact ?? '';
	}
}

async function chooseFile(side: 'front' | 'back') {
	if (busy.value || isLocked.value) return;
	const picked = (await os.chooseFileFromPc({ multiple: false }))[0];
	if (busy.value || isLocked.value) return;
	if (picked == null) return;
	if (!['image/jpeg', 'image/png', 'image/webp'].includes(picked.type)) {
		await os.alert({ type: 'error', title: i18n.ts._verification.uploadFailed, text: i18n.ts._verification.invalidFileType });
		return;
	}
	if (picked.size > MAX_FILE_SIZE) {
		await os.alert({ type: 'error', title: i18n.ts._verification.uploadFailed, text: i18n.ts._verification.fileTooLarge });
		return;
	}
	files[side] = { file: picked, name: picked.name };
}

async function uploadDocument(file: File, side: 'front' | 'back'): Promise<{ id: string }> {
	const formData = new FormData();
	formData.append('i', $i.token);
	formData.append('side', side);
	formData.append('file', file, file.name);
	const response = await window.fetch(`${apiUrl}/verification/upload`, {
		method: 'POST',
		body: formData,
		credentials: 'omit',
	});
	const body = await response.json().catch(() => null);
	if (!response.ok) {
		throw new Error(body?.error?.message ?? body?.error?.code ?? i18n.ts._verification.uploadFailed);
	}
	if (typeof body?.id !== 'string' || body.id.length === 0) throw new Error(i18n.ts._verification.uploadFailed);
	return body as { id: string };
}

async function submit() {
	if (busy.value || isLocked.value || !canSubmit.value || files.front == null || files.back == null) return;
	const selectedFront = files.front;
	const selectedBack = files.back;
	const type = form.type;
	const description = form.description.trim();
	const contact = form.contact.trim();
	busy.value = true;
	try {
		const [frontResult, backResult] = await Promise.allSettled([
			uploadDocument(selectedFront.file, 'front'),
			uploadDocument(selectedBack.file, 'back'),
		]);
		if (frontResult.status === 'rejected') throw frontResult.reason;
		if (backResult.status === 'rejected') throw backResult.reason;
		const application = await api<{ id: string; status: 'pending' }>('verification/create', {
			documentIds: [frontResult.value.id, backResult.value.id],
			type,
			description,
			contact,
			consentVersion: CONSENT_VERSION,
		});
		status.value = { ...application, requestedType: type, description, contact, documents: [{ side: 'front' }, { side: 'back' }] };
		files.front = null;
		files.back = null;
		form.consent = false;
		let refreshed = true;
		try {
			await loadStatus();
		} catch {
			refreshed = false;
		}
		await os.alert({
			type: refreshed ? 'success' : 'warning',
			title: i18n.ts._verification.submitted,
			text: refreshed ? i18n.ts._verification.submittedDescription : `${i18n.ts._verification.submittedDescription}: ${i18n.ts._verification.loadFailed}`,
		});
	} catch (error) {
		const message = errorMessage(error, i18n.ts._verification.submitFailed);
		await os.alert({ type: 'error', title: i18n.ts._verification.submitFailed, text: message });
	} finally {
		busy.value = false;
	}
}

async function withdraw() {
	if (busy.value || (status.value?.status !== 'pending' && status.value?.status !== 'approved')) return;
	busy.value = true;
	try {
		const result = await os.confirm({ type: 'warning', text: i18n.ts._verification.withdrawConfirm });
		if (result.canceled) return;
		await api('verification/withdraw');
		status.value = { ...status.value!, status: 'revoked', documents: [], reviewNote: null, reviewReason: null };
		let refreshed = true;
		try {
			await loadStatus();
		} catch {
			refreshed = false;
		}
		await os.alert({ type: refreshed ? 'success' : 'warning', text: refreshed ? i18n.ts._verification.withdrawn : `${i18n.ts._verification.withdrawn}: ${i18n.ts._verification.loadFailed}` });
	} catch (error) {
		await os.alert({ type: 'error', title: i18n.ts._verification.withdrawFailed, text: errorMessage(error, i18n.ts._verification.withdrawFailed) });
	} finally {
		busy.value = false;
	}
}

onMounted(() => {
	loadStatus().catch(() => {
		// Keep the form usable if the status endpoint is temporarily unavailable.
	});
});

definePage(() => ({
	title: i18n.ts._verification.title,
	icon: 'ti ti-badge',
}));
</script>

<style lang="scss" module>
.form {
	padding: 20px;
}

.fileRow {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 12px;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: var(--MI-radius);
}

.fileText {
	flex: 1;
	min-width: 0;
}

.fileLabel {
	font-weight: 600;
}

.fileName {
	overflow: hidden;
	color: var(--MI_THEME-fgTransparent);
	text-overflow: ellipsis;
	white-space: nowrap;
}

.privacyNote {
	font-size: 85%;
	color: var(--MI_THEME-fgTransparent);
}

@media (max-width: 500px) {
	.fileRow {
		flex-wrap: wrap;
	}

	.fileText {
		flex-basis: calc(100% - 112px);
	}
}
</style>
