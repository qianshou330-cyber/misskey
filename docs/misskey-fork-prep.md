# MomentCircle / Misskey secondary development prep

This document records the current local repository state, runtime status, and safe next steps for turning this Misskey fork into a Chinese microblogging social platform named MomentCircle (MO).

## Scope and principles

- Keep Misskey core architecture intact.
- Do not remove the user system, note/timeline system, notifications, search, admin UI, or ActivityPub federation.
- Prefer configuration and localization before source-level branding changes.
- Preserve upstream naming in code, database fields, models, and API contracts unless there is a strong technical reason.
- Keep every change small, reviewable, buildable, and easy to revert.
- Do not use `X`, `Twitter`, `Tweet`, or other protected brand terms in product naming or UI copy.
- Misskey is AGPL-3.0. A modified online service must provide corresponding source code to network users.

## Repository status

- Local path: `C:\Users\Administrator\misskey`
- Origin: `https://github.com/qianshou330-cyber/misskey.git`
- Upstream: `https://github.com/misskey-dev/misskey.git`
- Current branch: `develop`
- Origin default branch: `origin/develop`
- Current HEAD: `5157c277f1 New Crowdin updates (#17377)`
- Version from `package.json`: `2026.6.0-alpha.0`
- Package manager: `pnpm@11.5.0`
- Fork evidence:
  - The local repository has `origin` pointing to `qianshou330-cyber/misskey` and `upstream` pointing to `misskey-dev/misskey`.
  - Current history and root structure match official Misskey.
  - `package.json` still declares the official repository URL.

Current reviewable preparation changes:

- `.gitignore`: keep local Docker stack files and the post-reboot helper script out of source commits.
- `locales/zh-CN.yml`: Chinese social terminology adjustments. Current pass keeps changes in the locale layer and does not rename code, database fields, API names, or core Misskey concepts.
- `docs/misskey-fork-prep.md`: local fork preparation, structure, runtime, and branding notes.

Local-only runtime files:

- `compose.yml`
- `scripts/continue-after-reboot.ps1`

## Files reviewed

- `README.md`
- `package.json`
- `pnpm-workspace.yaml`
- `compose_example.yml`
- `compose.local-db.yml`
- `.config/example.yml`
- `.config/docker_example.env`
- `locales/`
- `packages/`

## Technology stack

- Monorepo: pnpm workspaces
- Frontend: Vue, TypeScript, Vite/Rolldown-related build tooling
- Backend: Node.js, TypeScript, NestJS-style modules/services, Fastify server pieces
- Database: PostgreSQL, TypeORM migrations/models
- Cache/queues/timelines: Redis
- Federation: ActivityPub implementation under backend core/server modules
- Container runtime: Docker Compose with `web`, `db`, and `redis`
- Tests: Cypress plus backend package tests

## Project structure

- Frontend application: `packages/frontend`
- Frontend shared packages: `packages/frontend-shared`, `packages/frontend-builder`, `packages/frontend-embed`
- Backend application: `packages/backend`
- API endpoint registry and endpoints: `packages/backend/src/server/api`, especially `packages/backend/src/server/api/endpoints`
- Admin API endpoints: `packages/backend/src/server/api/endpoints/admin`
- Backend models/entities: `packages/backend/src/models`
- Database migrations: `packages/backend/migration`
- Core business services: `packages/backend/src/core`
- ActivityPub federation: `packages/backend/src/core/activitypub`, `packages/backend/src/server/ActivityPubServerService.ts`
- Queue processors: `packages/backend/src/queue`
- Admin frontend: `packages/frontend/src/pages/admin`
- Frontend router: `packages/frontend/src/router.definition.ts`
- Source language files: `locales`, especially `locales/zh-CN.yml`
- Packaged i18n workspace: `packages/i18n`
- Runtime config templates: `.config/example.yml`, `.config/docker_example.yml`, `.config/docker_example.env`
- Active local config: `.config/default.yml`, `.config/docker.env`
- Docker stack examples: `compose_example.yml`, `compose.local-db.yml`
- Active local Docker stack: `compose.yml`
- Docker image build: `Dockerfile`

## Local environment

Checked versions:

- Git: `2.54.0.windows.1`
- Docker: `29.5.2`
- Docker Compose: `v5.1.4`
- Host Node.js: `v24.16.0`
- pnpm: `11.5.0`
- Docker runtime Node.js: `v22.22.2` from the project Dockerfile
- Docker Desktop status: running
- Docker Desktop WSL2 kernel after update: `6.6.114.1-microsoft-standard-WSL2`

WSL/Docker fix applied:

- Plain `wsl --update` failed.
- `wsl --update --web-download` succeeded.
- Docker Desktop was restarted and became healthy.

## Current local Docker runtime

Active services:

- `misskey-db-1`: healthy
- `misskey-redis-1`: healthy
- `misskey-web-1`: healthy, exposed on `0.0.0.0:3000->3000/tcp`

Local HTTP check:

- `http://localhost:3000` returns HTTP `200`.

Misskey boot log confirmed:

- `Misskey v2026.6.0-alpha.0`
- `Configuration compiled`
- `All workers started`
- `Now listening on port 3000 on http://localhost:3000`

## Local run commands

Clone from scratch:

```powershell
cd C:\Users\Administrator
git clone https://github.com/qianshou330-cyber/misskey.git
cd C:\Users\Administrator\misskey
git remote add upstream https://github.com/misskey-dev/misskey.git
```

Prepare Docker config:

```powershell
Copy-Item compose_example.yml compose.yml
Copy-Item .config\docker_example.yml .config\default.yml
Copy-Item .config\docker_example.env .config\docker.env
```

Run with Docker Compose:

```powershell
docker compose config
docker compose up -d --build
docker compose ps
docker compose logs -f web
```

Stop/restart:

```powershell
docker compose stop
docker compose start
docker compose restart web
```

Open:

```text
http://localhost:3000
```

## Active local config

`.config/default.yml` is adapted for Docker Compose:

- `url: http://localhost:3000/`
- `port: 3000`
- `db.host: db`
- `db.port: 5432`
- `db.db: misskey`
- `db.user: misskey`
- `db.pass: misskey-local-pass`
- `redis.host: redis`
- `redis.port: 6379`
- `fulltextSearch.provider: sqlLike`
- SMTP is not configured.
- Object storage is not configured.
- File uploads use local storage via the mounted `./files:/misskey/files` volume.

`.config/docker.env` is aligned with `default.yml`:

- `POSTGRES_USER=misskey`
- `POSTGRES_PASSWORD=misskey-local-pass`
- `POSTGRES_DB=misskey`
- `DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}"`

## Admin initialization

Misskey does not ship a default admin username/password.

Initial setup behavior:

1. Start the stack.
2. Open `http://localhost:3000`.
3. If `meta.rootUserId` is empty, the setup page creates the root administrator.
4. If `.config/default.yml` has `setupPassword`, enter that setup password.
5. If `setupPassword` is not configured and the instance is local-only, leave setup password blank.
6. Create the first administrator account.

Current local database state:

- User count: `2`
- Local users: `system.proxy`, `wuji`
- `meta.rootUserId`: `an8tluct3b7m0003`
- Root/admin username: `wuji`
- Password cannot be recovered from the database. Use the password created during setup, or reset it through an admin/session recovery flow if needed.

Admin URL:

```text
http://localhost:3000/admin
```

## Admin-configurable settings

These can be changed through the admin UI and should be preferred before editing source files:

- Site name: `/admin/settings`, `packages/frontend/src/pages/admin/settings.vue`
- Short name: `/admin/settings`, `shortName`
- Site description: `/admin/settings`, `description`
- Repository URL: `/admin/settings` or `/admin/branding`, `repositoryUrl`
- Registration switch: `/admin/settings`, `disableRegistration`
- Federation mode and allowed hosts: `/admin/settings`, federation section
- Icon/PWA images/banner/background: `/admin/branding`
- Theme color: `/admin/branding`
- Default light/dark themes: `/admin/branding`
- Email/SMTP settings: `/admin/email-settings`
- Upload and Drive-related settings: admin Drive/settings areas and `Meta` policies

Important backend fields live in `packages/backend/src/models/Meta.ts`.

Admin update API:

- Read meta: `packages/backend/src/server/api/endpoints/admin/meta.ts`
- Update meta: `packages/backend/src/server/api/endpoints/admin/update-meta.ts`

## Brand target

- Platform name: `MomentCircle`
- Short name: `MO`
- Positioning: Chinese microblogging social platform / interest-based short-post community
- Suggested theme color: start with a modern blue-green such as `#14B8A6` or a neutral blue such as `#2563EB`; avoid copying X/Twitter visual identity.

## Brand source locations

Hardcoded or default Misskey branding appears in these high-value locations:

- `README.md`: project intro and README logo.
- `assets/title_float.svg`: README logo asset.
- `packages/backend/src/server/web/HtmlTemplateService.ts`: common template data, default instance name fallback.
- `packages/backend/src/server/web/views/base.tsx`: default HTML title, OGP metadata, icon links, default theme color.
- `packages/backend/src/server/web/manifest.json`: default PWA `name`, `short_name`, `theme_color`, icons.
- `packages/backend/src/server/web/views/*.tsx`: OGP/SEO render paths for notes, users, pages, clips, channels, gallery posts, etc.
- `packages/frontend/src/pages/welcome.vue`: welcome page shell.
- `packages/frontend/src/pages/welcome.setup.vue`: setup screen.
- `packages/frontend/src/pages/welcome.entrance.simple.vue`: simple entrance page.
- `packages/frontend/src/pages/welcome.entrance.classic.vue`: classic entrance page.
- `packages/frontend/src/components/MkVisitorDashboard.vue`: visitor dashboard copy/layout.
- `packages/frontend/src/components/MkSignin.vue`
- `packages/frontend/src/components/MkSignin.input.vue`
- `packages/frontend/src/components/MkSignin.password.vue`
- `packages/frontend/src/components/MkSignupDialog.vue`
- `packages/frontend/src/components/MkSignupDialog.form.vue`
- `packages/frontend/src/components/MkSignupDialog.rules.vue`
- `locales/zh-CN.yml`: Chinese visible strings.
- `locales/en-US.yml`: base English strings.

Logo/icon path expectations:

- Browser favicon: `/favicon.ico`
- Apple touch icon: `/apple-touch-icon.png`
- PWA 192 icon: `/static-assets/icons/192.png`
- PWA 512 icon: `/static-assets/icons/512.png`
- Admin-configurable icon URLs: `iconUrl`, `app192IconUrl`, `app512IconUrl`

Recommended image sizes:

- `favicon.ico`: multi-size ICO including 16, 32, and 48 px.
- Apple touch icon: 180 x 180 PNG.
- PWA 192 icon: 192 x 192 PNG.
- PWA 512 icon: 512 x 512 PNG.
- Open Graph/share image: 1200 x 630 PNG/JPEG.
- Banner: at least 1500 x 500, crop-safe.

## Chinese localization plan

Primary file to edit first:

- `locales/zh-CN.yml`

Do not rename database fields, API endpoint names, TypeScript classes, model names, or ActivityPub concepts.

Suggested terminology mapping:

- `Note` / `Notes`: `动态`
- `Renote`: `转发`
- `Reaction`: `表态`
- `Timeline`: `时间线`
- `Home`: `首页`
- `Explore`: `发现`
- `Notifications`: `通知`
- `Profile`: `个人主页`
- `Follow`: `关注`
- `Following`: `正在关注`
- `Followers`: `粉丝`
- `Drive`: `文件库`
- `Channels`: `频道`
- `Clips`: `收藏夹`
- `Pages`: `页面`
- `Instance`: `站点`
- `Federation`: `联邦`
- `Antenna`: `订阅流`

Important `locales/zh-CN.yml` keys already found:

- `headlineMisskey`
- `introMisskey`
- `note`
- `notes`
- `renote`
- `renotes`
- `reaction`
- `reactions`
- `timeline`
- `home`
- `explore`
- `notifications`
- `profile`
- `follow`
- `following`
- `followers`
- `drive`
- `channels`
- `clips`
- `pages`
- `instance`
- `instances`
- `federation`
- `antennas`
- `_timelineDescription`
- `_tutorial`
- `_widgets`
- `_permissions`
- `_antennaSources`
- `_profile`
- `_timelines`

Workflow for localization:

1. Edit only `locales/zh-CN.yml`.
2. Build.
3. Open local site in Chinese UI.
4. Search remaining visible English/Japanese/Misskey-specific strings.
5. If a string is not in locale files, then locate the frontend/backend source string and patch it surgically.

## Light brand UI change plan

Do this only after the running baseline is stable:

1. Set admin values first:
   - Name: `MomentCircle`
   - Short name: `MO`
   - Description: `发现新鲜动态，连接真实兴趣。分享生活、观点与灵感。`
   - Repository URL: `https://github.com/qianshou330-cyber/misskey`
   - Theme color: selected original MomentCircle color.
2. Replace icon assets using original, non-infringing artwork.
3. Update PWA defaults in `packages/backend/src/server/web/manifest.json`.
4. Update HTML fallback metadata in `packages/backend/src/server/web/views/base.tsx`.
5. Update Chinese welcome/login/signup copy through `locales/zh-CN.yml`.
6. Rebuild Docker image and verify `http://localhost:3000`.

Suggested welcome copy:

- `欢迎来到 MomentCircle`
- `发现新鲜动态，连接真实兴趣`
- `分享生活、观点与灵感`

## Current smoke test result

Automated API smoke test result:

- Admin login: passed.
- Admin identity check through `/api/i`: passed.
- Admin metadata endpoint `/api/admin/meta`: passed.
- Public signup: failed with HTTP 400 because the local instance is invitation-only.
- Admin-created temporary users: passed.
- Follow/unfollow between temporary users: passed.
- Create note: passed.
- Reply: passed.
- Renote/repost: passed.
- Reaction: passed.
- Notification retrieval: passed.
- User search through `/api/users/search`: passed.
- Note detail retrieval through `/api/notes/show`: passed.
- Drive upload/delete: passed.
- Cleanup of temporary files, notes, follow relation, and temporary users: passed.
- Docker services after test: healthy.

Follow-up configuration changes:

- Public registration was opened through the existing admin API by setting `disableRegistration=false`.
- Note full-text search was enabled through the existing default role policy API by setting `canSearchNotes=true`.
- Public signup was re-tested and passed.
- Note search through `/api/notes/search` was re-tested and passed.
- Temporary test account and test note from this verification were deleted through existing API endpoints.

Latest localization pass:

- Updated `locales/zh-CN.yml` to consistently use Chinese social-platform terms for common user-facing strings:
  - `Note/Notes`: `动态`
  - `Renote`: `转发`
  - `Reaction`: `表态`
  - `Drive`: `文件库`
  - `Antenna`: `订阅流`
  - `Clip`: `收藏夹`
  - `Followers`: `粉丝`
  - `Profile`: `个人主页`
- Kept internal keys such as `note`, `renote`, `reaction`, `drive`, `antenna`, and `clip` unchanged.
- Verified no high-frequency old Chinese terms remain in `locales/zh-CN.yml` for: `帖子`, `帖文`, `转帖`, `回应`, `网盘`, `天线`, `便签`, `关注者`, `个人资料`.
- `pnpm build` completed successfully after the locale changes.
- `docker compose up -d --build` completed successfully after the locale changes.
- `docker compose ps` shows `db`, `redis`, and `web` healthy.
- `http://localhost:3000` returns HTTP `200`.
- Web logs show no pending migrations and normal startup on port `3000`.

Admin configuration pass:

- Applied through the existing `admin/update-meta` API, not by editing business code.
- Site name: `MomentCircle`
- Short name: `MO`
- Description: `发现新鲜动态，连接真实兴趣。分享生活、观点与灵感。`
- Theme color: `#1D9BF0`
- Repository URL: `https://github.com/qianshou330-cyber/misskey`
- Public registration remains open: `disableRegistration=false`
- Public `/api/meta` returns the configured name, short name, theme color, and description.
- `db`, `redis`, and `web` remain healthy after the configuration update.
- `http://localhost:3000` still returns HTTP `200`.

Icon and PWA configuration pass:

- Added original MomentCircle icon assets:
  - `packages/backend/assets/momentcircle.svg`
  - `packages/backend/assets/momentcircle-192.png`
  - `packages/backend/assets/momentcircle-512.png`
- Recommended icon sizes now available:
  - SVG source for browser favicon and scalable UI usage.
  - `192x192` PNG for PWA manifest.
  - `512x512` PNG for PWA manifest and Apple touch icon.
- Applied icon URLs through the existing `admin/update-meta` API:
  - `iconUrl=/static-assets/momentcircle.svg`
  - `logoImageUrl=/static-assets/momentcircle.svg`
  - `app192IconUrl=/static-assets/momentcircle-192.png`
  - `app512IconUrl=/static-assets/momentcircle-512.png`
- `pnpm build` completed successfully after adding icon assets.
- `docker compose up -d --build` completed successfully after adding icon assets.
- Static icon URLs return HTTP `200`.
- `/manifest.json` now returns `MomentCircle`, `MO`, `#1D9BF0`, and the new `192x192` / `512x512` icon paths.
- HTML output now includes:
  - `<link rel="icon" href="/static-assets/momentcircle.svg">`
  - `<link rel="apple-touch-icon" href="/static-assets/momentcircle-512.png">`
  - `<title>MomentCircle</title>`
  - MomentCircle description in `description` and OGP metadata.
- Known remaining source-level brand residue: `meta name="application-name" content="Misskey"` is still emitted by the base HTML template and should be handled in a small follow-up source patch.

Open items:

- Browser-level UI testing is still pending.

## Validation checklist

Completed:

- Git remote checked.
- Default branch checked.
- Recent commits checked.
- Key project files reviewed.
- Runtime config created.
- Docker Desktop repaired via WSL web update.
- Docker Compose config validated.
- Docker image built successfully.
- PostgreSQL healthy.
- Redis healthy.
- Web container healthy.
- Database migrations completed during first boot.
- `http://localhost:3000` returns `200`.
- Admin root user detected as `wuji`.
- Admin login credential validated.
- Admin API access validated.
- Note create/delete validated.
- Reply validated.
- Renote/repost validated.
- Reaction validated.
- Follow/unfollow validated.
- Notification retrieval validated.
- User search validated.
- Note full-text search validated.
- File upload/delete validated.
- Public registration validated after opening registration.
- zh-CN localization build validated with `pnpm build`.
- Docker image rebuilt and local runtime validated after the latest localization pass.
- Site name, short name, description, repository URL, theme color, and open registration validated through existing admin configuration.
- MomentCircle icon, Apple touch icon, and PWA manifest icon configuration validated.
- User-provided MomentCircle PNG assets applied:
  - Square icon source: `C:\Users\Administrator\Downloads\mo2.png`.
  - Horizontal logo source: `C:\Users\Administrator\Downloads\mo.png`.
  - Added `packages/backend/assets/momentcircle-icon-192.png`.
  - Added `packages/backend/assets/momentcircle-icon-512.png`.
  - Added `packages/backend/assets/momentcircle-logo.png`.
  - Admin metadata now points `iconUrl` to `/static-assets/momentcircle-icon-512.png`.
  - Admin metadata now points `logoImageUrl` to `/static-assets/momentcircle-logo.png`.
  - PWA icon metadata now points to `/static-assets/momentcircle-icon-192.png` and `/static-assets/momentcircle-icon-512.png`.
  - Theme color updated to `#B9F000`.
  - `docker compose up -d --build` passed after applying the assets.
  - Static asset URLs, `/manifest.json`, and homepage HTML were revalidated successfully.
- Transparent-background asset pass completed:
  - Converted the user-provided square icon into transparent PNG assets:
    - `packages/backend/assets/momentcircle-icon-transparent-192.png`
    - `packages/backend/assets/momentcircle-icon-transparent-512.png`
  - Converted the user-provided horizontal logo into:
    - `packages/backend/assets/momentcircle-logo-transparent.png`
  - The transparent conversion removes only dark pixels connected to the image edges, preserving enclosed dark facial/details inside the logo.
  - Admin metadata now points to the transparent icon/logo paths.
  - `/manifest.json` now points to the transparent `192x192` and `512x512` icons.
  - Verified static URLs:
    - `/static-assets/momentcircle-icon-transparent-192.png`
    - `/static-assets/momentcircle-icon-transparent-512.png`
    - `/static-assets/momentcircle-logo-transparent.png`
- Browser-facing static brand residue pass completed:
  - Updated fallback browser metadata in:
    - `packages/backend/src/server/web/views/base.tsx`
    - `packages/backend/src/server/web/views/base-embed.tsx`
  - Updated static utility/error pages:
    - `packages/backend/src/server/web/views/info-card.tsx`
    - `packages/backend/src/server/web/views/flush.tsx`
    - `packages/backend/src/server/web/views/error.tsx`
    - `packages/backend/src/server/web/views/cli.tsx`
    - `packages/backend/src/server/web/views/bios.tsx`
    - `packages/backend/src/server/web/views/reversi-game.tsx`
  - Updated selected user-facing `zh-CN` strings for tutorial, setup, achievements, Reversi share text, safe mode, and install completion.
  - Preserved upstream/open-source Misskey references where they describe the underlying AGPL software, repository, translation, donation, or source availability context.
  - `pnpm build` passed.
  - `docker compose up -d --build` passed.
  - `db`, `redis`, and `web` are healthy.
  - Homepage HTML, `/manifest.json`, `/cli`, `/bios`, and `/flush` were revalidated.

Not fully validated in this session:

- Browser-level UI operation after login.

Recommended manual smoke test after logging in:

1. Log in as `wuji`.
2. Open `/admin`.
3. Set site name, description, repository URL, and branding values.
4. Create a second test user if registration is enabled.
5. Publish one dynamic.
6. Reply to it.
7. Repost it.
8. React to it.
9. Follow/unfollow the test user.
10. Search for the posted text.
11. Upload one image.
12. Restart with `docker compose restart` and verify the page still opens.

## Build and runtime verification commands

Docker build/runtime:

```powershell
docker compose config
docker compose up -d --build
docker compose ps
docker compose logs --tail 120 web
Invoke-WebRequest -UseBasicParsing http://localhost:3000
```

Host build check, when needed:

```powershell
pnpm install --frozen-lockfile
pnpm build
```

Focused backend checks, when needed:

```powershell
pnpm --filter backend test
pnpm lint
```

## AGPL-3.0 compliance notes

- Publishing a modified Misskey service over the network triggers source availability obligations.
- Keep the fork public or provide corresponding source through the instance UI.
- Set `/admin/settings` repository URL to `https://github.com/qianshou330-cyber/misskey` after first admin login.
- If you use `publishTarballInsteadOfProvideRepositoryUrl: true`, audit the tarball before deployment to avoid leaking secrets.
- Keep upstream license and notices intact.
- Track changes in commits so users can identify the corresponding source for the running service.

## Next recommended steps

1. Log in as `wuji` and verify admin access.
2. Set repository URL to `https://github.com/qianshou330-cyber/misskey`.
3. Set site name to `MomentCircle`, short name to `MO`, and description through admin settings.
4. Clear browser site data or use an incognito window if old chunks or icons are cached.
5. Run the smoke checklist before deeper UI or feature changes.
6. Continue with a narrow source-level brand residue pass for browser-facing static pages.
