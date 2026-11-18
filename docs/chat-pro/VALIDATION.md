# Chat Pro 验证记录与发布门槛

这是隔离开发候选的验证记录，不是生产上线或真机验收证明。使用本机 PostgreSQL 18 / Redis 7 的独立测试容器及合成账户；未复制真实私聊、附件或认证密钥。

## 基线与保护

- 线上 PUBO `2026.9.0`，镜像 `misskey:pubo-timeline-animation-20261010-2`；容器 2975 个白名单源码文件与发布目录逐文件哈希一致，Dockerfile 来自发布目录。
- 原 `D:\misskey\language-release` 保留全部未提交改动；实施目录为 `D:\misskey\chat-pro-work`。
- 未部署、未在生产执行 DDL / 文件迁移 / Redis 清理，未修改 Cloudflare、中继、iOS 或独立游戏。普通 Drive 的共享配额检查和 RoleService 的可选事务查询属于本轮必要共享改动。
- 本机 Node 24.20.0、pnpm 11.25.0；最终 Linux 候选使用原 Dockerfile / Node 26.4.0 单独完成完整构建，镜像和 Windows 构建分别记录。

## 已完成检查

| 检查 | 结果与证据 |
|---|---|
| 基线固定 | PASS：`production-baseline-comparison.json`，2975 文件一致 |
| 消息状态与旧未读导入纯测试 | PASS：13 项，`packages/backend/chat-pro-core-unit.log` |
| 前端队列、合并、读取、媒体与录音测试 | PASS：36 项；含真实 DOM、模拟 MediaRecorder、2请求/32等待项/100MiB预算、取消、失效与丢弃，以及 KeepAlive 停表/取消/重新激活；不能替代手机录音 |
| 私有存储、协议、语音纯测试 | PASS：22 项；Windows 无 FFmpeg 的 3 项明确 SKIPPED。独立 Docker 真实转换另有 8/8 通过 |
| 附件数据库 | PASS：12 项，含配额并发、损坏/中断恢复、共享引用保护与旧源关闭前复查 |
| 综合 HTTP / WebSocket | PASS：单连接池 7 套 48 项；含即时权限撤销、原账号/普通 Drive/全站屏蔽回归。旧附件策略随后收紧，相关两套 24 项重新通过，净新增 2 项；未将多次运行简单相加 |
| 联系人并发 | PASS：默认多连接池 5 项，包括原生屏蔽与发送竞争 |
| 共享角色与文件服务 | PASS：原 RoleService / FileServerService 两套 80 项 |
| 桌面浏览器 | PASS：真实 Edge、合成 API/WS，5 个场景；长测实数见后文 |
| Vue 全量类型检查 | PASS：最新源码 `vue-tsc --noEmit` |
| 后端全量类型检查 | BASELINE：30 条既有 Fastify 类型诊断，与生产源码基线诊断集合一致；新增 0 条，不能称为全量类型检查通过 |
| SDK 与 API 文档 | PASS：从后端 OpenAPI 重新生成 SDK，API Extractor 完成；未手改生成契约 |
| 完整 Linux 候选镜像 | PASS：原 Dockerfile 完成后端、完整多语言前端及运行镜像构建；`pubo-chat-pro:candidate-20261012`，ID `sha256:d78986ad9922d2385faaa97c752a8b3ac78511ff2f68239659bc4e823e6d44a6` |
| 候选实际运行 / 语音 HTTP | PASS：独立新库执行全部 351 份迁移、无 pending；生产模式健康启动，99 项实际 HTTP 断言通过，WebM/M4A/WAV → 真正 MP3、128峰值、鉴权/Range/幂等/撤回/无效录音配额，以及 UID991/0700/0600。此轮私有目录使用独立 tmpfs |
| 真实候选浏览器 | PASS：Edge 连接候选实际编译资源、API 和 WebSocket，未使用路由拦截或 API/WS mocks；2 个合成账号、3 个独立 context，最终完整运行 47 项断言通过，详见下文 |
| 私有持久卷连续性 | PASS：同一实际候选镜像、独立新库与 named volume，2 次真实容器重启；媒体哈希、消息绑定、元信息、鉴权和 991/0700/0600 权限保持。共 91 次断言与守卫检查，包含健康轮询，不是 91 个独立用例；也不是生产备份恢复或兼容回滚验收 |
| 新增 DDL | PASS：隔离库执行全部迁移后，3 份新迁移 `down → up` 成功 |
| 实体结构检查 | BASELINE：生产模式结构检查仅报告既有手机号索引差异；Chat 新表没有待补 DDL。测试模式附带的测试图表差异另行排除 |
| 定向 ESLint | PASS：分模块变更文件检查，含最后的接口权限与附件拒绝修复；部分原测试风格有 warning，0 errors |
| SPDX / locale safety | PASS：SPDX 2585 文件通过，未直接编辑 Crowdin 管理的中文 YAML |
| Git whitespace 检查 | 未通过：原生产 Dockerfile 的末尾空行，以及 SDK 生成器输出的 JSDoc 空格；诊断仅涉及这两个文件。未为消除提示手改生成契约，记录见 `diff-check-final.log` |
| 聚合 shipping 脚本 | SKIPPED / 检查不能完成：Windows `spawnSync pnpm.cmd EINVAL`，exit 2；单独 lint、SPDX 和 locale 检查不冒充该脚本通过 |

早先失败的运行日志保留。已修复并重跑的失败包括：普通文本附件识别、超长注册名/错误长度令牌的测试夹具、浏览器夹具心跳，以及离场动画使裁剪 DOM 短暂超过 120 条。只有 Chat 裁剪行立即释放，新消息入场动画保留，全站时间线未改。

部分 Vitest 运行在所有断言成功后输出 10 秒退出等待警告，最终 exit 0；记录为测试通过并保留清理告警，不称为零告警。

日志目录为 `D:\misskey\chat-pro-artifacts`；部分构建与前端验证日志保留在独立工作树。完整源码包不包含测试账户会话、运行配置或原始浏览器存储。

## 尚未完成的发布门槛

1. 生产私有持久卷的挂载、备份恢复与空间策略演练；本地独立 named volume 已通过两次容器重启连续性验证，不等于生产卷恢复完成。
2. 真实 iPhone Safari / Android Chrome：麦克风权限、格式互播、来电与后台中断、文件选择、动画长会话和触摸耐久。桌面三会话连接实际候选的读取、编辑/撤回和私有图片链路已通过；仍需在两台真实手机上验收这些交互，以及断线重连与账号切换。桌面、合成音频和浏览器模拟均不能替代手机验收。
3. 经授权的生产历史附件只读盘点、复制、哈希校验及维护切换演练，依据实际数据量确定窗口。隔离合成数据测试不证明生产所有引用已迁移。
4. 发布前重验登录、短信、实名审核、Deck / Widget、群聊邀请和搜索、主题流及时间线。当前只做相关定向回归，不声称全站人工回归完成。
5. 兼容回滚镜像演练。新附件切换后不能回旧公开附件版本；源码与增量包已保留，但未经实际镜像回滚测试不得称为已验收回滚包。

## 功能范围和已知限制

- 本期增强一对一站内私聊；群聊保留原生 Redis 角标、硬删除、Drive 附件和公开文件字段。群聊旧的延迟通知仍使用发送时快照，删除后可能收到旧文本通知；一对一已增加发送前复核。不能把一对一隐私与撤回结论推广为群聊验收。
- 编辑仅限原消息创建 24 小时内的纯文字，带附件的说明文字不在首期编辑范围。历史消息没有证据时状态保持 unknown；发送方显示“已发送”，提示说明历史已读未知，不显示“已读”。全部标记已读不补造历史回执。
- 数据库写入提交后才广播，但未引入持久事件 outbox。提交后进程崩溃可能漏事件，由重连、前台恢复及状态对账补齐；未执行真实进程崩溃 / Redis 中断故障注入。
- 系统推送在发送前重新核查权限和消息状态，最终校验与外部传输仍有竞争窗口；已发系统通知、已下载字节及曾公开缓存无法远程撤销。
- 浏览器待发队列只在本账户、本会话的 sessionStorage 中保留有限的待发快照；重新打开浏览器窗口不保证恢复。存储不可用时保留内存草稿并显示提示，刷新可能丢失未确认草稿。活动页会检查失效并允许移除；失效正文只留内存供复制，不延长其持久保存期限。
- 媒体预算约束传输和保留的 payload，不是浏览器总 RSS 上限。文件下载需要完整 Blob，下载租约最多保留 60 秒；语音滚离虚拟区域会停止。真实手机的大文件下载和中断体验仍待验收。
- 旧客户端的私聊 fileId 请求明确升级拒绝；旧客户端此前已经完成的公开 Drive 上传不会因此被删除。新版显式导入已有 Drive 文件也保留原公开源并提示可能公开。
- 新私有内容使用独立文件系统持久目录；多 Web 实例必须共享该目录。S3 用于原 Drive 文件导入与历史源关闭，不是本期新私有存储后端。
- 历史共享源会保留并标记可能公开。停止输出公开 URL 不等于旧 URL 已关闭；必须执行历史维护流程。已经下载的副本无法保证收回。

## 桌面浏览器实测范围

前四个场景覆盖初屏20、分页到120上限、离屏卸载、959/960双栏阈值、390px输入可见、深浅主题、遮挡750ms期间无新增已读、旧编辑事件不回退、撤回同步、断线45条后连续30条快照、私有图片认证读取与Blob释放，以及浏览器存储拒绝/迟到回执时保留后来重写的相同草稿。

长测连续收消息 180.027 秒，总计 209.031 秒，1000 条不同消息、20 次会话切换。采样最大120条窗口行、30条真实渲染消息、982个页面元素；私聊订阅峰值2（切换交接），最终1；Blob峰值2、创建21/释放21、最终0，检测到2020次入场动画。还验证了常开页面失效提示、持久存储清除与移除操作不自动重发。

证据：`frontend-browser-final.log` 与前端 `test/e2e/chat-artifacts/.../resource-metrics.json`。API和WebSocket由合成夹具提供，服务端由独立真实HTTP/Streaming套件覆盖；不能将两组证据合称为真实手机、生产网络或完整端到端上线验收。

长测后另用真实 Vue KeepAlive 夹具复现了缓存页仍执行已读轮询的问题，并补上对称启停和迟到回包代次隔离。新增两项生命周期测试通过；长测数字来自这项停表修复前的运行，不将单元测试冒充再次完整长测。

## 真实候选浏览器实测

独立 Edge 浏览器直接访问实际 Linux 候选服务与其生产编译资源，使用 2 个合成账号、3 个隔离 context，没有 API/WS mocks 或路由拦截。最终完整运行 **47 项断言通过，exit 0**：真实 UI 发送、消息送达但未查看时不标已读、实际遮挡时不标已读、露出并获得焦点后 757ms 提交读取、发送方回执和另一收件 context 的未读角标同步；UI 编辑/撤回在三端更新，并观察到真实 WebSocket 事件。私有图片经 UI 上传后三端使用 Blob 显示，匿名读取返回 401，撤回后参与者读取返回 404，三端移除图片。

该轮记录 4 次 WebSocket 连接（包括一个 context 的页面重新导航）、4 个消息事件、3 个更新事件、6 个撤回事件、8 个读取事件、265 个成功编译脚本响应、3 个成功附件读取，浏览器运行错误为 0。结束时执行 `finally` 中的存储、Cookie、凭据引用清理及三个临时 context/浏览器关闭；清理采用尽力执行，原脚本报告关闭计数，不把它另计为独立清理断言。未保存 storageState、追踪、截图、原始控制台/网络日志、凭据或会话正文。

最终权威记录为 `candidate-linux-check/browser-final-result.json`，此前五次未完成尝试保留于 `candidate-browser-attempts.jsonl`：角标选择器误计头像 span、只读账号校验最初假设用户总数恒为四（原生系统账号出现后触发拒绝）、菜单图标影响精确可访问名称。仅修正外部测试夹具，未改应用源码或认证。失败的部分通过数不与最终 47 项相加。

最终运行发生在北京时间 2026-10-13 00:04:50 脚本落盘后、00:06:37 证据记录前；原工具未记录各轮精确墙钟时刻，JSON 保留可证明的时间区间和运行顺序，不补造时间戳。这是合成账号的桌面完整连接链路，不是生产用户、真实手机或手机触摸/录音耐久验收；也没有在该候选浏览器上重复前述 180 秒合成长测。

## 主要日志

- `chat-http-stream-final.log`：7套48项综合回归。
- `chat-legacy-attachment-final.log`：最后兼容收紧后两套24项。
- `contacts-multipool-final.log`、`shared-services-final.log`、`attachment-db-final.log`。
- `attachment-show-final.log`、`attachment-pure-final.log`、`voice/runtime-final.log`。
- `packages/backend/chat-pro-sdk-delivery.log`、`packages/backend/chat-pro-session-final-typecheck.log`。
- `backend-baseline-typescript6.log`、`backend-typecheck-comparison.json`、迁移相关日志、`spdx-final.log`。
- `linux-candidate-build.log`、`candidate-linux-check/candidate-http-final.jsonl`：最终 Linux 镜像及其 99 项真实 HTTP 断言。
- `candidate-linux-check/browser-final-result.json`、`candidate-browser-attempts.jsonl`：47 项真实候选浏览器验证及早先夹具失败。
- `candidate-linux-check/persistence-final-result.json`、`persistence-result-20261012T160513309Z.jsonl`：91 项持久卷验证、两次重启和资源退出状态。

持久卷验证首次因测试管理员用户名超出原生长度限制而失败，未创建账户或附件；保留 `persistence-result-20261012T160158689Z.jsonl`。修正的只是夹具用户名。在核实原测试运行标签、镜像、挂载、四张表均空且卷无文件后恢复同一自有测试资源，没有 reset/drop/flush。最终进程 exit 0；两次重启后读取的合成 MP3 字节哈希相同，匿名和第三人仍被拒绝。最终仅停止本轮自有候选和持久化候选的应用/Redis，保留合成库与持久卷；原有本地 deploy 三个容器仍 running/healthy。主候选使用 tmpfs，停止后其媒体字节不保留，不能把残留测试库当作媒体备份。

镜像的精确源码输入为 `candidate-build-source.tar.gz`，SHA256 `4fb5896290cf12a06481f2ef67dc481697386355be2a7c2ddbabf8a8d00f8e1d`。构建后的文档补记单独进入最终交付包，不能据此称镜像内也包含最后的验证文字。

本机运行验证最初遭遇脚本路径反斜杠转换错误、WSL 新命令连接超时，以及 Windows `localhost` 优先使用的 IPv6 路径超时。首次失败日志保留；改用现存 Ubuntu 命名空间的持久测试终端后完成实际 HTTP 检查，没有重启 WSL / Docker 或其他本地容器。候选的 IPv4 与容器内健康检查通过；不把本机桥接失败记成应用断言通过。
