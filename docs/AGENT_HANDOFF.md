# PUBO / Misskey 自包含交接

## 从这里开始
本分支 `pubo-source-handoff-20261118` 是用户授权公开的 PUBO 网站后端与 H5 源码快照，不是上游原版，也不是 iOS 工程。无需原聊天或原 ChatGPT 账号即可克隆阅读。

```sh
git clone --branch pubo-source-handoff-20261118 --single-branch https://github.com/qianshou330-cyber/misskey.git
cd misskey
```

先读本文件、`AGENTS.md`、`docs/IPA_BUILD.md` 和 `docs/FIX_LOG.md`。读公开仓库不需要原账号；推送原仓库需要仓库所有者另行授予 GitHub 权限，其他人可 fork。公开源码不授予生产服务器或用户数据的访问权。

## 来源与准确性边界
源码来自已公开的 `https://bolubo.com/tarball/pubo-ios-native-push-20261102-source.tar.gz`，2026-11-18 匿名下载并核对 SHA256：`4c8e56aaa79701a90385c776b96405a82b4b8151e2fdf4c49b1d28539a83fdb6`。原归档共 3532 个文件。与原任务电脑上同名归档哈希一致；本次直接保留源文件内容，另加交接文件。逐文件来源清单见 `docs/SOURCE_MANIFEST.json`。

这是原任务最近记录的正式后端发布源码（2026-11-02 命名），不是对当前运行容器的重新导出。11 月 16 日历史只读检查记录网站及核心容器正常，同时存在磁盘空间、失败的主机服务和联邦收件错误待查。上述历史状态不是当前健康保证。本次没有连接生产服务器、改变服务、执行数据库迁移或宣称完成重新构建。

独立 Bot、生产 Nginx/Compose、数据库、上传媒体、认证材料、运行缓存与凭据不在本次快照范围内。不要把任意旧工作目录覆盖线上，也不要假定本仓库包含所有外围服务。

## 工程结构与开发
- `packages/backend`：NestJS / TypeScript 服务端、实体、API 和迁移。
- `packages/frontend`：Vue H5；`frontend-shared`、`frontend-embed`、`sw` 为相关模块。
- `packages/misskey-js`：客户端 SDK 和生成的 API 类型。
- `locales`、`packages/i18n`：语言资源；`assets`：公开资源。
- 当前包版本 `2026.9.0` 是上游基础版本，不能用于唯一标识 PUBO 发布。
- 依赖版本以 `.node-version`（26.4.0）、`package.json`（pnpm 11.25.0）和锁文件为准。

隔离开发基本流程：安装指定 Node 与 pnpm，运行 `pnpm install --frozen-lockfile`、`pnpm build`。本地配置从 `.config/example.yml` 或 Docker 示例复制，自行设置全新本地 PostgreSQL/Redis 和测试地址，再按项目说明运行 `pnpm dev`。数据库迁移只针对已确认的空测试库执行 `pnpm migrate`，不要使用生产配置。完整开发约束和按改动选择的测试以 AGENTS 和相应 skills 为准。

本次是源码归档/交接，不是功能修复；未重新安装依赖、运行全量 build、e2e 或迁移。源包一致性和路径/常见凭据模式检查已做，不能把静态扫描当作绝对无秘密保证。配置示例和明确标注的测试密钥属于公开测试数据，不能用作生产秘密。

## 接手步骤与待办
1. 先固定本分支 commit，读 FIX_LOG，确认用户当前目标。
2. 若修改网站，以这里的快照建立新分支，先运行隔离测试；如需与线上一致，必须另获生产访问并只读核对当前镜像、源包哈希和迁移状态。
3. 若修改 iOS，使用下述独立 iOS 仓库，其最新测试分支和当前未通过项以该仓库交接文件为准，不能照搬旧包的通过结论。
4. 修复后记录原因、文件、测试结果、未验项、提交和回退点；截图用合成数据，不公开真实私信、账号或认证材料。
5. 部署、生产迁移、发布签名包均需明确授权。不得弱化鉴权、私有附件、账号隔离或举报保护来让测试通过。

## 秘密与配置交付
仅提供变量名称和示例。数据库/Redis 密码、短信服务凭据、验证材料加密密钥、APNs 私钥、签名证书和 GitHub 凭据由所有者通过安全凭据库或 CI secrets 分别授予，不进入公开仓库、聊天摘录或截图。换账号后的新智能体须重新获得这些权限。真实 APNs 在历史发布中默认关闭；本次未验证现网是否改变。

## 可复制给新智能体的接手指令
> 请读取公开仓库 https://github.com/qianshou330-cyber/misskey/tree/pubo-source-handoff-20261118 ，固定该分支当前 commit，依次阅读 docs/AGENT_HANDOFF.md、AGENTS.md、docs/IPA_BUILD.md、docs/FIX_LOG.md。先报告源码范围、已验证项、未验证项和下一步，再按我随后给出的目标工作。不要假定你有原账号、生产环境或推送权限；不要读取或公开真实配置和用户数据。每次修复更新 docs/FIX_LOG.md，记录问题、原因、变更、测试、未验项及回退方法。iOS 使用文档指向的独立仓库，不要把历史 unsigned IPA 当成已签名可安装包。

## 继续未完成的 iOS 对齐修复
“继续未完成的对齐修复任务”指向独立 iOS 工程，不是把本后端快照当作最新 iOS 状态。请读取候选分支 `ui-four-tabs-148-20261112` 的最新 HEAD 并记录 commit：
- [iOS 项目约束](https://github.com/qianshou330-cyber/pubo-ios/blob/ui-four-tabs-148-20261112/AGENTS.md)
- [iOS 最新交接与待办](https://github.com/qianshou330-cyber/pubo-ios/blob/ui-four-tabs-148-20261112/docs/AGENT_HANDOFF.md)
- [iOS 每次修复记录](https://github.com/qianshou330-cyber/pubo-ios/blob/ui-four-tabs-148-20261112/docs/FIX_LOG.md)
- [实际 CI 运行](https://github.com/qianshou330-cyber/pubo-ios/actions)

本交接整理时：C67 全局失败，间歇切页/辅助功能（AX）问题未根治；C68 提交 `ccc9a06b77a2a7fd2c23d93312f6749f3a986063` 对点击动作和选中变化增加诊断，[运行 44324398470](https://github.com/qianshou330-cyber/pubo-ios/actions/runs/44324398470) 当时仍进行中，不能视作验收通过。这是时间点记录，接手必须查最新 commit、FIX_LOG 和运行结果，不能把这里的运行状态当成实时状态。
下一步：从最新失败证据区分点击未送达、选中状态未变化、页面/AX 未更新，最小化修改并重跑既有完整门槛。保留既有验收阈值，不弱化测试，不直接改 main；每次修复都记录通过、失败、未执行项和回退点。

可直接给新智能体：
> 继续未完成的 PUBO 对齐修复任务。先读 https://github.com/qianshou330-cyber/misskey/blob/pubo-source-handoff-20261118/docs/AGENT_HANDOFF.md ，再按其中的 iOS 分支链接读取最新 AGENTS、AGENT_HANDOFF 和 FIX_LOG，查询最新 commit 与 CI。先说明项目现状、未完成项、失败证据和下一步，然后在候选/修复分支继续。不要把 11 月 2 日后端快照或旧 IPA 当成最新 iOS；每次修复记录测试结果和未验项，保持既有验收门槛，不直接修改 main。公开读取无需原账号，推送、生产访问和签名发布仍需另外授权。
