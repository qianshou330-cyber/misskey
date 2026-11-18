# PUBO 联机贪吃蛇部署与运维

本文对应首版独立服务 `services/snake-game` 和 2026-10-28 发布工具的实际设计。游戏入口默认关闭；文档、自动化测试或隔离压测通过均不代表已经向用户开放。截至本说明交付时，**不同网络真人联机验收尚未完成**。最终部署、压测和启用结果以该批次验收回执及项目交接文件为准。

## 架构与业务边界

- `/games` 增加游戏入口，`/games/snake` 提供页面。访客使用现有 PUBO 登录流程，不创建另一套账号。
- 已登录用户通过 `POST /api/games/snake/session` 取得有效期 60 秒、一次使用的游戏票据。沿用现有登录、停用账号、迁移账号和 `read:account` 权限检查；接口限制每分钟 12 次、间隔至少 1 秒。
- 浏览器仅向同源 `/games/snake/socket.io/` 发送游戏票据，使用 WebSocket；不向游戏服务发送 Misskey 登录令牌。
- 独立 Node 服务负责 30 Hz 权威模拟、15 Hz 状态广播和有序食物增量。游戏状态仅在内存中，不访问 PostgreSQL、Redis 或 Bot SQLite。
- 默认最多 20 名真人，可通过服务配置调低到 1–20；电脑数量为 `min(5, max(0, 6 - 真人数))`，明确标注“电脑”。无人时清空场景并停止模拟。断线结束本局，死亡后须手动重开。
- 食物最多 360 个、每条蛇最多 160 节；客户端输入最多每秒 20 次，仅包含方向、加速和序号。500 ms 没有有效输入时服务端解除加速。

本次发布只涉及新增游戏页面、票据接口、独立游戏容器及对应 WebSocket 反向代理路由。现有 Bot、欢迎页、品牌、短信认证、私信及附件权限、其他小游戏、全部 11 项榜单调度均属保护范围。不得修改 Cloudflare、中继、数据库／Redis 服务配置、APK、iOS；不得以恢复旧数据库或发送账本的方式回退游戏。

## 源码、依赖与许可

游戏机制基于 [m0Corut/snake-io-multiplayer](https://github.com/m0Corut/snake-io-multiplayer/tree/474db86fadce1bed2dbc8019b5c5415ce5a6d714)，固定提交 `474db86fadce1bed2dbc8019b5c5415ce5a6d714`。原 MIT 许可和版权声明保存在 `services/snake-game/LICENSE`，改编文件及来源记录在 `services/snake-game/UPSTREAM.json`。PUBO 重新实现认证、连接管理、资源上限与测试，保留移动、增长、加速消耗和环形地图机制，未接入道具系统。

独立服务使用 Socket.IO 4.8.3，浏览器使用同版本官方 MIT ESM 文件及许可，均由本站提供。服务依赖由自身 `package-lock.json` 固定；不要在 Misskey 工作区根目录安装或更新服务依赖。

```sh
cd services/snake-game
npm ci --workspaces=false --ignore-scripts --no-audit --no-fund
npm test --workspaces=false
```

测试命令先执行严格 TypeScript 构建。更详细的服务协议及隔离负载工具用法见 `services/snake-game/README.md`。

## 配置与资源限制

首版服务器发布目录为 `/opt/misskey/snake-multiplayer-20261028`。该目录中的 `snake-release.py`、`compose.game.yml`、镜像清单与验收回执属于受控发布工件；脚本校验固定基线和工件哈希，不能直接当作后续版本的通用升级脚本。

| 层级 | 配置 | 作用 |
| --- | --- | --- |
| Web | `PUBO_SNAKE_ENABLED=true` | 允许评估游戏开关；缺省关闭 |
| Web | `PUBO_SNAKE_TICKET_SECRET_FILE=/run/pubo-snake/ticket.key` | 指向只读共享密钥文件 |
| Web | `PUBO_SNAKE_ENABLED_FILE=/run/pubo-snake/enabled` | 只有文件内容恰为 `enabled` 加换行时才签发票据 |
| 游戏 | `SNAKE_TICKET_SECRET_FILE=/run/pubo-snake/ticket.key` | 读取相同原始密钥字节，不去除空白、不解码 |
| 游戏 | `SNAKE_PUBLIC_ORIGIN=https://bolubo.com` | 精确验证浏览器 Origin |
| 游戏 | `SNAKE_MAX_HUMANS=20` | 容量上限，合法范围 1–20 |
| 游戏 | `HOST=0.0.0.0`、`PORT=3021` | 容器内监听地址 |

密钥为 32–4096 个原始随机字节。部署工具创建 48 字节文件，宿主目录 `/opt/misskey/snake-private` 权限 0700，文件权限 0400，所有者 UID/GID 991。Web 和游戏容器只读挂载该目录；凭据不进入源码、镜像层、日志、验收回执或公开源码包。不要打印密钥、票据、账号令牌或完整请求认证内容。

`compose.game.yml` 使用独立内部网络，容器名 `pubo-snake-game`，UID/GID 991:991、只读根文件系统、移除全部 Linux capabilities、禁止提权、64 个进程上限，限制 1 CPU、512 MiB 内存且不增加交换额度。Node 堆上限为 384 MiB。仅发布 `127.0.0.1:3150:3021`；Nginx 只为 `/games/snake/socket.io/` 转发该端口，不公开 `/health` 和 `/metrics`。

## 首次部署与启用

先完成服务、前端、票据接口测试及实际浏览器验收，冻结源码、构建、公开源码包和回执；将对应工件传入新的受限发布目录。保留所有旧目录、未提交改动、旧镜像及原始回执。

首版工具在服务器固定目录内以 root 执行；省略 `--execute` 仅返回所选模式，不代表通过实际校验：

```sh
cd /opt/misskey/snake-multiplayer-20261028
python3 snake-release.py preflight --execute
python3 snake-release.py build --execute
python3 snake-release.py activate-disabled --execute
python3 snake-release.py sample --execute
```

这些步骤不是允许忽略中间结果的一键命令序列。每步须检查其唯一命名回执，失败时先保留状态并查明原因，不能删回执重跑。

`preflight` 核对原 Web、受保护容器、配置和榜单调度；`build` 核验冻结包并构建 Web 候选；`activate-disabled` 要求真实隔离 HTTP、浏览器、20 真人连接持续 30 分钟及低人数电脑场景验收证据。部署时仅替换经过核验的 Web，启动独立游戏容器，增加专用代理路由和只读密钥挂载；**此时不创建 enabled 文件，入口仍关闭**。

开放前还须完成不同网络真人联机测试、部署后关闭状态检查及游戏健康检查，并形成绑定候选镜像和实际证据的 `enable-acceptance.json`。这些结果不能由模拟客户端、同一台机器的多个浏览器或人为填写 PASS 代替。证据齐全后使用：

```sh
python3 snake-release.py enable --execute
```

`enable` 原子创建开关文件，不重启 Web。游戏列表和页面在进入时刷新公开开关；已有页面可能需重新进入。脚本不提供跳过门禁选项，也没有自动回退模式。

## 日常检查、启动与停止

只读检查可使用：

```sh
curl --fail --silent --show-error http://127.0.0.1:3150/health
curl --fail --silent --show-error http://127.0.0.1:3150/metrics
docker logs --tail 100 pubo-snake-game
```

`/metrics` 仅含聚合数字，包括当前人数、食物和蛇身上限、完整 tick 工作耗时 p95、事件循环延迟、RSS、堆使用和 CPU。连接少时有电脑不代表真人；停止模拟时 `running=false`、真人和电脑均为 0。避免启用 Socket.IO 认证调试日志。

维护时先关闭入口，再停止独立游戏服务。以下操作仅删除固定的开关标记，保留密钥和验收记录：

```sh
unlink -- /opt/misskey/snake-private/enabled
docker compose -f /opt/misskey/snake-multiplayer-20261028/compose.game.yml stop game
```

标记原本不存在时 `unlink` 会报错，应确认已关闭而不是改用递归删除。关闭入口立即阻止新票据签发，但已连接的对局在停止容器前仍可能运行。停止或重启服务会结束所有当前对局，不会恢复旧生命。

```sh
docker compose -f /opt/misskey/snake-multiplayer-20261028/compose.game.yml start game
```

上述启动仅启动已有容器，不开放入口、不构建或拉取镜像。先核对镜像 ID、资源限制、只读挂载、健康状态和业务保护项。维护后的重新开放应记录新的复核证据及操作回执；首版 `enable` 是一次性发布动作，已有 `enabled.json` 后不可删除回执来重跑。服务启动秒及之前签发的票据全部失效，玩家稍候点击重新进入取得新票据。

## 升级、回退和故障定位

升级从已验证源码建立新目录，保留旧目录和未提交改动。重新固定依赖、运行相关测试、生成 SDK 与前端产物、冻结源码和镜像清单；使用新的发布批次和对应实际基线，不修改已冻结文件后沿用旧验收。模拟器或广播逻辑变更须重新运行受限资源负载验收，不能借用旧版本的压测结果。

优先故障处置为关闭游戏入口并停止该游戏容器，PUBO 其他功能继续运行。需要换回旧游戏镜像时，先在隔离环境核对其协议与当前 Web 兼容，再在关闭状态下按新的受控回退记录操作。游戏没有数据库迁移或持久对局数据可恢复，**禁止恢复旧数据库、Redis 数据、Bot 状态库或发送账本**。Web 回退也必须核对当前镜像、配置和全部保护项，不能直接用旧工作目录覆盖线上。

| 现象／代码 | 检查与处理 |
| --- | --- |
| 入口不显示、`SNAKE_GAME_UNAVAILABLE` | 检查 enabled 标记是否存在且为精确 8 字节、Web 环境开关、只读文件挂载及 UID 991 读取权限；不能用修改数据库开启功能 |
| `FULL` | 真人连接达到当前容量，等待空位；死亡但未离开的玩家仍占连接位 |
| `DUPLICATE` | 同账号仍有另一连接，先退出另一页面；不能踢掉别人或复用旧票据 |
| `TICKET_EXPIRED`／`TICKET_REPLAY`／`TICKET_BEFORE_BOOT` | 点击重新进入取得新票据；启动秒内的票据需稍后重取；不得自动循环重连旧票据 |
| `TICKET_INVALID` | 核对 Web／游戏使用同一只读原始密钥、时钟及镜像协议；不要输出密钥或票据排查 |
| WebSocket 连接失败 | 检查游戏健康、专用 Nginx 路由、精确 Origin、浏览器网络；不要开放整个游戏端口或放宽跨域来绕过检查 |
| 方向正常但加速停止 | 输入受每秒 20 次上限约束；后台标签页或 500 ms 无有效输入会解除加速，蛇身不足也不能持续加速 |
| 食物不同步 | 客户端发现版本跳跃会请求完整食物快照；持续故障保留聚合日志并停止该连接，不能让客户端决定分数或食物 |
| RSS／CPU 上升或卡顿 | 检查实际人数、完整 tick p95、RSS/heap 趋势、事件循环延迟及容器 OOM；超出验收范围先关闭游戏入口，不提高限制掩盖问题 |
| 发布工具拒绝哈希或保护项 | 视为当前环境与验收不一致，保留回执和现场；重新只读核对并制定新批次，不能删门禁、改 PASS 或恢复旧业务数据 |

隔离压测只连接独立内部网络，使用独立受限密钥，不访问生产账号数据。20 人场景须真实持续至少 1800 秒，另做 1 真人／5 电脑场景；检查客户端实际接收速率、无意外断线、食物连续性、完整 tick p95、1 CPU／512 MiB 上限及预热后的内存趋势。短时冒烟、零玩家静置和普通浏览器截图都不能替代该证据。
