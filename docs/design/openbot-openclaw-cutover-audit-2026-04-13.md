# OpenBot / OpenBot Cutover Audit

Date: 2026-04-13

## Purpose

OpenBot 现在应被视为独立产品。

这意味着仓库里现存的 OpenBot 关联不能再被当作“默认可接受的兼容遗留”处理，而必须分层审计：

1. 哪些是对外暴露的产品耦合，必须切断
2. 哪些是协议/状态兼容层，必须降级为迁移 shim
3. 哪些是内部模块命名，短期可留、但不得继续向外暴露

这份文档只讨论“切断 OpenBot 外部关联”的收口任务，不扩展到新的 IA 或新页面规划。

## Conclusion

当前仓库仍然存在大量 OpenBot 关联，但它们不是同一类问题。

最关键的判断是：

1. `docs/`、`package.json`、native app metadata、URL scheme、Bonjour service、watch/notification 文案里仍有大量 OpenBot 对外暴露。
2. `OpenBotKit` / `OpenBotProtocol` / `OpenBotChatUI` 等共享模块命名仍被 iOS/macOS 直接使用，但这类问题属于内部模块/协议层，不应和对外 branding 问题一起粗暴替换。
3. 兼容键和值仍散落在 push payload、localStorage、Bonjour、URL scheme、App Group、旧 service name 中，这些应该收口成“只读兼容入口”，而不是继续双写双暴露。

所以切断策略必须分三层：

- P0: 先切产品外露面
- P1: 再把兼容入口收成 migration-only shim
- P2: 最后处理内部包名/模块名/仓库结构

## P0 Must Cut Now

以下属于 OpenBot 作为独立产品时，不能继续保留的对外暴露面。

### 1. Package / Repo identity

证据：

- `package.json`

问题：

- `homepage` / `bugs` / `repository` 仍指向 `gmood2008/openbot`
- `bin` 仍同时暴露 `openbot` 和 `openclaw`
- `files` 仍发布 `openbot.mjs`

结论：

- 对外 npm 包和 CLI 主入口不应继续保留 `openclaw` 作为等价品牌入口
- `openclaw` 只能降级为显式 legacy alias，不能再作为并列主入口

### 2. Native app product identity

证据：

- `apps/ios/project.yml`
- `apps/ios/Sources/Info.plist`
- `apps/macos/Sources/OpenBot/Resources/Info.plist`
- `apps/macos/Package.swift`

问题：

- iOS project / scheme / target 名仍是 `OpenBot`
- macOS package / executable / target / resource 仍是 `OpenBot`
- Info.plist 仍保留 `openclaw` URL scheme
- macOS 仍保留 `OpenBotBuildTimestamp` / `OpenBotGitCommit`

结论：

- 这些都是产品外部可见身份，必须迁到 OpenBot 名义
- 这部分不能再用“兼容”解释

### 3. Legacy discovery / deeplink exposure

证据：

- `apps/ios/project.yml`
- `apps/ios/Sources/Info.plist`
- `apps/macos/Sources/OpenBot/Resources/Info.plist`
- `apps/shared/OpenBotKit/Sources/OpenBotKit/DeepLinks.swift`
- `apps/shared/OpenBotKit/Sources/OpenBotKit/BonjourTypes.swift`

问题：

- `openclaw` deep link scheme 仍对外注册
- `_openbot-gw._tcp` 仍对外广播
- `ai.openbot.ios.bgrefresh` 仍出现在 iOS metadata

结论：

- OpenBot 作为独立产品，不应继续主动暴露 OpenBot scheme / Bonjour service / background identifier
- 如需兼容旧客户端，只能走“被动识别 legacy 输入”，不能继续主动发布 legacy 标识

### 4. Product-facing docs and links

证据：

- `docs/docs.json`
- `docs/index.md`
- `docs/start/getting-started.md`
- `docs/start/hubs.md`
- `package.json`

问题：

- 文档主站仍以 OpenBot 为标题和主入口
- 站点导航仍把 `/start/openclaw` 作为主 landing
- 仓库链接、发行链接仍全是 OpenBot

结论：

- 这是最直接的对外混淆源，必须整体改成 OpenBot 主叙事

## P1 Cut Via Compatibility Shim

以下不应继续向用户暴露，但不能直接硬删；必须先收成迁移兼容层。

### 1. Legacy storage keys

证据：

- `ui/src/i18n/lib/translate.ts`
- `ui/src/ui/device-identity.ts`

问题：

- 仍读取 `openclaw.i18n.locale`
- 仍读取 `openclaw-device-identity-v1`

结论：

- 保留读旧 key 的迁移逻辑可以
- 但新写入必须只写 OpenBot key
- 文档与代码语义上都不能再把这些 key 当主状态源

### 2. Legacy push / watch / notification payload keys

证据：

- `apps/ios/Sources/OpenBotApp.swift`
- `src/infra/push-apns.ts`
- `apps/ios/WatchExtension/Sources/WatchInboxStore.swift`

问题：

- 仍使用 `openclaw` push payload key
- watch thread/category/action identifier 仍是 `openclaw.watch.*`
- watch 标题仍显示 `OpenBot`

结论：

- 这类键值应该收口成 legacy payload adapter
- 用户可见标题和新发出的 payload key 必须改成 OpenBot

### 3. Legacy gateway service names

证据：

- `apps/ios/Sources/Gateway/GatewaySettingsStore.swift`
- `src/infra/bonjour.ts`

问题：

- 仍维护 `ai.openbot.*` service
- 仍维护 `openclaw-gw` / `_openbot-gw._tcp`

结论：

- 运行时可保留对旧 service 的识别
- 但默认广播与默认写入必须转到 OpenBot-only

### 4. Dual host global fallbacks

证据：

- `apps/shared/OpenBotKit/Sources/OpenBotKit/WebViewJavaScriptSupport.swift`
- `apps/ios/Sources/Model/NodeAppModel.swift`

问题：

- `globalThis.__openbot ?? globalThis.__openclaw`
- `globalThis.openbotA2UI ?? globalThis.openclawA2UI`

结论：

- 兼容读取可以保留一个过渡周期
- 新 host 注入必须只发布 OpenBot 名称

## P2 Internal Rename, Not First Cut

以下问题真实存在，但不应和 P0 一起粗暴处理。

### 1. Shared module names

证据：

- `apps/shared/OpenBotKit/**`
- `apps/macos/Sources/OpenBotProtocol/**`
- `apps/ios/Sources/**` 中大量 `import OpenBotKit`
- `apps/ios/Sources/Chat/ChatSheet.swift`
- `apps/ios/Sources/Model/NodeAppModel.swift`

结论：

- 这些属于内部包名和协议模块名
- 可以规划为 `OpenBotKit` / `OpenBotProtocol`
- 但必须晚于对外 surface cut，否则会把编译链和协议链同时炸掉

### 2. CLI/runtime internals

证据：

- `src/infra/openclaw-root.ts`
- `src/infra/control-ui-assets.ts`
- `src/infra/update-runner.ts`
- `src/infra/path-env.ts`

结论：

- 这里很多是运行时兼容和 root resolution
- 可以保留一段迁移期
- 但必须明确成“legacy alias handling”，不能继续散落在主逻辑里

### 3. Test fixtures and temp paths

证据：

- `src/**.test.ts`
- `apps/**/Testing.swift`

结论：

- 这些优先级最低
- 不属于用户混淆主因

## Recommended Cut Order

### Phase A: External surface cut

必须优先处理：

1. `package.json` 的对外仓库/主页/别名入口
2. `docs/` 主站与导航里的 OpenBot 主叙事
3. iOS/macOS Info.plist 与 project metadata 中的 OpenBot 产品身份
4. `openclaw` URL scheme、Bonjour service、watch 标题等用户可见或外部可探测标识

### Phase B: Compatibility downgrade

随后处理：

1. legacy storage key 只读迁移
2. legacy push payload key 只读迁移
3. legacy Bonjour/service name 被动识别
4. legacy JS host fallback 只读兼容

### Phase C: Internal package rename

最后处理：

1. `OpenBotKit` / `OpenBotProtocol` / `OpenBotChatUI`
2. native target / scheme / executable internal重命名
3. runtime helper / path / update code 中的 `openclaw-*` 内部命名

## Immediate Execution Proposal

如果按“OpenBot 已独立产品”执行，下一批应只做 P0，不扩到其他主题：

1. 切 `package.json` 对外 identity
2. 切 iOS/macOS product metadata 和 URL scheme / Bonjour 的主动暴露
3. 切 watch / notification / onboarding 里的 OpenBot 用户文案
4. 切 `docs/` 主入口和导航中的 OpenBot 主叙事

只有完成这批之后，才应该进入 P1 的 compatibility shim 收口。
