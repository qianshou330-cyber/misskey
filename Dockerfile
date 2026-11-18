# syntax = docker/dockerfile:1.23

ARG NODE_VERSION=26.4.0-trixie

# build assets & compile TypeScript

FROM node:${NODE_VERSION} AS native-builder

RUN 	rm -f /etc/apt/apt.conf.d/docker-clean \
	; echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' > /etc/apt/apt.conf.d/keep-cache \
	&& apt-get update \
	&& apt-get install -yqq --no-install-recommends \
	build-essential

WORKDIR /misskey

COPY ["pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json", "./"]
COPY ["scripts", "./scripts"]
COPY ["patches", "./patches"]
COPY ["packages/backend/package.json", "./packages/backend/"]
COPY ["packages/frontend-shared/package.json", "./packages/frontend-shared/"]
COPY ["packages/frontend/package.json", "./packages/frontend/"]
COPY ["packages/frontend-embed/package.json", "./packages/frontend-embed/"]
COPY ["packages/frontend-builder/package.json", "./packages/frontend-builder/"]
COPY ["packages/i18n/package.json", "./packages/i18n/"]
COPY ["packages/icons-subsetter/package.json", "./packages/icons-subsetter/"]
COPY ["packages/sw/package.json", "./packages/sw/"]
COPY ["packages/misskey-js/package.json", "./packages/misskey-js/"]
COPY ["packages/misskey-reversi/package.json", "./packages/misskey-reversi/"]
COPY ["packages/misskey-bubble-game/package.json", "./packages/misskey-bubble-game/"]

ARG NODE_ENV=production

RUN node -e "console.log(JSON.parse(require('node:fs').readFileSync('./package.json')).packageManager)" | xargs npm install -g

RUN pnpm i --frozen-lockfile --aggregate-output

COPY . ./

RUN pnpm build
RUN rm -rf .git/

# build native dependencies for target platform

FROM node:${NODE_VERSION} AS target-builder

RUN apt-get update \
	&& apt-get install -yqq --no-install-recommends \
	build-essential

WORKDIR /misskey

COPY ["pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json", "./"]
COPY ["scripts", "./scripts"]
COPY ["patches", "./patches"]
COPY ["packages/backend/package.json", "./packages/backend/"]
COPY ["packages/misskey-js/package.json", "./packages/misskey-js/"]
COPY ["packages/misskey-reversi/package.json", "./packages/misskey-reversi/"]
COPY ["packages/misskey-bubble-game/package.json", "./packages/misskey-bubble-game/"]

ARG NODE_ENV=production

RUN node -e "console.log(JSON.parse(require('node:fs').readFileSync('./package.json')).packageManager)" | xargs npm install -g

RUN pnpm i --frozen-lockfile --aggregate-output

FROM node:${NODE_VERSION}-slim AS runner

ARG UID="991"
ARG GID="991"

ENV PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
	ffmpeg tini curl ca-certificates clamav clamav-freshclam libjemalloc-dev libjemalloc2 \
	&& ln -s /usr/lib/$(uname -m)-linux-gnu/libjemalloc.so.2 /usr/local/lib/libjemalloc.so \
	&& groupadd -g "${GID}" misskey \
	&& useradd -l -u "${UID}" -g "${GID}" -m -d /misskey misskey \
	&& find / -type d -path /sys -prune -o -type d -path /proc -prune -o -type f -perm /u+s -ignore_readdir_race -exec chmod u-s {} \; \
	&& find / -type d -path /sys -prune -o -type d -path /proc -prune -o -type f -perm /g+s -ignore_readdir_race -exec chmod g-s {} \; \
	&& apt-get clean \
	&& rm -rf /var/lib/apt/lists

# add package.json to add pnpm
COPY ./package.json ./package.json
RUN node -e "console.log(JSON.parse(require('node:fs').readFileSync('./package.json')).packageManager)" | xargs npm install -g

USER misskey
WORKDIR /misskey

COPY --chown=misskey:misskey --from=target-builder /misskey/node_modules ./node_modules
COPY --chown=misskey:misskey --from=target-builder /misskey/packages/backend/node_modules ./packages/backend/node_modules
COPY --chown=misskey:misskey --from=target-builder /misskey/packages/misskey-js/node_modules ./packages/misskey-js/node_modules
COPY --chown=misskey:misskey --from=target-builder /misskey/packages/misskey-reversi/node_modules ./packages/misskey-reversi/node_modules
COPY --chown=misskey:misskey --from=target-builder /misskey/packages/misskey-bubble-game/node_modules ./packages/misskey-bubble-game/node_modules
COPY --chown=misskey:misskey --from=native-builder /misskey/built ./built
COPY --chown=misskey:misskey --from=native-builder /misskey/packages/misskey-js/built ./packages/misskey-js/built
COPY --chown=misskey:misskey --from=native-builder /misskey/packages/misskey-reversi/built ./packages/misskey-reversi/built
COPY --chown=misskey:misskey --from=native-builder /misskey/packages/misskey-bubble-game/built ./packages/misskey-bubble-game/built
COPY --chown=misskey:misskey --from=native-builder /misskey/packages/backend/built ./packages/backend/built
COPY --chown=misskey:misskey --from=native-builder /misskey/packages/i18n/built ./packages/i18n/built
COPY --chown=misskey:misskey . ./

ENV LD_PRELOAD=/usr/local/lib/libjemalloc.so
ENV NODE_ENV=production
HEALTHCHECK --interval=5s --retries=20 CMD ["/bin/bash", "/misskey/healthcheck.sh"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["pnpm", "run", "migrateandstart"]


