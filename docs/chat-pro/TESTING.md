# Chat Pro 测试复现

本文给出本次隔离开发环境的命令。实际通过、基线失败、跳过项目和真机边界见 [VALIDATION.md](VALIDATION.md)；这里的命令本身不代表已经执行或通过。执行前阅读全部隔离约束。

## 测试资源与破坏性边界

后端 e2e 每个文件会调用 `dropSchema` / `synchronize` 重建测试库；部分标为 unit 的数据库测试也会这样做。测试进程还会重置自己的服务和环境，不能与另一个测试进程共享同一套资源并行运行。

测试服务器会强制终止占用配置 HTTP 端口的进程。因此必须核实下面两个 HTTP 端口没有普通开发服务或其他工作占用，不能只看到端口号正确就启动测试。

| 用途 | 本次固定值 |
|---|---|
| Compose 项目 | `pubo-chat-pro-test` |
| PostgreSQL 18 | `127.0.0.1:54322`，库 `test-misskey`，用户 `postgres`，仅本机测试 trust 认证 |
| Redis 7 | `127.0.0.1:56322`，专属测试 Redis |
| e2e HTTP / 测试控制端口 | `61812` / `62812` |
| 合成前端浏览器场景 | `127.0.0.1:61819`，专用 harness |
| Linux 候选 HTTP | `127.0.0.1:61813`，与 e2e 不共用 |
| 本机源码 | `D:\misskey\chat-pro-work` |
| 本机日志和合成私有文件 | `D:\misskey\chat-pro-artifacts` |

生产、本机 `deploy-*` 容器、原 `language-release`、iOS、真实数据库/Redis/私有卷均不是测试目标。不要连接生产做 schema reset，不复制用户消息或密钥，也不要用 `down -v`、`prune` 或 Redis flush 作为准备步骤。

## 准备独立 PG / Redis

下面是新测试环境的公开 Compose 示例，应保存在源码包之外，例如 `D:\misskey\chat-pro-artifacts\test-compose.yml`。已有本次测试容器时，先检查并复用已经确认的测试资源，不用另一个 Compose 文件对它执行 `up` 或重建。仓库原 `packages/backend/test/compose.yml` 使用 `54312/56312`，不是本次端口。

```yaml
services:
  postgres:
    image: postgres:18
    environment:
      POSTGRES_DB: test-misskey
      POSTGRES_HOST_AUTH_METHOD: trust
    ports:
      - "127.0.0.1:54322:5432"
    tmpfs:
      - /var/lib/postgresql
  redis:
    image: redis:7
    command: ["redis-server", "--save", "", "--appendonly", "no"]
    ports:
      - "127.0.0.1:56322:6379"
    tmpfs:
      - /data
```

仅在确认项目名和端口尚未被占用的新环境启动；这些 tmpfs 数据会在容器停止后消失，不能用作持久环境：

```powershell
# 本机通过 WSL Ubuntu 的 Docker；原生 Linux 可去掉 wsl.exe -d Ubuntu -- 前缀。
wsl.exe -d Ubuntu -- docker compose -p pubo-chat-pro-test -f /mnt/d/misskey/chat-pro-artifacts/test-compose.yml up -d
wsl.exe -d Ubuntu -- docker compose -p pubo-chat-pro-test -f /mnt/d/misskey/chat-pro-artifacts/test-compose.yml ps

# 对已存在的本次环境，只读检查固定容器与映射，不读取/打印其全部环境变量。
wsl.exe -d Ubuntu -- docker ps --filter name=pubo-chat-pro-test --format 'table {{.Names}}\t{{.Ports}}\t{{.Status}}'
Get-NetTCPConnection -LocalPort 54322,56322,61812,62812 -ErrorAction SilentlyContinue |
    Select-Object LocalAddress,LocalPort,OwningProcess
```

已有容器的固定名称为 `pubo-chat-pro-test-postgres-1` / `pubo-chat-pro-test-redis-1`，网络为 `pubo-chat-pro-test_default`。检查端口所属进程及 Compose 项目后才能执行后续命令。不要通过结束未知进程来腾出端口。

## 本地公开测试配置与构建

使用仓库 `.github/misskey/test.yml` 作模板，只改本次测试端口。不要从生产配置复制。下面在已有 `.config/test.yml` 时主动停止，避免覆盖其他工作；已有配置应人工核对。

```powershell
Set-Location D:\misskey\chat-pro-work
New-Item -ItemType Directory -Path .config -Force | Out-Null
if (Test-Path -LiteralPath .config/test.yml) { throw '已有测试配置；请核对而不是覆盖' }
$chatTestYaml = Get-Content -Raw -LiteralPath .github/misskey/test.yml
$chatTestYaml = $chatTestYaml -replace 'port: 54312', 'port: 54322'
$chatTestYaml = $chatTestYaml -replace 'port: 56312', 'port: 56322'
# 移除示例初始设置口令；目标测试使用仅测试模式的合成 signup。
$chatTestYaml = $chatTestYaml -replace '(?m)^setupPassword:.*\r?\n', ''
[IO.File]::WriteAllText((Join-Path (Get-Location) '.config/test.yml'), $chatTestYaml, [Text.UTF8Encoding]::new($false))
$env:NODE_ENV = 'test'
pnpm --filter backend compile-config
if ($LASTEXITCODE -ne 0) { throw '测试配置编译失败' }
$chatCompiled = Get-Content -Raw -LiteralPath built/.config.json | ConvertFrom-Json
if ($chatCompiled.db.host -ne '127.0.0.1' -or $chatCompiled.db.port -ne 54322 -or
    $chatCompiled.db.db -ne 'test-misskey' -or $chatCompiled.redis.host -ne '127.0.0.1' -or
    $chatCompiled.redis.port -ne 56322 -or $chatCompiled.port -ne 61812) {
    throw '拒绝非本次隔离测试配置'
}
```

后端实际读取 `built/.config.json`，改 YAML 后必须重新编译。不要为本组后端 e2e 执行根目录 `pnpm start:test`：它会重新复制默认示例配置，而且 e2e 自带服务器启动，额外启动会冲突。`NODE_ENV=test` 会启用测试专用行为，仅可用于这套合成环境；不要把它设给生产服务。

依赖以锁文件为准。本次 Windows 使用 Node 24.20.0 / pnpm 11.25.0，生产 Dockerfile 自带 Node 26.4.0。新环境需完成仓库要求的原生依赖安装，避免把缺少原生模块当作应用失败：

```powershell
# 源码根目录。已有完整依赖不必重复安装。
pnpm install --frozen-lockfile

$env:NODE_ENV = 'test'
# API/SDK 改动后使用真实生成链；不要手改 autogen。
pnpm build-misskey-js-with-types
if ($LASTEXITCODE -ne 0) { throw 'SDK/API 构建失败' }
pnpm --filter backend build
if ($LASTEXITCODE -ne 0) { throw '后端构建失败' }
pnpm --filter backend build:e2e
if ($LASTEXITCODE -ne 0) { throw 'e2e 服务器构建失败' }
pnpm --filter backend compile-config
```

SDK、正常后端和 e2e 构建会写生成物；不要与其他构建或正在运行的测试并行执行。

## 临时密钥与目标后端测试

实名认证存储服务启动时要求一个 32 字节密钥。本地测试在进程内随机生成，只通过当前进程环境传给子进程；退出时清除，不写 YAML、`.env`、命令行参数或日志。合成验证资料和 Chat 文件目录也必须独立。不要调用测试控制接口 `/env` 传密钥，该接口会打印请求内容。

下面运行最后一次附件兼容修复对应的两套测试。其他目标测试可以替换命令末尾的文件列表，仍保留同样的环境和 `finally` 清理。不要在已有生产密钥环境的 shell 中运行：

```powershell
Set-Location D:\misskey\chat-pro-work
if (Test-Path Env:MISSKEY_VERIFICATION_ENCRYPTION_KEY) { throw '请使用没有现存验证密钥的独立测试 shell' }
$env:NODE_ENV = 'test'
$env:MISSKEY_VERIFICATION_ENCRYPTION_KEY = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:MISSKEY_VERIFICATION_STORAGE_PATH = 'D:\misskey\chat-pro-artifacts\test-verification-private'
$env:MISSKEY_CHAT_STORAGE_PATH = 'D:\misskey\chat-pro-artifacts\test-chat-private'
Push-Location packages/backend
try {
    node node_modules/vitest/vitest.mjs --run --config vitest.config.e2e.ts --hookTimeout 120000 test/e2e/chat.ts test/e2e/chat-pro-attachments.ts
    if ($LASTEXITCODE -ne 0) { throw '目标 e2e 未通过' }
} finally {
    Remove-Item Env:MISSKEY_VERIFICATION_ENCRYPTION_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:MISSKEY_VERIFICATION_STORAGE_PATH -ErrorAction SilentlyContinue
    Remove-Item Env:MISSKEY_CHAT_STORAGE_PATH -ErrorAction SilentlyContinue
    Pop-Location
}
```

在 `packages/backend` 目录下可选用以下**顺序执行**的目标命令；需要服务/数据库的命令仍使用上述临时环境包装。不要同时启动第二个 Vitest。

```powershell
# 消息状态与旧未读导入纯逻辑。
node node_modules/vitest/vitest.mjs --run --config vitest.config.unit.ts src/core/chat-message-state.test.ts src/core/chat-legacy-unread-import.test.ts

# 私有文件/媒体协议纯测试。没有 FFmpeg/ffprobe 时真实转换用例会明确跳过。
node node_modules/vitest/vitest.mjs --run --config vitest.config.unit.ts src/core/ChatAttachmentStorageService.test.ts src/core/ChatVoiceService.test.ts src/core/ChatAttachmentService.test.ts src/server/ChatAttachmentServerService.test.ts

# 数据库附件/配额/迁移服务；会重建测试 schema。
node node_modules/vitest/vitest.mjs --run --config vitest.config.unit.ts --hookTimeout 120000 test/unit/ChatPrivateAttachments.ts

# 7 套定向 HTTP/WS 与原 Drive/全站屏蔽回归；会重建测试 schema。
node node_modules/vitest/vitest.mjs --run --config vitest.config.e2e.ts --hookTimeout 120000 test/e2e/chat.ts test/e2e/chat-pro-attachments.ts test/e2e/chat-pro-contacts.ts test/e2e/chat-streaming.ts test/e2e/chat-session-permissions.ts test/e2e/drive.ts test/e2e/block.ts

# 原共享服务回归；RoleService 的多次 schema 重建可能较慢，不要与 e2e 并行。
node node_modules/vitest/vitest.mjs --run --config vitest.config.unit.ts --hookTimeout 120000 test/unit/RoleService.ts test/unit/server/FileServerService.ts
```

单连接池复现：仅在这份本地 `.config/test.yml` 的 `db` 下增加 `extra: { max: 1 }`，重新 `compile-config`，再串行运行目标 e2e。完成后还原该测试配置并重新编译；联系人原生屏蔽竞争还应在默认多连接池运行。不要修改共用服务端数据库配置。

测试控制器会重建 schema，所以本组 e2e 不能证明迁移文件已执行。迁移必须在另一个全新合成库用真实 migration 命令验证；不要直接向 e2e 已 synchronize 的库运行全套 migration。三份 Chat 新迁移的 `down → up` 只在隔离空库验证，不作为生产回滚命令。已有迁移证据和剩余生产演练门槛见 `VALIDATION.md`。

## 类型、代码检查与前端

后端本次明确使用 TypeScript 6 入口，不能误用指向另一编译器的 `tsc` 别名。以下命令在 `packages/backend` 执行：

```powershell
node ../../node_modules/typescript/bin/tsc6 --noEmit -p tsconfig.json
# 示例：定向检查本次最后修改的端点和测试；其他模块使用各自变更文件列表。
node ../../node_modules/eslint/bin/eslint.js --quiet src/server/api/endpoints/chat/messages/create-to-user.ts test/e2e/chat.ts
```

当前后端全量类型检查仍有 **30 条生产源码已有 Fastify 类型诊断**，基线日志 `D:\misskey\chat-pro-artifacts\backend-baseline-typescript6.log`，最终比较新增为 0；这是 BASELINE，不是 PASS，也不能对所有编译错误忽略退出码。复现时逐条对照文件和诊断内容，行号变化可规范化，任何新增诊断必须处理。

前端在源码根目录执行：

```powershell
# 结束后端测试环境变量后构建生产前端；不要沿用 NODE_ENV=test。
Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
# 前文 SDK 构建已涵盖 i18n/reversi；全新安装还需生成这两个现有前端依赖的产物。
pnpm --filter misskey-bubble-game --filter icons-subsetter build
pnpm --filter frontend typecheck
pnpm --filter frontend build
pnpm --filter frontend exec vitest --run --config vitest.config.chat.ts
# 合成 API/WS 的真实浏览器场景，专用配置与普通全站 e2e 分开。
pnpm --filter frontend exec playwright test --config playwright.config.chat.ts
```

`frontend` 的 `typecheck` 脚本实际调用 `vue-tsc --noEmit`，`build` 调用完整 Vite 与全部 locale 构建。专用 `vitest.config.chat.ts` 自动收集 `test/unit/chat-*.test.ts` 六个文件，共 36 项；其中 `chat-read.test.ts` 包含真实 Vue KeepAlive 缓存停表，以及停用取消请求、忽略迟到响应和重新激活后重新计算驻留的两项生命周期回归。不要换成常规 `vitest.config.unit.ts` 的全站初始化夹具来冒充这次运行。

浏览器场景不是连接真实后端的手机验收；当前专用配置使用已安装的 Edge（`msedge`）和空闲的 `61819` 端口，且不能把 trace / storageState / 令牌等会话材料装入交付包。仓库安全检查在根目录执行 `node scripts/check-spdx.mjs`；聚合 `node scripts/check-shipping.mjs` 的 Windows `pnpm.cmd EINVAL` 结果记录为检查不能完成，不能用单项通过替换其结果。

## 实际 Linux 候选镜像

本机候选验证工具在 **源码之外**：`D:\misskey\chat-pro-artifacts\candidate-linux-check`，使用说明见该目录 `README.txt`。它们绑定本次隔离资源，不是部署脚本；源码包接收者需要先准备等价的隔离运行验证环境。

```powershell
# 默认仅说明计划，不执行 Docker/DB。
& 'D:\misskey\chat-pro-artifacts\candidate-linux-check\run-candidate-check.ps1'
# 由负责候选运行的人审读后执行；可加 -KeepRunning 留成功实例继续检查。
& 'D:\misskey\chat-pro-artifacts\candidate-linux-check\run-candidate-check.ps1' -Execute
```

该流程使用 `pubo-chat-pro:candidate-20261012`、新库 `test-chat-pro-candidate` 和独立候选 Redis，拒绝复用已有同名库/容器，不改 `test-misskey`。它在容器内随机生成密钥，仅传生产子进程环境；执行全套迁移、检查健康与 UID 991 / 0700 / 0600，再通过真实 HTTP 上传 WebM/M4A/WAV，检查 MP3/波形、附件鉴权、Range 与撤回。

候选工具可验证实际 Linux 编码器和文件权限，但临时 tmpfs 不代表生产持久卷恢复验收，合成音频不代表 iPhone/Android 麦克风录音验证。真实浏览器与候选的临时账号若通过专用只读管道取得，只能留在浏览器父进程和临时 context 内存；不得手动执行会把该管道输出到终端的命令。

另有独立的持久卷测试工具 `run-persistence-check.mjs`，使用说明及资源约束见同目录 `PERSISTENCE.txt`。它使用另一新库、新 Redis 和专属 named volume，检查真实语音上传绑定后连续两次容器重启的字节、元数据和访问权限。最终 91 次断言与守卫检查通过、进程 exit 0；计数包含健康轮询，不代表 91 个独立用例，结果见 `persistence-final-result.json`。首次用户名夹具失败与受严格所有权/空库检查保护的恢复过程均保留；不要绕过同名资源保护来重跑，更不能把此测试当作生产恢复命令。测试完成后自有应用/Redis已停止，库和卷保留；真实生产备份恢复与回滚仍未验收。

真实候选浏览器脚本同样在源码之外，为该目录的 `browser-smoke.mjs`。只有候选健康、真实 HTTP 检查通过、且运行负责人确认固定隔离资源仍属本次测试后才能执行；它连接 `http://localhost:61813` 的实际编译资源、API 与 WebSocket，不启动 Vite，也不使用 API/WS mocks 或路由拦截。

```powershell
# 默认仅说明准备状态，不读账号或访问网络。
node 'D:\misskey\chat-pro-artifacts\candidate-linux-check\browser-smoke.mjs'
# 健康和隔离边界确认后，由负责人执行。
node 'D:\misskey\chat-pro-artifacts\candidate-linux-check\browser-smoke.mjs' --execute
```

该脚本以受控只读子进程管道取得两个固定合成账号，严格验证隔离数据库、合成账号与原生系统账号关联；凭据只留父进程与临时浏览器内存。当前本机 WSL 桥接和 IPv4 解析适配只作用于该脚本，换机器不能未经核对照搬。使用 3 个独立 context 验证真实 UI 发送、可见读取、回执、未读角标、编辑、撤回和私有图片读取/撤权；最终完整运行 47 项通过。结束时执行存储/Cookie 清理并关闭临时 context，不保存 storageState、追踪、截图或原始请求/响应日志；不记录凭据、用户 ID 或会话正文。

安全结果与先前失败均保留在外部目录，最终权威文件为 `browser-final-result.json`，尝试记录为 `candidate-browser-attempts.jsonl`；未捕获的精确执行时刻明确记录为时间区间。此记录不替代真实 iPhone/Android 双设备、录音、触摸耐久或生产回归验收。

所有运行记录保留原失败日志，记录命令、实际退出码、通过/跳过数量及资源范围。只有一次运行中的断言成功才能计为该次 PASS；构建成功、进程健康、桌面模拟和部署成功分别记录，不合并为真机完成。
