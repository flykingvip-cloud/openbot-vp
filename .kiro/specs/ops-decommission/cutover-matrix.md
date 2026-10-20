# Cutover Matrix: Ops → 三端归位

> 用途：作为 Phase 7 删除 Ops 前端前的**就绪门禁**。逐行确认旧 Ops 面板是否已有稳定承接面、后端依赖是否就绪、测试门禁是否满足。

## 总结门禁

| 条件                                                           | 当前状态 | 说明                                                                |
| -------------------------------------------------------------- | -------- | ------------------------------------------------------------------- |
| 共享 subnav 已从 `views/control-center.ts` 抽离                | ✅       | `ui/src/ui/views/console-subnav.ts` 已承接 `renderConsoleSubnav`    |
| 旧 Ops 主要功能已有三端承接                                    | ✅       | 渠道/设备/会话/日志/cron/exec 已分层归位                            |
| `/ops/*` 重定向方案已落地                                      | ✅       | 旧入口现统一收敛到平台承接 surface                                  |
| app-settings / polling / lifecycle / gateway 的 ops 分支已清理 | ✅       | 运行时逻辑改围绕 `platformAdvanced` / `platformSystemSettings` 运转 |
| debug 任意 RPC 入口已移除                                      | ✅       | `views/debug.ts` 仅保留只读诊断                                     |
| 相关三端/服务端测试门禁齐备                                    | ✅       | `7.6` 集中回归已完成                                                |

## 面板矩阵

| 旧 Ops 面板                                | 当前实现位置                                                                                         | 后端/协议依赖                                                                      | 测试门禁                                                                                                            | 可删除状态                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `opsIncidents`                             | 暂无一比一替代；部分信息已分散到平台总览、能力中心、治理面                                           | 无新增；依赖现有 `overview` / `health` / `usage` 投影                              | 平台/企业既有 browser tests 覆盖局部信息，不覆盖“事故总览”整体替代                                                  | ❌ 仍需 `7.1` 明确是否删除还是保留聚合面 |
| `opsRuntime` 的会话部分                    | `platformAdvanced` → “会话” tab                                                                      | `sessions.list` / `sessions.patch` / `sessions.delete` + 2.4 服务端归属过滤        | `ui/src/ui/ports/platform/advanced/page.browser.test.ts`；`pnpm build`                                              | ✅ 功能已有承接                          |
| `opsRuntime` 的节点/设备/exec 基础设施部分 | `platformAdvanced` → “设备” tab                                                                      | `device.pair.*` / `device.token.*` / `node.list` / `exec.approvals.*` + 2.7 / 2.8b | `platform/advanced/page.browser.test.ts`；`devices.self-scope.test.ts`；`session-domain.test.ts`                    | ✅ 功能已有承接                          |
| `opsLogs`                                  | `platformAdvanced` → “日志” tab                                                                      | `logs.tail`（平台专属，2.5）                                                       | `platform/advanced/page.browser.test.ts`；`pnpm build`                                                              | ✅ 功能已有承接                          |
| `opsDiagnostics`                           | 不再承接任意 RPC 调试；保留只读诊断信息即可                                                          | `status` / `health` / `models.probe` 保留，任意 RPC 调试入口已移除                 | `ui/src/ui/views/debug.browser.test.ts` + 三端 browser tests + build                                                | ✅ 安全入口已移除                        |
| `opsRecovery` 的 cron 部分                 | 企业端 `enterpriseCapabilityCenter` → `capabilities/jobs`；员工端 `settings/system` → “个人定时任务” | `cron.*` + 2.6 owner/tenant 过滤                                                   | `enterprise-surfaces.browser.test.ts`；`employee render-model.node.test.ts`；`cron/service.ownership-scope.test.ts` | ✅ 按企业/员工分层承接                   |
| `opsRecovery` 的 config/update 部分        | 平台端 `platformSystemSettings` / `platformModels` / `platformAdvanced` 分拆承接                     | `config.*` / `update.run` / `models.*`                                             | `render-actions.node.test.ts`；平台相关 browser tests；`pnpm build`                                                 | ✅ 大部分承接完成                        |
| `views/control-center.ts` 聚合入口         | 无需产品长期保留；仅其 subnav 已抽离                                                                 | 无                                                                                 | `7.0` 构建验证                                                                                                      | ✅ 已删除                                |

## 遗留共享视图删除判定

| 共享/遗留视图                             | 是否已有承接                    | 删除建议       |
| ----------------------------------------- | ------------------------------- | -------------- |
| `ui/src/ui/views/sessions.ts`             | 是，平台已承接                  | 保留共享，不删 |
| `ui/src/ui/views/logs.ts`                 | 是，平台已承接                  | 保留共享，不删 |
| `ui/src/ui/views/cron.ts`                 | 是，企业/员工已承接             | 保留共享，不删 |
| `ui/src/ui/views/nodes.ts`                | 是，平台已承接                  | 保留共享，不删 |
| `ui/src/ui/views/nodes-exec-approvals.ts` | 是，平台设备页仍复用            | 保留共享，不删 |
| `ui/src/ui/views/debug.ts`                | 平台高级页仍复用其只读诊断子集  | 保留共享，不删 |
| `ui/src/ui/views/config.ts`               | 平台系统设置仍复用              | 保留共享，不删 |
| `ui/src/ui/views/control-center.ts`       | subnav 已抽离，其余为旧聚合入口 | 已于 7.3 删除  |

## 删除前阻塞项

1. 无功能性阻塞项；若继续收口，仅剩兼容字典和文案层的低收益清理。

## 当前结论

**Phase 7 已完成当前计划内的删除与清理目标。**

理由：

- `ports/ops/**` 与 `views/control-center.ts` 已删除，孤儿桥接层已清理，路由兼容、运行时分支清理和关键三端/服务端验证都已完成。

因此，下一步可转入后续运行时/基线健康任务，或仅在确有价值时继续压缩兼容字典与历史文案。
