# 私聊附件：接口、维护与验证

适用于本项目首期站内一对一 Chat。群聊仍走原 Drive 与群聊接口；本文件不声称群聊附件已经私有化。完整发布顺序见 [README.md](README.md)，最终验收记录以 `VALIDATION.md` 为准。

## 存储和权限边界

私聊新增独立私有目录，由生产环境的绝对路径 `MISSKEY_CHAT_STORAGE_PATH` 指定；必须持久化挂载，服务账号需要读写权限。服务创建目录与文件时分别采用 0700、0600。禁止使用公开 `files`、`built`、实名认证资料目录及这些目录下的子目录；拒绝经过符号链接的 Chat 存储目录。开发环境未配置时使用实例根目录下的 `chat-private`。

该目录不得配置为 Web 静态目录、对象存储公开桶或公开反向代理资源。沿用现有 Misskey 账号与令牌认证；不引入附件密码、第二套会话或公开签名链接。与实名认证资料目录、密钥没有复用关系。

新增私有字节目前采用服务器文件系统；已有 Drive 的 S3 客户端只用于导入和历史源关闭。所有服务该实例的 Web 进程必须能访问同一私有持久目录，多主机部署需要共享持久卷；不能各自挂一个不相通的空目录。

数据库分为四类记录：

| 表 | 作用 |
|---|---|
| `chat_attachment_blob` | 物理原文件与可选图片预览的私有键、所有者、大小、摘要和语音元数据 |
| `chat_attachment` | 一次上传/一次消息的授权引用；限定发送者、预定接收者、状态与过期时间 |
| `chat_upload_reservation` | 普通 Drive 与私聊上传共同使用的限时配额预留 |
| `chat_attachment_migration` | 历史 Drive 源的复制、共享判定、切换及源关闭进度；源记录删除后仍保留恢复线索 |

仅同一所有者的相同内容和附件类型复用物理内容，不跨账号去重。多个引用各有独立授权；撤回一个消息不会撤销其它消息的有效引用。绑定授权与创建消息在同一事务中完成，绑定时再次验证会话发送权限。

## API

以下路径均以 `/api/` 为前缀。POST 接口使用原生 Misskey API 认证，推荐 `Authorization: Bearer …`；上传、导入、取消和发送需 `write:chat`，元信息查询需 `read:chat`。二进制读取仅接受 Authorization 头，不接受任何 URL 查询参数。

| 请求 | 参数 | 成功结果 |
|---|---|---|
| `POST chat/attachments/create` | multipart：`file`、`toUserId`；可选 `kind=file\|voice`、`name`（最多 200 字符） | 200，暂存附件元数据 |
| `POST chat/attachments/import-drive` | JSON：`toUserId`、`fileId` | 200，复制自己已有 Drive 文件所得的暂存附件元数据 |
| `POST chat/attachments/delete` | JSON：`attachmentId` | 204，取消本人的暂存附件；不存在或不属于本人同样返回 204 |
| `POST chat/attachments/show` | JSON：`attachmentId`；`read:chat` | 200，当前授权下的受控元数据；暂存仅本人、已绑定限参与者、撤回后拒绝 |
| `POST chat/messages/create-to-user` | 在原参数基础上增加 `attachmentIds`（最多 10 个不同 ID）及可选 `clientMessageId` | 200，消息与受控附件元数据 |
| `GET/HEAD chat/attachments/:id/original` | Bearer、可选单段 Range | 原文件；普通文件以附件和 `application/octet-stream` 返回，语音为 `audio/mpeg` |
| `GET/HEAD chat/attachments/:id/preview` | Bearer、可选单段 Range | 有界 WebP 图片预览；没有预览时返回 404 |
| `GET/HEAD chat/attachments/:id/download` | Bearer、可选单段 Range | 强制下载原文件 |

上传每小时限 120 次，Drive 导入单独每小时限 120 次；取消每分钟限 120 次，元信息查询每分钟限 300 次。单个文件上限是 50 MiB、现有实例上限、用户角色上限中的较小值；按实际检测的格式执行角色上传格式限制。图片解码上限为 4000 万像素，预览最长边不超过 1600 像素；无法安全生成预览的图片保留为普通下载文件。SVG 不生成内联预览。

没有二进制签名的普通文件复用原 Drive 的 `.txt`、`.csv`、`.json` 白名单识别；已识别的二进制类型不会被文件名或浏览器 MIME 提示覆盖。其它未知类型仍按 `application/octet-stream` 检查角色权限，不能通过新增通配放行。

附件元数据如下。没有公共 URL、Drive fileId、内部存储键或认证信息：

```ts
type ChatAttachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: 'file' | 'image' | 'voice';
  durationMs: number | null;
  peaks: number[];
  width: number | null;
  height: number | null;
  hasPreview: boolean;
  legacyExposure: 'none' | 'possible';
  sourceRetainedShared: boolean;
  expiresAt: string | null;
};
```

暂存状态仅上传者本人可读取，预定接收者在绑定到已发送消息之前也无法读取。发送后仅两个会话参与者可以读取。撤回、过期、被删除的消息或无关账号不能读取。GET 与 HEAD 的所有变体、所有 Range 请求都重新鉴权，核对 `read:chat`、当前账号状态、角色阅读权限以及消息/附件授权。原生令牌还与当前账号行核对，防止轮换后的缓存滞后。

`show` 复用 Chat 的当前会话读取权限检查，再检查附件引用；原生令牌轮换、账号停用、应用令牌删除或应用 scope 撤回后，元信息同样不能通过旧认证缓存继续读取。元信息不包含内部源、键或公共链接。

二进制 GET/HEAD 的成功和错误响应均带 `Cache-Control: private, no-store`，并设置 `Vary: Authorization`、`nosniff`、限制内容的 CSP 和不发送 Referer；POST 元信息接口使用原 API 的缓存响应规则。二进制接口不会重定向到公开源。每次读取还直接检查当前应用令牌与应用权限，避开应用权限缓存滞后。缺少 Bearer 或带查询参数返回 401；作用域/账号/已轮换令牌不允许时返回 403；不可用、非参与者或已撤权资源统一返回 404。

支持 `bytes=0-99`、`bytes=100-` 和 `bytes=-100`；末尾可裁到实际文件末尾，返回 206 和实际长度。不支持多段 Range，格式错误或越界返回 416。鉴权在 Range 处理前执行，匿名者不能通过 Range 探测文件大小。

客户端先带 Bearer 读取，再生成短期 Blob URL。图片使用受控 preview，下载使用 download。私聊列表以视口及前后 600 像素缓冲区控制组件挂载，焦点和过渡动画会短暂保留行；行卸载时撤销 Blob URL、取消未完成读取并释放播放器。页面停用与退出账号会释放页面媒体，暂存上传支持取消。下载交给浏览器后，其 Blob URL 最多保留 60 秒，组件先卸载则提前释放。原生媒体标签不应直接写入要求 Bearer 的 URL，也不得把令牌拼进 URL。

同一页面运行环境中的 Chat 媒体请求共用上限：同时最多 2 个网络读取，另有最多 32 个可取消的等待项；请求结束后按顺序自动启动后续读取，等待期间不创建 Blob 或预留内容字节。传输预留与保留的 Blob 内容合计最多 100 MiB。单个预览限制为 4 MiB；原图、语音和下载按服务端元数据大小预留且不超过 50 MiB。逐块计数实际响应，因此缺失或伪造 Content-Length 不能突破该限制。完成读取后按实际大小计费，释放租约时同时撤销 Blob URL、删除强引用并归还预算。等待队列已满，或准备开始读取时内容预算不足，会提示重试；内容预算不足的请求不会继续等待。这个上限针对媒体内容字节，不等于浏览器总内存上限，图片解码、波形、DOM 与浏览器自身仍有额外开销。

## Drive 与旧客户端兼容

`import-drive` 只接受当前账号自己拥有的已存储本地用户 Drive 文件，不能导入别人的文件或远程链接。读取来自内部受控文件路径或实例当前存储客户端，不跟随用户提供的 URL。导入前验证大小，读取时验证实际大小，复制后验证摘要。

运行期导入会保留原 Drive 文件，返回 `legacyExposure: possible` 和 `sourceRetainedShared: true`。含义是该公共来源被保留且可能已经暴露，不代表其现在被证明用于其它社交内容。导入并不能把曾公开的字节变成“从未公开”。

旧客户端向 `create-to-user` 提交任何非空 `fileId` 时，服务器返回 `CHAT_CLIENT_UPGRADE_REQUIRED`，不自动导入、不创建消息或附件授权，混合文字/新附件或复用旧 nonce 也不能绕过。普通 Drive 上传发生在旧客户端发起 Chat 请求之前时，其已有公开副本无法由这个拒绝撤销；必须升级后使用私有上传。新版显式 `chat/attachments/import-drive` 继续允许复制本人已有 Drive 文件，并标记来源可能公开；原生群聊 `fileId` 流程保留。

新的 1:1 响应一律不再输出公共 `file`/`fileId`；仅附件消息给旧客户端升级提示。客户端发送重试必须沿用原请求内容、附件顺序及同一个 `clientMessageId`；相同 nonce 不同内容返回冲突。附件既不能借用其它发送者的引用，也不能改投另一接收者。

## 语音

浏览器通过 MediaRecorder 能力检测选择录音格式；服务器先读取实际文件签名，再由 Chat 的有界 FFprobe/FFmpeg 检测音频流，不调用原 Drive 检测器里没有超时限制的前置视频探测，不信任文件扩展名、浏览器 MIME 或时长。MP4/WebM/Ogg 容器只有通过“含音频、不含视频流”验证后才可持久化；仍执行角色允许格式限制。有些 Chrome WebM 没有 duration 字段，因此会有界解码到最多 301 秒的单声道 PCM，以样本数量判定真实时长；超过 300 秒拒绝，不能静默截成五分钟后发送。

接受后生成 44.1 kHz、64 kbit/s MP3，以及最多 128 个 0–1 峰值。每个后端进程最多同时转换两个录音；探测、解码、编码分别有 10/90/60 秒超时，PCM 输出与内存有上限，临时文件在结束时清理。工具仅允许 file/pipe 协议。忙碌或转换失败返回可重试错误，不返回 FFmpeg stderr、私有路径或媒体内容。

候选运行镜像必须包含 FFprobe、FFmpeg 和 libmp3lame。普通文件模式上传的音频保留原文件，不自动成为语音消息。浏览器权限弹窗、手机后台中断、iPhone/Android 互播仍需真机验收。

## 配额与清理

总使用量 = 普通 Drive 原有计费字节 + Chat 物理原文件及预览字节 + 未过期预留。`drive` API 返回总 `usage`，并额外返回 `driveUsage`、`chatUsage`、`reservedUsage`。Drive 图表继续保持原统计口径。

预留与去重/提交通过所有者级数据库锁串行化。预留有效期 30 分钟，持有有效预留与文件落库在同一事务中交换；长时间上传若预留失效则拒绝入库，不允许借超时绕过配额。普通 Drive 仍支持其原有空文件与管理员配额豁免；Chat 自身要求非空并执行限额。

未发送授权 24 小时过期，此时立即不可访问。`ChatAttachmentService` 随应用初始化注册每小时执行的清理定时器，首次清理在初始化一小时后；不需要另设 cron，也没有独立 cleanup CLI。应用停止期间不会清理。每轮移除过期授权和预留，并回收创建满 24 小时、无引用且不受迁移保护的物理 blob，每轮最多 500 个；另扫描私有目录中超过 24 小时的孤立文件与临时文件。积压、重启或存储失败可能延长回收时间，不能承诺统一的一小时物理删除期限。

取消暂存附件时，如果物理内容没有其它引用或进行中的迁移保护，会立即回收并释放配额。撤回立即撤销读取授权；物理内容仍受上述年龄和批次规则约束。迁移 copied/bound 内容在切换完成前受保护。清理失败由下个周期重试，不输出私有路径；该版本没有清理管理页面或独立的失败告警。

清理可以重跑。进程异常后残留的未入库文件、预留和暂存数据会通过期限清理。已经下载到客户端的字节和曾公开的缓存不在服务器撤回能力之内。

## 历史迁移维护流程

先完成新 schema 迁移，并保留数据库、原文件和独立私有目录的可恢复备份；工具不会创建 schema，也不会自动备份。运行时使用部署环境已配置的 Misskey 配置，不要把生产配置、私钥、令牌或会话复制进 Git。以下命令在 `packages/backend` 目录执行，要求候选 backend 已构建：

```sh
node built/chat-attachments.js dryrun
node built/chat-attachments.js copy
node built/chat-attachments.js maintenance-cutover --writers-stopped
```

1. **dryrun**：只读事务盘点仍被 1:1 `fileId` 引用的本地用户 Drive 文件，输出总量、大小、独占与共享计数，不复制、不关闭源。
2. **copy**：创建受保护的私有副本并校验大小、摘要；记录 source snapshot。可提前执行并重跑，仍不关闭原公共源。历史字节按实际计入用量，即使高于当前额度也优先保留历史；后续新上传继续受配额限制。
3. **维护窗口**：停止所有相关 Web/worker/队列写入进程及其它数据库客户端连接；这不是清空 Redis 或队列。`--writers-stopped` 只表达已安排维护，工具还检查同库其它 client 连接并拒绝带其它连接的切换。
4. **maintenance-cutover**：先补齐复制；任何复制失败就停止关闭源。对每个 source 再次校验私有字节，锁住消息、Drive 及引用表，重新分类共享引用；在同一事务中建立消息授权并清除 1:1 的旧 fileId。只有确定独占时删除旧 Drive 记录，然后关闭原文件/预览/webpublic；本地源验证不存在，对象存储删除后再 HEAD 验证 404。
5. **验收**：匿名与第三方请求旧链接、所有衍生链接及新私有接口均不得获得独占内容；共享源继续服务原头像、帖子、页面或群聊；两个会话成员可读取新副本；检查工具汇总 `failed=0` 后再次运行确认可重入。

共享判断采取保守扫描，检查群聊附件和文本、其它 Drive 记录复用的键/URL，以及数据库持久化文本、数组和 JSON 引用。因此无法确证独占的文件可能保留。检查不输出原文本、消息、附件 URL 或凭据。已知用户资料、社交内容、头像、群聊等任何引用存在时保留公共源，并在私有授权上标记 `sourceRetainedShared: true`。

进度状态 `copied` 表示私有副本完成；`bound` 表示授权与旧记录切换完成但源关闭可能尚待重试；`shared` 表示旧源保留；`closed` 表示旧源关闭验证完成。源关闭中断可从 bound 重跑，每次继续关闭之前再次验证私有副本摘要；损坏时保留尚未删除的原字节。不能人工清空迁移表来“重置进度”。工具只输出汇总并在失败时返回非零退出码；定位时由授权运维人员核对映射状态，不向公共日志输出附件内容或敏感配置。

工具不启动完整 Nest、Web、Redis、定时任务或队列；使用单连接、关闭同步建表、禁用自动 dropSchema 与查询日志。不要在其它后台还会重连时运行切换。对大量历史数据应在隔离环境先评估扫描和锁表时间；该初版工具不承诺在线零停机迁移。

源数据库引用只能证明当前用途，不能证明文件从未被公开分享。浏览器、CDN、第三方代理和既有下载缓存无法由本工具全部回收。本工具不擅自修改 Cloudflare 或代理设置；上线验收应单独记录旧缓存边界。

## 回滚

DDL 文件 `1791813382732-chat-private-attachments.js` 提供 up/down。down 仅允许私有 blob 与迁移映射都为空；已有数据时主动拒绝，以免静默删除历史或重新公开文件。其它新 Chat schema 的回滚约束见其迁移。

切换前可在隔离环境演练备份恢复。切换后回滚业务代码必须选仍认识私有附件表、撤回状态、受控接口以及隐藏旧 file/fileId 的兼容版本，保留私有文件卷和新表。不要恢复到会再次公开旧 Drive 链接的旧镜像，不要自动执行 down，也不要把私有副本移回公共 files 目录。

## 可重复验证

这些命令只适用于已经配置好的独立测试库。测试包含 drop/synchronize，绝不能指向生产或其它项目数据库；各 DB 套件串行运行，避免同时重置 schema。

```sh
# 无数据库：媒体 HTTP 协议、路径限制、峰值和可用时的真实 FFmpeg
node node_modules/vitest/vitest.mjs run --config vitest.config.ts src/server/ChatAttachmentServerService.test.ts src/core/ChatAttachmentService.test.ts src/core/ChatAttachmentStorageService.test.ts src/core/ChatVoiceService.test.ts

# 自行管理单连接隔离库：配额、事务、级联、历史共享引用与重跑
node node_modules/vitest/vitest.mjs run --config vitest.config.chat-private.ts

# 真实服务与数据库：multipart、权限、绑定、nonce、导入、撤回、Range
node node_modules/vitest/vitest.mjs run --config vitest.config.e2e.ts test/e2e/chat-pro-attachments.ts

# schema up/down/up 与 pending DDL 检查按发布文档中的隔离环境流程运行
pnpm check-migrations
```

附件专项本轮记录如下；后续公共鉴权调整与最终综合重跑以 `VALIDATION.md` 为准，不把不同运行中的结果相加成一轮全站测试：

| 验证 | 结果 | 范围 |
|---|---|---|
| Windows 纯单测 | 22 通过、3 跳过 | 媒体路由、路径、MIME/角色限制、语音峰值；跳过项依赖本机 FFmpeg |
| 真实数据库附件测试 | 12/12 通过 | 配额并发、原子绑定、账户级联、过期清理、共享源、校验失败和迁移中断恢复 |
| 真实附件 HTTP | 7/7 通过 | 多附件、show 元信息与读取 ACL、应用 scope 撤回、原生令牌轮换、令牌删除、撤回与 Range |
| 原 Drive HTTP 回归 | 4/4 通过 | 原上传及关联帖子行为 |
| 隔离容器实际语音检查 | 8/8 通过 | 无 duration WebM、WAV→MP3、300 秒接受、301 秒拒绝、有界峰值、PCM 清理、伪装视频拒绝、转换并发上限 |

Windows 跳过项不能计作通过。容器检查使用无网络、只读临时容器运行实际 ChatVoiceService；仍须对最终候选镜像重做这一项，它不替代手机麦克风、触摸或长会话验收。后端构建、测试构建与本模块 ESLint 已通过。

## 当前实现限制

多附件按文件分别上传、显示进度并支持失败重试和取消，全部成功后随同一消息原子绑定；不是一次 multipart 批量提交。发送后重试固定附件顺序与 nonce。暂存附件超过 24 小时后不能继续发送；活动页面每 30 秒以及恢复时检查队列期限，实际重试前还会再次检查。满期或服务端已判定附件不可用的请求标为失效，禁止用同一快照继续重试。失效正文保留在当前页面内存中供复制，用户需重新选择附件；失效内容不再写回会话存储，因此刷新应用后不保证仍有正文。已失败或失效的项可明确丢弃，并尝试取消其尚未绑定的附件，正在发送的项不能丢弃。该队列状态层已通过 13 项定向单测，最终客户端重跑以 `VALIDATION.md` 为准。

下载与展开原图仍须先完整读取 Blob，受上述全局内容预算限制；不支持直接向磁盘流式保存。当前没有独立的下载取消按钮，离开页面或滚离导致组件卸载会中断读取；浏览器已经接管的下载由浏览器管理。下载 Blob 的 60 秒保留期会暂时占用预算，超限时需要等待释放或卸载该行再重试。语音同时只播放一个，但滚动使行卸载时会停止该行播放；没有保持屏幕外播放的独立播放器。

新私有内容仅支持共享文件系统目录，未实现私有 S3 后端；已有 S3 Drive 源的复制/关闭路径已实现，但尚未完成候选部署环境的对象存储实测。迁移和回滚不提供零停机或自动恢复公共源能力，必须按上述维护和兼容回滚流程执行。手机录音/播放/下载、历史实际数据体量、旧缓存边界属于待验收项，而非已完成证明。

必须覆盖的发布门槛：第三人/匿名/无作用域/已撤销令牌拒绝；头像与群聊共享源不被删；旧 file/fileId 不暴露；双设备回执/编辑/撤回；并发配额、nonce 与禁收；迁移中断重跑；空库 up/down/up；数据库 schema 无待补差异。单纯部署成功不满足这些验收条件。
