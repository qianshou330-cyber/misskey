# NexusHub phase 2 handoff

Date: 2026-06-11

## Scope

Phase 2 extends the APK resource center into a more complete resource-management workflow:

- Author resource management with owner/status filters and resubmission after rejection.
- Public and admin search across resource metadata, plus latest/download-count sorting.
- Admin review enhancements with rejection reasons, review notes, reviewer ID, and review time.
- Version history and update logs for initial submission and later updates.
- APK metadata validation for package name format and 200 MiB maximum file size.
- Generated misskey-js API types for the new endpoint parameters and version endpoint.

The phase 1 product rules remain covered:

- Unpublished resources are visible only to their author.
- Rejected resources can be updated and resubmitted.
- Admin delete removes only the APK resource record and keeps the Drive file.
- Author downloads of their own unpublished resources do not increment download count.

Manual APK upload verification remains intentionally skipped per product direction. Backend e2e covers the resource workflow and product rules.

## Verification

Commands run successfully during phase 2:

- `pnpm build-misskey-js-with-types`
- `pnpm --filter backend typecheck`
- `pnpm --filter frontend typecheck`
- `pnpm --filter backend test:e2e -- test/e2e/apk-resources.ts --run`
- `pnpm build`

Build warnings observed are existing bundler warnings, including TypeORM `expo-sqlite` externalization, ineffective dynamic imports, duplicate admin search labels, and frontend chunk-size warnings. They did not fail the build.

## Commits

Phase 2 commits pushed to `origin/develop`:

- `8cd78e1d03 feat: add APK resource list filters`
- `24ab67a1ac feat: add APK resource review notes`
- `bcbfc2b580 feat: add APK resource version history`
- `28a7392d74 feat: validate APK resource metadata`
- `d605a9b2e8 feat: add APK resource sorting`

## Change Groups

1. List filters, search, and sorting
   - `packages/backend/src/server/api/endpoints/apk/resources/list.ts`
   - `packages/backend/src/server/api/endpoints/admin/apk/resources/list.ts`
   - `packages/frontend/src/pages/resources.vue`
   - `packages/frontend/src/pages/admin/apk-resources.vue`

2. Review notes and rejection reason
   - `packages/backend/migration/1781157600000-add-apk-resource-review-fields.js`
   - `packages/backend/src/models/ApkResource.ts`
   - `packages/backend/src/server/api/endpoints/admin/apk/resources/update-status.ts`
   - `packages/backend/src/server/api/endpoints/apk/resources/update.ts`
   - `packages/frontend/src/pages/apk-detail.vue`
   - `packages/frontend/src/pages/admin/apk-resources.vue`

3. Version history and changelog
   - `packages/backend/migration/1781159000000-add-apk-resource-version.js`
   - `packages/backend/src/models/ApkResourceVersion.ts`
   - `packages/backend/src/server/api/ApkResourceEntityService.ts`
   - `packages/backend/src/server/api/endpoints/apk/resources/versions.ts`
   - `packages/backend/src/server/api/endpoints/apk/resources/create.ts`
   - `packages/backend/src/server/api/endpoints/apk/resources/update.ts`
   - `packages/frontend/src/pages/apk-upload.vue`
   - `packages/frontend/src/pages/apk-detail.vue`

4. APK metadata validation
   - `packages/backend/src/server/api/apk-resource-utils.ts`
   - `packages/backend/src/server/api/endpoints/apk/resources/create.ts`
   - `packages/backend/src/server/api/endpoints/apk/resources/update.ts`
   - `packages/frontend/src/pages/apk-upload.vue`
   - `packages/frontend/src/pages/apk-detail.vue`

5. Generated API client and tests
   - `packages/misskey-js/etc/misskey-js.api.md`
   - `packages/misskey-js/src/autogen/apiClientJSDoc.ts`
   - `packages/misskey-js/src/autogen/endpoint.ts`
   - `packages/misskey-js/src/autogen/entities.ts`
   - `packages/misskey-js/src/autogen/types.ts`
   - `packages/backend/test/e2e/apk-resources.ts`

## Next Phase Candidates

- Tags/categories for resources, if product taxonomy is needed.
- Dedicated admin audit list or moderation history beyond the latest review fields.
- Visual UI refinement for the resource center after real content and screenshots are available.
- Optional APK parsing for package/version metadata extraction instead of manual input.
- Manual browser verification with uploaded APK files when product direction allows it.
