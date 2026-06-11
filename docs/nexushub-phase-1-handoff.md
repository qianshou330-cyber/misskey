# NexusHub phase 1 handoff

Date: 2026-06-11

## Scope

Phase 1 implements the baseline APK resource center:

- APK resource persistence, migration, API registration, and misskey-js generated API types.
- User resource center pages for browsing, uploading, and viewing APK resources.
- Admin review page for publishing, rejecting, and deleting resource records.
- Product rules:
  - Unpublished resources are visible only to their author.
  - Rejected resources can be updated and resubmitted.
  - Admin delete removes only the APK resource record and keeps the Drive file.
  - Author downloads of their own unpublished resources do not increment download count.
- NexusHub entry points, theme/assets, and Chinese UI copy needed for the phase 1 experience.

Manual APK upload verification was intentionally skipped per product direction. The product rules are covered by backend e2e tests.

## Verification

Commands run successfully:

- `pnpm --filter backend typecheck`
- `pnpm --filter backend test:e2e -- test/e2e/apk-resources.ts --run`
- `pnpm build`

Build warnings observed are existing bundler warnings, including TypeORM `expo-sqlite` externalization, ineffective dynamic imports, duplicate admin search labels, and frontend chunk-size warnings. They did not fail the build.

## Change groups

Recommended commit grouping:

1. Backend APK resource model and API
   - `packages/backend/migration/1780061000000-add-apk-resource.js`
   - `packages/backend/src/models/ApkResource.ts`
   - `packages/backend/src/postgres.ts`
   - `packages/backend/src/server/api/apk-resource-utils.ts`
   - `packages/backend/src/server/api/endpoint-list.ts`
   - `packages/backend/src/server/api/endpoints/apk/`
   - `packages/backend/src/server/api/endpoints/admin/apk/`
   - `packages/backend/src/core/RoleService.ts`

2. Frontend resource center and admin review UI
   - `packages/frontend/src/pages/resources.vue`
   - `packages/frontend/src/pages/apk-upload.vue`
   - `packages/frontend/src/pages/apk-detail.vue`
   - `packages/frontend/src/pages/admin/apk-resources.vue`
   - `packages/frontend/src/components/NxApkResourceCard.vue`
   - `packages/frontend/src/types/apk-resource.ts`
   - `packages/frontend/src/router.definition.ts`
   - `packages/frontend/src/navbar.ts`
   - `packages/frontend/src/pages/admin/index.vue`
   - `packages/frontend/src/pages/timeline.vue`
   - `packages/frontend/src/components/MkDrive.file.vue`

3. Generated API client types
   - `packages/misskey-js/etc/misskey-js.api.md`
   - `packages/misskey-js/src/autogen/apiClientJSDoc.ts`
   - `packages/misskey-js/src/autogen/endpoint.ts`
   - `packages/misskey-js/src/autogen/entities.ts`
   - `packages/misskey-js/src/autogen/types.ts`

4. Product-rule tests
   - `packages/backend/test/e2e/apk-resources.ts`

5. NexusHub branding and local product copy
   - `locales/zh-CN.yml`
   - `packages/frontend/src/boot/common.ts`
   - `packages/frontend/src/store.ts`
   - `packages/frontend-shared/themes/d-nexushub.json5`
   - `packages/backend/assets/nexushub.svg`
   - `packages/backend/assets/momentcircle*.png`
   - `packages/backend/assets/momentcircle*.svg`
   - `packages/backend/src/server/web/views/*.tsx`

6. Local workflow/docs
   - `.gitignore`
   - `docs/misskey-fork-prep.md`
   - `docs/nexushub-phase-1-handoff.md`

## Items to review before committing

- `.gitignore` includes local workflow exclusions and should be kept only if those local files should stay out of source control.
- The server web view branding files are not part of the APK resource data model, but they are part of the NexusHub phase 1 product shell.
- `packages/frontend/src/pages/timeline.vue` now only adds resource entry links in the side column; phase 2 should decide whether the timeline should keep, move, or remove this resource entry.
- `packages/frontend/src/pages/settings/notifications.vue` contains a small spacing adjustment that is not directly tied to APK resources. Keep it only if it belongs to the broader NexusHub UI cleanup.

## Phase 2 candidates

- Author resource management page with status filtering.
- Admin review filters, rejection reason, and audit notes.
- Resource search, tags/categories, and sorting.
- Version history and update logs.
- APK validation policy for file size, package name, and version strategy.
