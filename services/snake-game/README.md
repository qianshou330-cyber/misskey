# PUBO Snake game service 0.1.0

Standalone MIT service adapted from the pinned upstream in `UPSTREAM.json`. It does not load Misskey configuration, connect to PostgreSQL/Redis, create accounts, or accept Misskey API tokens.

## Build and checks

Use Node.js 24 or 26. This directory is an independent npm project; do not install dependencies at the Misskey workspace root.

```sh
npm ci --workspaces=false --ignore-scripts --no-audit --no-fund
npm test --workspaces=false
npm run build --workspaces=false
```

The Dockerfile uses `node:26.4.0-trixie-slim`, has a `build` target with the isolated load driver and tests, and a runtime target with production dependencies only. Record the resolved base-image digest at deployment. The runtime runs as UID/GID 991, uses at most 384 MiB V8 old space, and must additionally receive Docker limits of one CPU and 512 MiB, a read-only root filesystem and no-new-privileges. Do not share the game process with the Misskey worker.

## Restricted runtime configuration

| Variable | Value |
|---|---|
| `SNAKE_TICKET_SECRET_FILE` | Required absolute path to a regular file of 32–4096 raw random bytes. Read verbatim without trimming. On Linux mode 0600 or stricter, readable only by the runtime account. Mount read-only outside the source tree. |
| `SNAKE_PUBLIC_ORIGIN` | Required exact HTTP(S) origin, production `https://bolubo.com`; no trailing slash, path, username or query. |
| `SNAKE_MAX_HUMANS` | Integer 1–20, default 20. Values above the tested maximum are rejected. |
| `HOST` | Default 127.0.0.1; Docker image sets 0.0.0.0 inside the private container network. |
| `PORT` | Default 3021. Publish on loopback or a private network only. |

Start with `npm start`. SIGTERM/SIGINT stop the simulation, notify connected clients, close sockets and the HTTP listener; state is deliberately ephemeral. Restart never restores a previous life. Health is `GET /health`; aggregate numeric performance counters are at `GET /metrics`. Neither endpoint returns account names, IDs, tickets or secret material.

## Authentication and protocol

Socket.IO uses `/games/snake/socket.io/`, WebSocket transport only, exact Origin verification, maximum 4 KiB packets and a five-second namespace-connect timeout. The client authenticates with `{ ticket }`. The ticket is `base64url(JSON).base64url(HMAC-SHA256(encodedPayload))` and contains `{v:1,aud:"pubo-snake",sub,name,jti,iat,exp}`. A UUID v4 `jti` is single-use until expiry, `iat`/`exp` are integer Unix seconds, lifetime is at most 60 seconds, future issuance is rejected. Issuance at or before `floor(serviceStartMilliseconds/1000)` is rejected, so a ticket issued during the first boot second must be reissued after that second. The replay cache is capped at 10,000 entries and fails closed when full. One account may have one active connection; a second connection is rejected instead of replacing the first.

The exact payload types are in `src/protocol.ts`. A connection automatically starts its first life and receives `game:ready`, including world dimensions, a complete food snapshot/version, and initial state. The server simulates at 30 Hz and sends volatile player snapshots at 15 Hz. Food changes use reliable ordered `game:food` packets; an interrupted food version sequence is repaired with `game:syncFood` and `game:foodSnapshot`, limited to once every two seconds. Input is `{seq,angle,boost}`, capped at 20 events per rolling second, validated at runtime and never contains positions or scores. Sequence numbers must increase. Invalid floods disconnect the sender; occasional excess frames are dropped.

Death emits `game:dead` once. Restart is an explicit `game:restart` action with an acknowledgement, accepted only for a dead player and at most once per two seconds. A disconnected life ends permanently; reconnect requires a new ticket and an explicit player action. No automatic reconnect/resume is supported. `game:closing` tells the client that the service is stopping.

Without a valid human input for 15 simulation ticks (500 ms), the server releases boost while preserving heading. This prevents a hidden or stalled client from retaining acceleration.

## Gameplay bounds

There is one arena, configurable up to 20 humans. Computer snakes are named `电脑 N`, carry `isBot:true`, and number `min(5,max(0,6-humans))`. With no humans the simulation timer is stopped and the world is cleared. The world wraps at 3000×3000. Players steer continuously, eat food to grow/score, and can boost by spending body segments. Head-to-body collisions kill the entering snake; simultaneous head-on collisions kill both in the same tick. Self-collision is disabled. No power-ups are present. Body length is capped at 160 segments, food starts at 300 and never exceeds 360. Dead humans continue occupying their connection slot until they leave; computers respawn after three seconds.

## Isolated load verification

Never send synthetic load to the public game. Run a separate test service/container with a separate restricted secret, the same compiled source and the same one-CPU/512-MiB limits. The `build` image contains `dist/scripts/soak.js` and the pinned socket.io-client dependency; the driver must run in a separate container/process so its CPU and memory are excluded from service metrics.

```sh
SNAKE_SOAK_ISOLATED=1 \
SNAKE_SOAK_URL=http://isolated-snake:3021 \
SNAKE_PUBLIC_ORIGIN=https://bolubo.com \
SNAKE_TICKET_SECRET_FILE=/run/secrets/isolated-snake-ticket \
SNAKE_SOAK_HUMANS=20 SNAKE_SOAK_SECONDS=1800 \
SNAKE_SOAK_OUTPUT=/receipts/unique-20-human-soak.json \
node dist/scripts/soak.js
```

The receipt uses exclusive creation and contains no secrets or session content. It records true elapsed time, 20 persistent human connections, deaths/restarts, food continuity, input/state rates, full-tick p95 (including snapshot serialization), RSS and process CPU. PASS requires at least 27 simulation ticks/s and 13 state frames/s, p95 tick work under 33.34 ms, RSS under 512 MiB, average service CPU at most 1.05 cores, zero unexpected disconnects/food gaps, and a stopped empty arena after all clients leave. A short smoke run must never be described as the 30-minute soak. Also run a separate one-human/5-computer case (recommended 180 seconds). Keep receipts outside the source tree.

On failure leave the new entry disabled, preserve evidence, and stop only this game service. Do not alter existing Misskey services, previous game implementations, chart jobs or their stored state.

The harness also checks each client's actually received state rate, food/body bounds, and retains five-second numeric samples. For the long soak it excludes five minutes of warmup, reports the first/last five-minute RSS and heap medians and linear slopes, and rejects RSS median growth above 32 MiB or an RSS slope above 0.5 MiB/min. Short cases mark memory trend unobserved.
