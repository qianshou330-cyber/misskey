# iOS 仓库、IPA 构建与下载

网站/H5 快照不能直接生成原生 IPA。原生 SwiftUI 工程在：
https://github.com/qianshou330-cyber/pubo-ios

当前四栏测试分支（候选，不等于验收通过）：
https://github.com/qianshou330-cyber/pubo-ios/tree/ui-four-tabs-148-20261112
先读其 `docs/AGENT_HANDOFF.md`、`docs/FIX_LOG.md`、`docs/BUILD.md` 和当前工作流。本交接整理时 C67 全局失败；C68 增加点击动作与选中变化诊断，尚无验收结论。具体时间点和最新文档入口见本仓库 AGENT_HANDOFF.md，必须查询最新分支和 CI，不应将某组通过写成整体通过。不要覆盖 main 或旧 IPA。

## 构建未签名设备 IPA
需要 macOS、Xcode 26 系列（现有记录使用 26.0.1）、iOS SDK、XcodeGen、Python 3 和 Swift。最低部署目标 iOS 17，不等于已实测最低系统。以下在 iOS 仓库内执行；实际版本和输出名从该提交的 project.yml 与打包脚本读取。

```sh
brew install xcodegen
swift test
python3 -m unittest discover -s scripts -p 'test_*.py' -v
swift scripts/brand-assets.swift
xcodegen generate
xcodebuild -project PUBO.xcodeproj -scheme PUBO -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' -derivedDataPath build/device ARCHS=arm64 ONLY_ACTIVE_ARCH=NO CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY='' build
python3 scripts/package-device.py
```

设备包输出位于 `build/unsigned/`。不能将模拟器 .app 改扩展名当 IPA。检查 Info.plist、arm64 Mach-O iOS 平台、Payload/PUBO.app、权限、版本、SHA256 和无签名状态；另做模拟器 UI 测试和真实设备验收。

现有 GitHub Actions 位于 https://github.com/qianshou330-cyber/pubo-ios/actions 。根据指定提交的工作流触发完整验证，不并发重复启动，不把打包成功当验收通过。Actions 产物可能过期且下载可能要求 GitHub 登录。

## 已有历史下载
历史预发布 0.9.4 / build138（不是当前四栏最新版）：
https://github.com/qianshou330-cyber/pubo-ios/releases/tag/v0.9.4-build138

该发布页列出源码、未签名 IPA、轻量验收包和校验文件；以页面实际资产及 SHA256 为准。历史记录 IPA 为 5,021,992 字节，SHA256 `da531c479d65d9a83dbf9e5f9fecc7d4e272cbab6af0b1441d953556525e10ff`。本次没有重新下载 IPA 或执行构建。全部发布目录： https://github.com/qianshou330-cyber/pubo-ios/releases

未签名 IPA 不能直接装在普通 iPhone，需要所有者合法 Apple 开发者签名/匹配的描述文件；证书和私钥不可公开。真机安装、覆盖升级、最低 iOS、相机/麦克风/相册权限、真实 APNs 与 TestFlight/App Store 状态须单独验证，不能用模拟器通过代替。

## 2026-11-18 匿名发布页核实
发布 API 返回上述历史资产，设备 IPA 大小与历史记录一致。直接下载地址：
https://github.com/qianshou330-cyber/pubo-ios/releases/download/v0.9.4-build138/PUBO-0.9.4-138-iphoneos-arm64-unsigned.ipa

源码： https://github.com/qianshou330-cyber/pubo-ios/releases/download/v0.9.4-build138/PUBO-0.9.4-138-source.zip

校验文件： https://github.com/qianshou330-cyber/pubo-ios/releases/download/v0.9.4-build138/PUBO-0.9.4-138-SHA256.txt
