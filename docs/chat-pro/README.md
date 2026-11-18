# PUBO Chat Pro 实施与发布说明

本目录描述在 PUBO 定制版本上的增量实现。验证结果以 `VALIDATION.md` 为准；源码存在、构建成功和镜像启动均不代表真实手机验收完成。

隔离环境和验证命令见 [测试复现说明](TESTING.md)。测试会重建专用测试库结构，必须先核对目标资源和端口。

## 基线与源码

- 生产基线：`misskey:pubo-timeline-animation-20261010-2`，Misskey `2026.9.0`。
- 已核实镜像 ID：`sha256:c3bd50b9246b54ecb16e6733a9ba06b15d59345fc7ef043ee531708d80e77e65`。
- 当前独立开发目录：`D:\misskey\chat-pro-work`。原 `D:\misskey\language-release` 的未提交内容不用于整体覆盖线上。
- 非敏感基线归档与逐文件哈希位于 `D:\misskey\chat-pro-artifacts`。归档不包含运行配置、凭据、用户附件、数据库或会话。
- 运行容器 2975 个白名单源码文件与发布目录归档逐文件 SHA256 一致；发布目录额外的 Dockerfile 不在运行容器内。
- 保留线上手机输入适配、时间线动画与资源修复、PUBO 品牌、短信、认证和原有社交功能；群聊继续使用原页面和原生接口。
- 从官方 `2026.10.0` 精选 Chat reaction 权限/参数化查询和文件分发修复，不整体升级上游。

## 交付包

`D:\misskey\chat-pro-artifacts` 中提供完整源码 `pubo-chat-pro-source.tar.gz`、相对已核实生产源码的增量文件包 `pubo-chat-pro-incremental.tar.gz` 和可审查的 `pubo-chat-pro.patch`。`incremental-manifest.json` 列出每个变更文件的原始/新 SHA256；`delivery-summary.json` 记录归档哈希。补丁已在按原始哈希核实的基线文件副本上执行 apply check。

这些是源码产物，不包含依赖目录、构建输出、运行配置、用户文件或浏览器会话。重新构建使用精确锁文件及现有 Dockerfile。只能向重新核实的线上源码副本逐项合入；不要对保留未提交内容的 `language-release` 整体解压覆盖或直接套用补丁。

镜像实际构建输入另存为 `candidate-build-source.tar.gz` 与 `candidate-build-source-manifest.json`，便于区分编译后补充的验证文档。最终交付必须核对源代码与镜像输入一致；文档更新不冒充重新构建。

`pubo-chat-pro-verification-tools.tar.gz` 另附本机隔离候选验证工具、公开测试配置和脱敏结果，哈希见 `verification-tools-summary.json`。这些工具固定绑定本轮隔离资源，并有同名资源拒绝或所有权检查，不能直接作为生产部署脚本。包内不含测试数据库、媒体字节、凭据或浏览器存储。

## 功能和数据规则

私聊使用原账号、Chat API 和 Streaming。发送冻结正文及附件 ID，通过发送者和 `clientMessageId` 去重。相同 ID 不同请求报冲突，撤回后的重复请求不会恢复正文。

Chat 接口和流在原认证之后重新核对当前账号、令牌及对应权限，避免缓存使已撤销的 Chat 权限继续生效。复核仅适用于 Chat；不更换令牌格式、认证流程或非 Chat 接口行为。原先仅要求角色读取能力的标记已读和查看群成员操作保留该语义。

已读由新版页面提交明确消息 ID；前台、焦点、实际视口和连续 500ms 条件缺一不可。历史预取、下载、旧 WebSocket read 均不构成新版回执。`readAt` 与内容 `revision` 独立；历史消息没有阅读证据时保持 unknown，旧 Redis 标记单独显示。

编辑为作者自己的纯文字消息，带附件的说明文字不在首期编辑范围；服务器执行 24 小时限制与版本比较。撤回不限时，保留占位并撤销该消息附件授权。已发出的系统通知、已经下载的文件及旧公开缓存无法远程擦除。

联系人分组是仅本人可见的数据，一个用户可以加入多个分组。每人最多 100 个分组、每组最多 1000 个联系人。Chat 禁收暂停双方新私聊和编辑，不取消关注，不替代全站屏蔽；历史及本人撤回仍可用。

## 附件和配额

- 每条最多 10 个附件；单文件上限为 50MiB、角色上限和实例上限中的较小值。
- Chat 私有文件使用独立持久目录。生产必须设置绝对路径 `MISSKEY_CHAT_STORAGE_PATH`，不得指向公开 files/built 或实名认证资料目录。
- 原文件、图片预览、下载、HEAD 和 Range 均通过现有 Bearer 认证和 `read:chat` 权限验证；再检查会话参与者、消息与附件状态。返回 `private, no-store`，不把令牌放进 URL，不发公开下载链接。
- 浏览器使用认证读取后生成短期 Blob URL。关闭页面、取消、退出账户会释放相关资源。
- Drive、私有 Chat 字节及未完成上传预留共同计入总配额；Drive 图表仍保持原统计口径。`drive` API 额外提供 `driveUsage/chatUsage/reservedUsage`。
- 未发送附件默认 24 小时过期，配额预留有超时；清理流程可以重复执行。同一所有者相同内容可复用字节，但每条消息有独立授权，不跨账号去重。
- 语音采用 MediaRecorder 能力检测、WaveSurfer 预览，服务端有界解码并验证不超过 300 秒，再生成 MP3 与最多 128 个峰值。普通音频不会被强制转码。

## 新迁移与运行工具

新增 DDL 在 `packages/backend/migration/`：

1. `1791813354559-chat-pro-message-state.js`：消息幂等、内容版本、读取状态、历史未读提示。
2. `1791813382732-chat-private-attachments.js`：私有内容、授权引用、配额预留、历史迁移映射。
3. `1791814000000-chat-pro-contacts.js`：私密分组、成员和 Chat 禁收。

旧迁移不改。每份新迁移提供 up/down；down 仅用于空测试库演练或完成专门数据导出后的人工处理。生产回滚保留这些表和私有内容，不自动执行 down。

历史附件工具在构建后使用 `packages/backend/built/chat-attachments.js`：

```sh
node built/chat-attachments.js dryrun
node built/chat-attachments.js copy
# 只有全部相关应用写入进程和数据库连接已停止后：
node built/chat-attachments.js maintenance-cutover --writers-stopped
```

运行前确认工具加载的是目标环境配置，并已有数据库、公开文件和私有文件的可恢复备份。dryrun 使用只读事务，只输出汇总计数，不输出聊天内容、文件链接或身份材料。copy 提前复制并校验，不关闭公开源；cutover 再次锁表检查各类引用、绑定消息授权，然后只关闭确定未被其他内容使用的源及衍生文件。共享源保留，附件注明可能曾公开。

文件处理不塞进自动 DDL；脚本可重入，校验失败必须处理后重跑。`--writers-stopped` 不是替代真实维护窗口的开关；工具还检查其他数据库客户端连接。

旧未读提示使用独立工具保存，不能假造成逐条已读或精确历史数量：

```sh
node built/chat-legacy-unread.js dryrun
# 在旧写入进程已停止、Redis 标记尚未清理时：
node built/chat-legacy-unread.js import --writers-stopped
```

该工具只读 Redis，并向新增 PostgreSQL 旧未读提示表执行幂等插入。已消除的提示不会被重跑恢复；输出仅含计数。不清空 Redis、队列或现有消息。

## 发布顺序

1. 重新核实届时线上镜像和源码。只有与基线差异经过审查的文件进入候选，保留品牌、短信、认证材料与原持久卷。
2. 在隔离库完成迁移、权限、并发、多设备、历史文件迁移和原社交回归。使用合成测试数据；不复制用户私聊或密钥到开发机。
3. 构建候选镜像，验证该镜像的 FFmpeg/FFprobe 和 MP3 编码器。挂载独立 Chat 私有持久卷；不改 Cloudflare、中继、数据库/Redis服务配置或现有验证资料卷。
4. 制作数据库及文件恢复点，执行增量 DDL；在兼容环境先演练历史 dryrun/copy，依据实际数据确定维护窗口。
5. 在已安排的短暂只读窗口停止相关写入进程，保存旧未读标记，完成最终文件授权切换与旧源检查。不要清空 Redis 或队列。
6. 仅切换 web 到经过验收的兼容候选。核对服务健康、文字兼容、附件匿名/第三人拒绝访问、品牌登录及时间线行为。
7. 真机单独验收 iPhone Safari、Android Chrome 的录音权限/格式互播/中断、图片和文件、多设备已读、动画长会话与触摸耐久。桌面模拟不能替代这一项。

## 回滚边界

在私有附件切换之前，是否能回旧镜像取决于已经启用的新消息状态，必须先演练。切换之后的回滚目标必须保留私有附件鉴权、兼容序列化及新增 schema；不能直接回到会返回公开 Drive 链接的旧版本。保留新数据和文件，通过兼容修复候选回滚业务变化。

共享历史源、浏览器缓存、第三方代理和已下载副本不承诺全部收回。不能据“当前仅私聊引用”推断该文件从未公开。

## 客户端兼容

| 客户端 | 文字 | 已读 | 撤回 | 附件 |
|---|---|---|---|---|
| 新版 Web | 幂等发送、重试、编辑 | 明确 ID 读取回执 | 永久占位 | 认证读取、多附件、语音 |
| 旧版 Web/SDK | 保留收发 | 旧自动读取不产生新回执 | delete 映射撤回 | 旧 fileId 发送返回升级错误；不返回公开 file/fileId，纯附件给升级提示 |
| 原生群聊 | 保留原生流程 | 保留原有机制 | 保留原有删除范围 | 保留原有范围 |

旧客户端可能在调用 Chat 之前已经向普通 Drive 上传文件；Chat 无法替旧客户端阻止这一步，因此明确拒绝旧私聊 `fileId` 请求，不将其自动转为已发送的私有附件。新版显式导入已有 Drive 文件仍保留原公开源，并标明来源可能公开。不能仅恢复旧前端就将其称为已经验收的私密附件回滚版本。

## 依赖和许可证

新增唯一 UI 依赖为 `wavesurfer.js@8.0.2`，锁定精确版本，无新增传递依赖。BSD-3-Clause 全文位于 `licenses/wavesurfer.js-8.0.2-BSD-3-Clause.txt`。该版本发布未满仓库默认 7 天等待期，按已批准版本加了仅针对 `wavesurfer.js@8.0.2` 的例外，其他依赖规则不变。

`licenses/dependency-inventory.json` 是从本次锁定安装生成的生产依赖名称、版本及许可证元数据清单；不包含本机路径或运行配置，也不将第三方包自报的许可证视为独立法律审计。全部精确依赖以 `pnpm-lock.yaml` 为准。

Misskey 主体继续适用 AGPL-3.0-only，misskey-js 保留自身 MIT 许可。上线时提供对应修改版本的完整可构建源码、迁移、锁文件和许可证获取方式，保留现有源码入口；不把运行配置、凭据、用户文件或会话放入源码包。

Uppy、PhotoSwipe 和 Advanced Chat 没有作为依赖引入；继续复用原上传机制、主题、MFM、原生组件与媒体浏览交互。没有复制 LINE 商标或品牌素材。
