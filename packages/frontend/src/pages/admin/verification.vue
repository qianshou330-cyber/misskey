<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions">
	<div class="_spacer" style="--MI_SPACER-w: 1000px; --MI_SPACER-min: 16px; --MI_SPACER-max: 32px;">
		<div class="_gaps">
			<MkInfo>{{ i18n.ts._verification.adminDescription }}</MkInfo>
			<MkInfo v-if="!iAmAdmin" warn>{{ i18n.ts._verification.adminOnly }}</MkInfo>

			<MkSelect v-model="statusFilter" :items="statusItems" :disabled="loading || reviewBusy" @update:modelValue="onStatusFilterChanged">
				<template #label>{{ i18n.ts._verification.statusFilter }}</template>
			</MkSelect>

			<MkLoading v-if="loading" />
			<MkInfo v-else-if="requests.length === 0">{{ i18n.ts._verification.noRequests }}</MkInfo>
			<div v-else :class="$style.requestList" class="_gaps_s">
				<button
					v-for="request in requests"
					:key="request.id"
					class="_panel _button"
					:class="[$style.request, { [$style.requestSelected]: selected?.id === request.id }]"
					:disabled="reviewBusy"
					@click="selectRequest(request)"
				>
					<MkAvatar v-if="request.user" :user="request.user" class="avatar" />
					<div :class="$style.requestBody">
						<div :class="$style.requestTitle">
							<strong>{{ request.user?.name ?? request.user?.username ?? request.userId }}</strong>
							<span :class="$style.requestStatus">{{ statusLabel(request.status) }}</span>
						</div>
						<div :class="$style.requestMeta">
							<span>{{ i18n.ts._verification.requestedType }}: {{ typeLabel(request.requestedType) }}</span>
							<span>{{ formatDate(request.submittedAt) }}</span>
						</div>
					</div>
					<i class="ti ti-chevron-right" :class="$style.chevron"></i>
				</button>
			</div>
			<MkButton v-if="hasMore && !loading" :disabled="reviewBusy" @click="loadMore">{{ i18n.ts.loadMore }}</MkButton>

			<section v-if="selected" class="_panel _gaps_m" :class="$style.detail">
				<div :class="$style.detailHeader">
					<div>
						<h2 :class="$style.detailTitle">{{ i18n.ts._verification.applicant }}</h2>
						<MkA v-if="selected.user" :to="`/@${selected.user.username}`" class="_link">
							{{ selected.user.name ?? selected.user.username }} @{{ selected.user.username }}
						</MkA>
					</div>
						<MkButton inline :disabled="reviewBusy" @click="closeSelection"><i class="ti ti-x"></i> {{ i18n.ts.close }}</MkButton>
				</div>

				<div :class="$style.detailMeta">
					<div><b>{{ i18n.ts._verification.statusFilter }}</b> {{ statusLabel(selected.status) }}</div>
					<div><b>{{ i18n.ts._verification.submittedAt }}</b> {{ formatDate(selected.submittedAt) }}</div>
				</div>

				<MkSelect v-model="reviewType" :items="typeItems" :disabled="!iAmAdmin || selected.status !== 'pending' || reviewBusy">
					<template #label>{{ i18n.ts._verification.approvedType }}</template>
				</MkSelect>

				<MkTextarea v-if="selected.description" :modelValue="selected.description" readonly tall>
					<template #label>{{ i18n.ts._verification.descriptionLabel }}</template>
				</MkTextarea>
				<MkInput v-if="selected.contact" :modelValue="selected.contact" readonly>
					<template #label>{{ i18n.ts._verification.contact }}</template>
				</MkInput>
				<MkInfo v-if="selected.reviewNote ?? selected.reviewReason" warn>
					{{ i18n.ts._verification.reviewNote }}: {{ selected.reviewNote ?? selected.reviewReason }}
				</MkInfo>

				<div :class="$style.documents">
					<div v-for="document in selected.documents" :key="document.id" :class="$style.document">
						<div :class="$style.documentLabel">{{ document.side === 'back' ? i18n.ts._verification.backDocument : i18n.ts._verification.frontDocument }}</div>
						<div :class="$style.imageBox">
							<img v-if="document.url" :src="document.url" :alt="document.fileName ?? ''" />
							<span v-else-if="document.loading">{{ i18n.ts.loading }}</span>
							<span v-else>{{ i18n.ts._verification.documentUnavailable }}</span>
						</div>
					</div>
				</div>

				<div v-if="iAmAdmin && selected.status === 'pending'" class="_buttons">
					<MkButton primary :disabled="reviewBusy" @click="approve"><i class="ti ti-check"></i> {{ i18n.ts._verification.approve }}</MkButton>
					<MkButton danger :disabled="reviewBusy" @click="reject"><i class="ti ti-x"></i> {{ i18n.ts._verification.reject }}</MkButton>
				</div>
				<div v-else-if="iAmAdmin && selected.status === 'approved'" class="_buttons">
					<MkButton danger :disabled="reviewBusy" @click="revoke"><i class="ti ti-shield-off"></i> {{ i18n.ts._verification.revoke }}</MkButton>
				</div>
			</section>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';
import * as Misskey from 'misskey-js';
import MkAvatar from '@/components/global/MkAvatar.vue';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkInput from '@/components/MkInput.vue';
import MkLoading from '@/pages/_loading_.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import * as os from '@/os.js';
import { iAmAdmin } from '@/i.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { misskeyApi } from '@/utility/misskey-api.js';

type VerificationType = 'actor' | 'singer' | 'model' | 'contentCreator' | 'novelist' | 'other';
type VerificationStatusValue = 'pending' | 'approved' | 'rejected' | 'revoked';
type StatusFilter = 'all' | VerificationStatusValue;

interface VerificationDocument {
	id: string;
	side: 'front' | 'back';
	contentType?: string | null;
	fileName?: string | null;
	url?: string | null;
	loading?: boolean;
}

interface VerificationRequest {
	id: string;
	userId: string;
	status: VerificationStatusValue;
	requestedType: VerificationType;
	approvedType?: VerificationType | null;
	description?: string | null;
	contact?: string | null;
	submittedAt: string;
	reviewNote?: string | null;
	reviewReason?: string | null;
	user?: Misskey.entities.User;
	documents: VerificationDocument[];
}

type AdminApi = <T>(endpoint: string, data?: Record<string, unknown>) => Promise<T>;
const api = misskeyApi as unknown as AdminApi;

const loading = ref(true);
const hasMore = ref(false);
const requests = ref<VerificationRequest[]>([]);
const selected = ref<VerificationRequest | null>(null);
const reviewType = ref<VerificationType>('actor');
const statusFilter = ref<StatusFilter>('pending');
const reviewBusy = ref(false);
let selectionVersion = 0;
let requestVersion = 0;

const statusItems = computed(() => [
	{ label: i18n.ts._verification.allStatuses, value: 'all' as const },
	{ label: i18n.ts._verification.pending, value: 'pending' as const },
	{ label: i18n.ts._verification.approved, value: 'approved' as const },
	{ label: i18n.ts._verification.rejected, value: 'rejected' as const },
	{ label: i18n.ts._verification.revoked, value: 'revoked' as const },
]);

const typeItems = computed(() => [
	{ label: i18n.ts._verification._type.actor, value: 'actor' as const },
	{ label: i18n.ts._verification._type.singer, value: 'singer' as const },
	{ label: i18n.ts._verification._type.model, value: 'model' as const },
	{ label: i18n.ts._verification._type.contentCreator, value: 'contentCreator' as const },
	{ label: i18n.ts._verification._type.novelist, value: 'novelist' as const },
	{ label: i18n.ts._verification._type.other, value: 'other' as const },
]);

function typeLabel(type: VerificationType | null | undefined): string {
	return type == null ? i18n.ts.none : i18n.ts._verification._type[type];
}

function statusLabel(status: VerificationStatusValue): string {
	return i18n.ts._verification[status];
}

function formatDate(value: string | null | undefined): string {
	return value == null ? i18n.ts.none : new Date(value).toLocaleString();
}

function errorMessage(error: unknown, fallback: string): string {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === 'object' && error != null && 'message' in error && typeof error.message === 'string' && error.message) return error.message;
	return fallback;
}

function normalizeRequest(row: VerificationRequest & { applicationId?: string; verificationType?: VerificationType }): VerificationRequest {
	return {
		...row,
		id: row.id ?? row.applicationId!,
		requestedType: row.requestedType ?? row.verificationType ?? 'other',
		documents: row.documents ?? [],
	};
}

async function loadRequests(append = false, showError = true): Promise<boolean> {
	if (append && (loading.value || reviewBusy.value)) return false;
	const currentRequestVersion = ++requestVersion;
	const currentFilter = statusFilter.value;
	loading.value = true;
	try {
		const params: Record<string, unknown> = { limit: 100, offset: append ? requests.value.length : 0 };
		params.status = currentFilter;
		const rows = await api<Array<VerificationRequest & { applicationId?: string; verificationType?: VerificationType }>>('admin/verification/list', params);
		const page = await Promise.all(rows.map(async row => {
			const request = normalizeRequest(row);
			try {
				request.user = await misskeyApi('users/show', { userId: request.userId });
			} catch {
				// Keep the row visible when the account was removed during review.
			}
			return request;
		}));
		if (currentRequestVersion !== requestVersion) return false;
		requests.value = append ? [...requests.value, ...page] : page;
		hasMore.value = rows.length === 100;
		if (selected.value != null && !requests.value.some(request => request.id === selected.value?.id)) {
			closeSelection();
		}
		return true;
	} catch (error) {
		if (currentRequestVersion !== requestVersion) return false;
		if (showError) await os.alert({ type: 'error', title: i18n.ts._verification.loadFailed, text: errorMessage(error, i18n.ts._verification.loadFailed) });
		return false;
	} finally {
		if (currentRequestVersion === requestVersion) loading.value = false;
	}
}

async function loadMore() {
	if (!iAmAdmin || loading.value || reviewBusy.value) return;
	await loadRequests(true);
}

function onStatusFilterChanged() {
	if (!iAmAdmin || reviewBusy.value) return;
	selectionVersion++;
	selected.value = null;
	requests.value = [];
	hasMore.value = false;
	void loadRequests();
}

function closeSelection() {
	selectionVersion++;
	selected.value = null;
}

function normalizeDocuments(detail: Record<string, any>): VerificationDocument[] {
	if (Array.isArray(detail.documents)) {
		return detail.documents.map((document, index) => typeof document === 'string' ? {
			id: document,
			side: index === 0 ? 'front' : 'back',
		} : {
			id: document.id ?? document.documentId,
			side: document.side === 'back' ? 'back' : 'front',
			contentType: document.contentType ?? document.mime,
			fileName: document.fileName ?? document.name,
		});
	}
	const documents: VerificationDocument[] = [];
	if (detail.front != null) {
		const id = detail.front.id ?? detail.front.documentId;
		if (id != null) documents.push({ id, side: 'front', contentType: detail.front.contentType ?? detail.front.mime, fileName: detail.front.fileName });
	}
	if (detail.back != null) {
		const id = detail.back.id ?? detail.back.documentId;
		if (id != null) documents.push({ id, side: 'back', contentType: detail.back.contentType ?? detail.back.mime, fileName: detail.back.fileName });
	}
	return documents;
}

async function selectRequest(request: VerificationRequest) {
	if (reviewBusy.value) return;
	const version = ++selectionVersion;
	selected.value = { ...request, documents: [] };
	reviewType.value = request.approvedType ?? request.requestedType;
	try {
		const detail = await api<Record<string, any>>('admin/verification/show', { applicationId: request.id });
		if (version !== selectionVersion) return;
		const merged = normalizeRequest({ ...request, ...detail, documents: normalizeDocuments(detail).map(document => ({ ...document, loading: true })) });
		selected.value = merged;
		reviewType.value = merged.approvedType ?? merged.requestedType;
		await Promise.all(merged.documents.map(async document => {
			if (version !== selectionVersion) return;
			try {
				const data = await api<{ contentType?: string; mime?: string; fileName?: string; data: string }>('admin/verification/document', {
					applicationId: merged.id,
					documentId: document.id,
				});
				if (version !== selectionVersion) return;
				const reactiveDocument = selected.value?.documents.find(current => current.id === document.id);
				if (reactiveDocument == null) return;
				reactiveDocument.contentType = data.contentType ?? data.mime;
				reactiveDocument.fileName = data.fileName ?? reactiveDocument.fileName;
				reactiveDocument.url = `data:${reactiveDocument.contentType ?? 'application/octet-stream'};base64,${data.data}`;
				reactiveDocument.loading = false;
			} catch {
				if (version !== selectionVersion) return;
				const reactiveDocument = selected.value?.documents.find(current => current.id === document.id);
				if (reactiveDocument != null) reactiveDocument.loading = false;
			}
		}));
	} catch (error) {
		if (version !== selectionVersion) return;
		await os.alert({ type: 'error', title: i18n.ts._verification.loadFailed, text: errorMessage(error, i18n.ts._verification.loadFailed) });
	}
}

async function approve() {
	if (!iAmAdmin || reviewBusy.value || selected.value == null || selected.value.status !== 'pending') return;
	const applicationId = selected.value.id;
	const approvedType = reviewType.value;
	reviewBusy.value = true;
	try {
		const result = await os.confirm({ type: 'warning', text: i18n.ts._verification.approveConfirm });
		if (result.canceled) return;
		await review('approve', null, applicationId, approvedType);
	} finally {
		reviewBusy.value = false;
	}
}

async function reject() {
	if (!iAmAdmin || reviewBusy.value || selected.value == null || selected.value.status !== 'pending') return;
	const applicationId = selected.value.id;
	reviewBusy.value = true;
	try {
		const result = await os.inputText({ title: i18n.ts._verification.rejectTitle, text: i18n.ts._verification.rejectPrompt });
		if (result.canceled) return;
		await review('reject', result.result?.trim() || null, applicationId);
	} finally {
		reviewBusy.value = false;
	}
}

async function revoke() {
	if (!iAmAdmin || reviewBusy.value || selected.value == null || selected.value.status !== 'approved') return;
	const applicationId = selected.value.id;
	reviewBusy.value = true;
	try {
		const confirm = await os.confirm({ type: 'warning', text: i18n.ts._verification.revokeConfirm });
		if (confirm.canceled) return;
		const result = await os.inputText({ title: i18n.ts._verification.revokeTitle, text: i18n.ts._verification.revokePrompt });
		if (result.canceled) return;
		await review('revoke', result.result?.trim() || null, applicationId);
	} finally {
		reviewBusy.value = false;
	}
}

async function review(decision: 'approve' | 'reject' | 'revoke', reason: string | null, applicationId: string, approvedType?: VerificationType) {
	try {
		const payload: Record<string, unknown> = {
			applicationId,
			reason,
		};
		if (decision === 'approve') payload.approvedType = approvedType;
		await api(`admin/verification/${decision}`, payload);
		closeSelection();
		requests.value = requests.value.filter(request => request.id !== applicationId);
		const refreshed = await loadRequests(false, false);
		await os.alert({
			type: refreshed ? 'success' : 'warning',
			text: refreshed
				? decision === 'approve' ? i18n.ts._verification.approvedNotice : decision === 'reject' ? i18n.ts._verification.rejectedNotice : i18n.ts._verification.revokedNotice
				: `${decision === 'approve' ? i18n.ts._verification.approvedNotice : decision === 'reject' ? i18n.ts._verification.rejectedNotice : i18n.ts._verification.revokedNotice}: ${i18n.ts._verification.loadFailed}`,
		});
	} catch (error) {
		await os.alert({ type: 'error', title: i18n.ts._verification.reviewFailed, text: errorMessage(error, i18n.ts._verification.reviewFailed) });
	}
}

const headerActions = computed(() => [{
	icon: 'ti ti-refresh',
	text: i18n.ts._verification.refresh,
	handler: () => { if (iAmAdmin && !reviewBusy.value) void loadRequests(); },
}]);

onMounted(() => {
	if (iAmAdmin) void loadRequests();
	else loading.value = false;
});

definePage(() => ({
	title: i18n.ts._verification.adminTitle,
	icon: 'ti ti-badge',
}));
</script>

<style lang="scss" module>
.requestList {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
	gap: 12px;
}

.request {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 12px;
	text-align: left;
	color: var(--MI_THEME-fg);
	transition: background-color 0.15s ease;
}

.request:hover,
.requestSelected {
	background: var(--MI_THEME-panelHighlight);
}

.request :global(.avatar) {
	width: 42px;
	height: 42px;
	flex: 0 0 auto;
}

.requestBody {
	min-width: 0;
	flex: 1;
}

.requestTitle,
.requestMeta {
	display: flex;
	gap: 8px;
	align-items: center;
}

.requestTitle {
	font-size: 1.05em;
}

.requestTitle strong {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.requestMeta {
	margin-top: 4px;
	font-size: 85%;
	color: var(--MI_THEME-fgTransparent);
	flex-wrap: wrap;
}

.requestStatus {
	margin-left: auto;
	font-size: 80%;
	white-space: nowrap;
}

.chevron {
	color: var(--MI_THEME-fgTransparent);
}

.detail {
	padding: 20px;
}

.detailHeader {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
}

.detailTitle {
	margin: 0 0 6px;
	font-size: 1.1em;
}

.detailMeta {
	display: flex;
	gap: 16px;
	flex-wrap: wrap;
	font-size: 90%;
	color: var(--MI_THEME-fgTransparent);
}

.documents {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 12px;
}

.document {
	min-width: 0;
}

.documentLabel {
	margin-bottom: 6px;
	font-weight: 600;
}

.imageBox {
	display: grid;
	min-height: 180px;
	place-items: center;
	overflow: hidden;
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-bg);
	color: var(--MI_THEME-fgTransparent);
}

.imageBox img {
	display: block;
	width: 100%;
	max-height: 420px;
	object-fit: contain;
}

@media (max-width: 600px) {
	.documents {
		grid-template-columns: 1fr;
	}
}
</style>
