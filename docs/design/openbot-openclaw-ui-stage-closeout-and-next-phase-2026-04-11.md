# OpenBot / OpenBot UI 阶段收尾与下一阶段任务

Date: 2026-04-11

## Related Docs

- 总体迁移策略：[/design/openbot-openclaw-ui-capability-migration-plan-2026-04-10](/design/openbot-openclaw-ui-capability-migration-plan-2026-04-10)
- 现状审计与任务清单：[/design/openbot-openclaw-ui-current-state-audit-and-task-plan-2026-04-10](/design/openbot-openclaw-ui-current-state-audit-and-task-plan-2026-04-10)
- 产品入口矩阵：[/design/openbot-product-entry-matrix-2026-04-11](/design/openbot-product-entry-matrix-2026-04-11)
- 早期实施复核：[/design/openbot-openclaw-ui-implementation-status-review-2026-04-11](/design/openbot-openclaw-ui-implementation-status-review-2026-04-11)
- capability parity 矩阵：[/design/openbot-ui-capability-parity-matrix-2026-04-12](/design/openbot-ui-capability-parity-matrix-2026-04-12)

## 1. 阶段结论

当前可以正式结束“浏览器 UI 第一批能力边界收口”这一实施批次。

但还不能结束整个 OpenBot / OpenBot UI 迁移项目。

最准确的当前结论是：

1. `ui/` 侧 capability seam 第一批已经落地并通过回归验证。
2. employee/workbench、settings、gateway、console、polling 这几层的主要 controller 直连已显著收口。
3. 项目级阻塞项仍然存在，尤其是 native legacy 退场正式启用、CI 结构约束扩面和 parity 验收闭环。

因此当前阶段应判定为：

- 浏览器边界收口批次：已完成
- 项目整体迁移：未完成
- legacy 删除阶段：尚不可进入

## 2. 本批已完成范围

### 2.1 已落地的 capability seam

当前 `ui/src/ui/capability/` 下已形成以下能力边界：

- `agents/`
- `agent-identity/`
- `assistant-identity/`
- `agent-skills/`
- `agent-files/`
- `channels/`
- `chat/`
- `config/`
- `cron/`
- `debug/`
- `devices/`
- `exec-approvals/`
- `gateway/`
- `logs/`
- `nodes/`
- `presence/`
- `sessions/`
- `skills/`
- `spaces/`

这些 seam 已替代浏览器 UI 外层大量直接 controller 调用。

### 2.2 已完成的关键收口

以下文件已从“直接 controller/宽状态耦合”转向“capability seam + 窄 adapter”：

- `ui/src/ui/app-render.ts`
- `ui/src/ui/app-console-actions.ts`
- `ui/src/ui/app-settings.ts`
- `ui/src/ui/app-gateway.ts`
- `ui/src/ui/app-polling.ts`
- `ui/src/ui/app-chat.ts`
- `ui/src/ui/app-chat-actions.ts`
- `ui/src/ui/app-session-actions.ts`
- `ui/src/ui/ports/employee/render-model-actions.ts`
- `ui/src/ui/ports/employee/render-model.ts`
- `ui/src/ui/ports/employee/views/workbench-stage.ts`

### 2.3 已完成的状态边界收口

以下状态边界已经从宽状态逐步收口到窄契约组合：

- `config`: `load/schema/form/save/apply/update`
- `sessions`: `load/manage`
- `chat`: `history/send/abort/event`
- `channels`: `load/whatsapp auth`
- `spaces`: `load/manage`
- `agents`: `load/tools/config-save`

同时，以下聚合层也已建立：

- `ui/src/ui/capability/view-state.ts`
- `ui/src/ui/capability/app-view-state-slices.ts`
- `ui/src/ui/app-view-state-shell-slices.ts`
- `ui/src/ui/app-port-state.ts`

### 2.4 已完成的 compatibility 字段退场

以下 deprecated metadata 已从主 settings schema 删除，不再作为主语义输入：

- `workbenchTeamObjects`
- `workbenchTeamOrder`

当前只保留兼容清理逻辑，用于读取旧持久化数据时自动 scrub：

- `ui/src/ui/storage-legacy.ts`

## 3. 已验证结果

本批收尾前已通过以下关键验证：

### 3.1 Workbench / Employee

```bash
pnpm exec vitest run \
  ui/src/ui/ports/employee/views/workbench-stage.node.test.ts \
  ui/src/ui/ports/employee/render-model.node.test.ts \
  ui/src/ui/ports/employee/render-model.boundary.node.test.ts \
  ui/src/ui/ports/employee/views/workbench-views.boundary.node.test.ts
```

结果：

- 4 个测试文件
- 46 个测试全部通过

### 3.2 Shell / Settings / Gateway

```bash
pnpm exec vitest run \
  ui/src/ui/app-settings.test.ts \
  ui/src/ui/app-gateway.node.test.ts
```

结果：

- 2 个测试文件
- 17 个测试全部通过

### 3.3 导入边界检查

```bash
node --import tsx -e "await import('./ui/src/ui/app-console-actions.ts'); await import('./ui/src/ui/app-settings.ts'); await import('./ui/src/ui/app-gateway.ts'); console.log('ok')"
```

以及：

```bash
node --import tsx -e "await import('./ui/src/ui/ports/employee/views/workbench-stage.ts'); console.log('ok')"
```

结果：

- 入口级 capability seam 导入正常
- 本批收尾前修复了 workbench compose dock 回归

## 4. 当前剩余的关键缺口

以下缺口仍然阻止项目整体收尾。

### 4.1 P0 缺口

1. native legacy shell 还没有完成构建级默认退场验证。当前代码已切成默认关闭，但还没有 release/build 层面的正式验证记录。  
   证据：
   - `apps/ios/Sources/LegacyShellPolicy.swift`
   - `apps/macos/Sources/OpenBot/LegacyShellPolicy.swift`

2. “新 UI 禁止直接依赖 legacy store / native runtime / 本地状态源”的规则虽然已开始固化到 CI，但还没有覆盖所有应观察的关键壳层与 native/build 级约束。  
   证据：
   - `scripts/check-openbot-ui-boundaries.mjs`
   - `.github/workflows/ci.yml`

3. parity test 仍然主要是局部验证，虽然已经补出 capability 迁移验收矩阵，但 gateway/native 侧还未完全闭环。  
   证据：
   - 已有局部 node/unit 验证
   - `docs/design/openbot-ui-capability-parity-matrix-2026-04-12.md`

### 4.2 P1 缺口

当前浏览器壳层未再发现明显的 system-level controller 直连残留。
现阶段 P1 已从“继续拆 seam”转为“补验收和补工程规则”。

## 5. 剩余直连面复核

本批完成后，以下关键文件里残留的 controller 直连已经明显缩小：

### 5.1 已大幅收口

- `ui/src/ui/app-polling.ts`
- `ui/src/ui/app-settings.ts`
- `ui/src/ui/app-gateway.ts`
- `ui/src/ui/app-console-actions.ts`
- `ui/src/ui/ports/employee/render-model-actions.ts`

### 5.2 仍需下一阶段处理

根据当前代码扫描，浏览器关键壳层已无显著未受控的 controller 直连残留。
后续重点是防回滑，而不是继续在浏览器壳层做大规模 seam 扩散。

下一阶段重点不再是继续拆 browser seam，而是：

- capability parity matrix
- native legacy 默认退场
- CI 约束范围扩充

## 6. 是否可以收尾

### 6.1 可以收尾的部分

以下部分可以收尾：

1. 浏览器 UI 第一批 capability seam 建设
2. employee/workbench 第一批边界收口
3. settings/gateway/console/polling 第一批 controller 去直连
4. `AppViewState` / `AppPortState` 第一批窄化

### 6.2 不能收尾的部分

以下部分不能宣称完成：

1. OpenBot / OpenBot UI 全项目迁移
2. legacy native shell 退场
3. native legacy shell 构建级默认退场验证
4. CI 级结构约束进一步扩面和固化
5. parity 验收闭环

## 7. 下一阶段建议

下一阶段建议不要继续平均扩散，而是按优先级集中推进：

### 7.1 第一优先级

1. 固化 native legacy shell 默认退场
   目标：从“有入口级 flag”推进到“默认关闭 + 构建验证”

2. 建立 CI 约束
   目标：
   - 新 UI 不直接依赖 native legacy runtime
   - 新 UI 不直接访问本地状态源
   - 新 UI 不直接跨层 import controller/store

### 7.2 第二优先级

1. 建立并维护 capability parity matrix
2. 扩大 CI 结构约束覆盖面
3. 补齐 gateway/native 验收记录

### 7.3 第三优先级

1. 为 gateway/config/channels/session/workbench 建立迁移验收表
2. 为 legacy shell 进入“只读冻结区”建立工程规则

## 8. 最终判断

当前最准确的项目判断是：

> 本批可以收尾，但项目不能结项。

更具体地说：

1. “浏览器能力边界收口”已经达到可阶段结束的标准。
2. “新旧系统混淆被结构性解决”还不能下结论。
3. 真正阻塞项目收尾的已不再是浏览器 capability seam，而是：
   - native legacy 退场机制的正式启用
   - CI 结构约束的范围补齐
   - parity test

## 9. 2026-04-11 下一阶段已执行项

以下下一阶段任务已开始落地：

1. `workbenchTeamObjects` / `workbenchTeamOrder` 已从浏览器主语义路径降级。  
   当前状态：
   - `ui/src/ui/storage.ts` 不再持久化这两项字段
   - 读取旧设置时会清理遗留字段
   - `ui/src/ui/ports/employee/render-model.ts` 不再把它们作为 workbench 主读模型输入

2. CI 结构约束已经具备第一版可执行规则。  
   当前状态：
   - 新增 `scripts/check-openbot-ui-boundaries.mjs`
   - 新增 `pnpm lint:ui:capability-boundaries`
   - `.github/workflows/ci.yml` 已接入该检查
   - 第一版主要覆盖 `app-settings/app-console-actions/app-gateway/app-polling/employee port` 的 controller 直连边界，以及 deprecated workbench team metadata 的访问禁令

3. native legacy shell 已补入口级退场开关骨架。  
   当前状态：
   - iOS：`apps/ios/Sources/LegacyShellPolicy.swift`
   - macOS：`apps/macos/Sources/OpenBot/LegacyShellPolicy.swift`
   - 统一使用 `OPENBOT_ENABLE_LEGACY_UI_SHELL`
   - 当前默认值已切为关闭，只有显式 truthy 环境变量才会启用 legacy shell

4. 第二批较轻的 controller 直连已经继续收口。
   当前状态：
   - 已 capability 化 `assistant-identity`
   - 已 capability 化 `presence`
   - 已 capability 化 `exec-approvals`
   - 已 capability 化 `skills`
   - 已 capability 化 `cron`
   - 已 capability 化 `exec-approval` event queue handling
   - `app-settings.ts`、`app-console-actions.ts`、`app-gateway.ts` 的对应直连已移除

5. 当前浏览器侧 legacy seam 主线可以视为阶段完成。
   下一批不需要继续平均清理 console/settings/gateway 小模块，而应集中处理 parity matrix、CI 范围扩充和 native legacy 默认退场。

## 10. 2026-04-12 Native 验证补充

本轮对 native legacy 默认退场做了最小验证补充，但还没有形成完整构建通过记录。

1. 入口级 gating 已确认存在。  
   证据：
   - iOS：`apps/ios/Sources/RootView.swift`
   - macOS：`apps/macos/Sources/OpenBot/MenuBar.swift`

2. iOS 构建验证当前被本地环境阻塞。  
   当前状态：
   - 本机未安装 `xcodegen`
   - `apps/ios/project.yml` 需要先生成 `OpenBot.xcodeproj`
   - 因此本轮无法执行最小 simulator build

3. macOS 构建验证当前被依赖获取链路阻塞。  
   当前状态：
   - 已确认 `xcodebuild` 与 `swift` 可用
   - 已通过 `swift build --package-path apps/macos --product openclaw-mac` 拿到 compile success
   - 期间修复了 `apps/shared/OpenBotKit` 下阻塞编译的 Swift 兼容性错误

因此，native legacy 默认退场的当前判定应为：

- 代码级默认关闭：已完成
- 入口级 gating：已确认
- macOS 构建级验证：已完成
- iOS 构建级验证：未完成，仍受本机 platform 组件约束
