# OpenBot UI Capability Parity Matrix

Date: 2026-04-12

## Related Docs

- 总体迁移策略：[/design/openbot-openclaw-ui-capability-migration-plan-2026-04-10](/design/openbot-openclaw-ui-capability-migration-plan-2026-04-10)
- 现状审计与任务清单：[/design/openbot-openclaw-ui-current-state-audit-and-task-plan-2026-04-10](/design/openbot-openclaw-ui-current-state-audit-and-task-plan-2026-04-10)
- 阶段收尾与下一阶段：[/design/openbot-openclaw-ui-stage-closeout-and-next-phase-2026-04-11](/design/openbot-openclaw-ui-stage-closeout-and-next-phase-2026-04-11)

## 1. Purpose

这份矩阵只服务于当前主旨任务：

1. 确认 legacy 能力是否已经迁入 capability seam
2. 确认新 UI 是否已经从关键壳层文件切断 direct controller 依赖
3. 给迁移验收提供明确的 parity gate

它不承接新的 IA、首页或四端扩张需求。

## 2. Capability Mapping

| Legacy Source                                                | New Capability                     | Reuse | Rewrite | Current Status | Notes                                                     |
| ------------------------------------------------------------ | ---------------------------------- | ----- | ------- | -------------- | --------------------------------------------------------- |
| `controllers/gateway` + shell gateway flow                   | `capability/gateway`               | ✔     |         | Partial        | 浏览器入口已切 seam，native fallback 仍存在               |
| `controllers/config`                                         | `capability/config`                | ✔     |         | Covered        | 已拆为 `load/schema/form/save/apply/update`               |
| `controllers/channels`                                       | `capability/channels`              | ✔     |         | Covered        | 已拆为 `load/whatsapp auth`；Nostr profile 仍为页面流程   |
| `controllers/chat`                                           | `capability/chat`                  | ✔     |         | Covered        | 已拆为 `history/send/abort/event`                         |
| `controllers/sessions`                                       | `capability/sessions`              | ✔     |         | Covered        | 已拆为 `load/manage`                                      |
| `controllers/spaces`                                         | `capability/spaces`                | ✔     |         | Covered        | employee/workbench 已切 seam                              |
| `controllers/agents`                                         | `capability/agents`                | ✔     |         | Covered        | 已拆为 `load/tools/config-save`                           |
| `controllers/agent-identity`                                 | `capability/agent-identity`        | ✔     |         | Covered        | settings/console 已切 seam                                |
| `controllers/agent-skills`                                   | `capability/agent-skills`          | ✔     |         | Covered        | settings/console 已切 seam                                |
| `controllers/agent-files`                                    | `capability/agent-files`           | ✔     |         | Covered        | list/content/save 已独立                                  |
| `controllers/assistant-identity`                             | `capability/assistant-identity`    | ✔     |         | Covered        | app shell 已切 seam                                       |
| `controllers/presence`                                       | `capability/presence`              | ✔     |         | Covered        | app shell 已切 seam                                       |
| `controllers/skills`                                         | `capability/skills`                | ✔     |         | Covered        | console/settings 已切 seam                                |
| `controllers/exec-approvals`                                 | `capability/exec-approvals`        | ✔     |         | Covered        | shell 直连已收口                                          |
| `controllers/exec-approval` event bridge                     | `capability/exec-approval`         | ✔     |         | Covered        | gateway event handling 已迁入 seam                        |
| `controllers/cron`                                           | `capability/cron`                  | ✔     |         | Covered        | console/settings 已切 seam；render 仍保留只读 helper 直连 |
| `controllers/debug`                                          | `capability/debug`                 | ✔     |         | Covered        | polling/settings/gateway 已切 seam                        |
| `controllers/logs`                                           | `capability/logs`                  | ✔     |         | Covered        | polling/settings 已切 seam                                |
| `controllers/nodes`                                          | `capability/nodes`                 | ✔     |         | Covered        | polling/settings/gateway 已切 seam                        |
| `controllers/devices`                                        | `capability/devices`               | ✔     |         | Covered        | load/manage 已拆开                                        |
| iOS/macOS legacy shell                                       | `LegacyShellPolicy` gated fallback |       | ✔       | Partial        | 已有默认关闭策略；仍需 release/build 验证                 |
| `workbenchTeamObjects/workbenchTeamOrder` persisted metadata | compatibility cleanup only         |       | ✔       | Covered        | 已从主 schema 删除，只保留清理逻辑                        |

## 3. Parity Matrix

| Capability                     | Legacy Source                           | New Seam                                          | Primary Entry Files                                                                              | Parity Status | Verification                                                                                                        |
| ------------------------------ | --------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------- |
| Gateway                        | browser gateway shell + native fallback | `ui/src/ui/capability/gateway/`                   | `ui/src/ui/app-gateway.ts`, `ui/src/ui/app-lifecycle.ts`                                         | Partial       | `ui/src/ui/app-gateway.node.test.ts`                                                                                |
| Config                         | `controllers/config.ts`                 | `ui/src/ui/capability/config/`                    | `ui/src/ui/app-settings.ts`, `ui/src/ui/app-render.ts`, `ui/src/ui/app-console-actions.ts`       | Covered       | `ui/src/ui/controllers/config.test.ts`, `ui/src/ui/app-settings.test.ts`                                            |
| Channels                       | `controllers/channels.ts`               | `ui/src/ui/capability/channels/`                  | `ui/src/ui/app-channels.ts`, `ui/src/ui/app-settings.ts`, `ui/src/ui/app-render.ts`              | Covered       | `ui/src/ui/app-settings.test.ts`                                                                                    |
| Chat                           | `controllers/chat.ts`                   | `ui/src/ui/capability/chat/`                      | `ui/src/ui/app-chat.ts`, `ui/src/ui/app-chat-actions.ts`, `ui/src/ui/app-render.ts`              | Covered       | `ui/src/ui/controllers/chat.test.ts`, `ui/src/ui/app-chat-actions.test.ts`                                          |
| Sessions                       | `controllers/sessions.ts`               | `ui/src/ui/capability/sessions/`                  | `ui/src/ui/app-render.ts`, `ui/src/ui/app-session-actions.ts`                                    | Covered       | `ui/src/ui/controllers/sessions.test.ts`, `ui/src/ui/app-session-actions.test.ts`                                   |
| Workbench                      | employee/workbench shell                | `ui/src/ui/app-port-state.ts` + capability slices | `ui/src/ui/ports/employee/render-model.ts`, `ui/src/ui/ports/employee/views/workbench-stage.ts`  | Covered       | `ui/src/ui/ports/employee/render-model.node.test.ts`, `ui/src/ui/ports/employee/views/workbench-stage.node.test.ts` |
| Spaces                         | `controllers/spaces.ts`                 | `ui/src/ui/capability/spaces/`                    | `ui/src/ui/app-settings.ts`, `ui/src/ui/ports/employee/render-model-actions.ts`                  | Covered       | `ui/src/ui/controllers/spaces.node.test.ts`, `ui/src/ui/ports/employee/render-model.boundary.node.test.ts`          |
| Agents                         | `controllers/agents.ts`                 | `ui/src/ui/capability/agents/`                    | `ui/src/ui/app-settings.ts`, `ui/src/ui/app-gateway.ts`, `ui/src/ui/app-console-actions.ts`      | Covered       | `ui/src/ui/controllers/agents.test.ts`                                                                              |
| Debug / Logs / Nodes / Devices | console-only legacy flows               | dedicated seams                                   | `ui/src/ui/app-polling.ts`, `ui/src/ui/app-settings.ts`, `ui/src/ui/app-console-actions.ts`      | Covered       | `ui/src/ui/app-settings.test.ts`, `ui/src/ui/app-gateway.node.test.ts`                                              |
| Native Legacy Shell            | iOS/macOS legacy entry shell            | env-gated fallback                                | `apps/ios/Sources/LegacyShellPolicy.swift`, `apps/macos/Sources/OpenBot/LegacyShellPolicy.swift` | Partial       | macOS compile verified; iOS still blocked by missing watchOS platform                                               |

## 4. Migration Acceptance Gates

只有同时满足以下条件，当前迁移主线才可判定为完成：

1. 浏览器关键壳层文件的 direct controller import 被 boundary script 覆盖并通过。
2. `workbenchTeamObjects` / `workbenchTeamOrder` 不再出现在主 settings schema 和读模型路径中。
3. iOS/macOS legacy shell 默认关闭，只能通过 `OPENBOT_ENABLE_LEGACY_UI_SHELL` 显式开启。
4. 至少 `gateway/config/channels/chat/sessions/workbench` 六类能力都有对应验证入口。
5. 阶段文档与代码状态一致，不再把已删除的兼容字段当作待办。

## 5. Remaining Gaps

当前仍未完全通过的点只有两类：

1. `gateway` parity 仍是 partial。
   原因：浏览器 seam 已完成，但 native fallback 与 release/build 验证还未形成完整闭环。

2. native legacy shell 仍缺少构建级验证。
   原因：
   - macOS 已完成 `swift build` 编译验证
   - iOS 已生成 `OpenBot.xcodeproj` 并完成 Xcode first-launch 与 iOS simulator platform 安装
   - 当前剩余阻塞是 `OpenBot` scheme 包含 embedded Apple Watch app，仍缺 `watchOS 26.4` platform

## 6. Recommended Closeout Order

1. 先把 boundary script 和阶段文档一起固定，避免后续回滑。
2. 再做 native release/build 侧验证，确认默认退场不会引入入口回归。
3. 验证完成后，再考虑更上层的信息架构或首页任务。
