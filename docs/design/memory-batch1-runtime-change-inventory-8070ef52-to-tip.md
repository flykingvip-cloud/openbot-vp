# Memory Batch1 — 运行时变更完整清单（附录）

## 起止 SHA 约定（固定）

| 项                 | 值                                                                           |
| ------------------ | ---------------------------------------------------------------------------- |
| 起点（**含**）     | `8070ef52e04bd0331ab113bdb15b090247b329c6`（短：`8070ef52`）                 |
| 终点（**含**）     | `578b3a7de134d98a305fa077a58cd05145bb3bf4`（短：`578b3a7d`；本清单冻结 tip） |
| 等价 git 范围      | `8070ef52^..578b3a7d`（=`8070ef52~1..578b3a7d`）                             |
| **不含**起点的范围 | `8070ef52..578b3a7d`（少 1 个仅属 base 提交的文件）                          |

正文与生成命令必须使用同一约定：**含** `8070ef52`，故命令为 `git diff --name-only 8070ef52^..<tip>`，**不要**再写成「8070ef52→tip」却用 `8070ef52..HEAD`。不必为审查改写 git 历史。

主审查文：`docs/design/memory-batch1-check-green-review-2026-10-26.md` §4。

文件总数：**368**（`git diff --name-only 8070ef52^..578b3a7d`；含起点提交触及的文件）。

### 审查状态枚举

| 状态                          | 含义                                                         |
| ----------------------------- | ------------------------------------------------------------ |
| 已审通过（执行者自检）        | 清单执行者分类/对照 diff 自检，**尚未**经审核 Agent 书面确认 |
| 已审通过（审核 Agent 已确认） | 审核 Agent 已在主审查文或本附录明确签收                      |
| 待审                          | 仍待审核 Agent                                               |
| 不再需要（非运行时审批项）    | 文档/规格等，不挡运行时放行                                  |

## 导航

| 类别                     | 数量 | 节                                      |
| ------------------------ | ---: | --------------------------------------- |
| 纯格式                   |   46 | §A                                      |
| 无运行时影响的类型清理   |    3 | §B                                      |
| 已单独批准的 UI 文案变更 |    2 | §B2                                     |
| 任务元数据               |    1 | §B3                                     |
| 测试夹具修正             |   68 | §C（含误入 §F 的 `*.evidence.test.ts`） |
| 运行时逻辑变化           |   13 | §D（细则亦在主文）                      |
| 检查规则变化             |    3 | §E                                      |
| 文档/证据/规格           |  229 | §F                                      |

## A. 纯格式

| 路径                                                               | 归类依据 / 备注                                               | 审查状态               |
| ------------------------------------------------------------------ | ------------------------------------------------------------- | ---------------------- |
| `skills/web-extract-html-pdf/scripts/print-pdf.mjs`                | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/account-computer/browser-plan-once-wire.ts`                   | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/agents/tools/browser-tool.account-serial.ts`                  | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/agents/tools/browser-tool.ts`                                 | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/agents/tools/weixin-extract.ts`                               | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/cli/cli-utils.ts`                                             | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/cli/gateway-cli/register.ts`                                  | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/cli/program/help.ts`                                          | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/cli/program/register.status-health-sessions.ts`               | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/conversation-task/focus-switch.ts`                            | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/conversation-task/preserve-article-across-cut.ts`             | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/gateway/collaboration-dispatch/effective-policy.ts`           | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/gateway/collaboration-learning/claim-contract-entry.ts`       | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/gateway/collaboration-learning/handoff-contract-entry.ts`     | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/gateway/enterprise-data/capability-access-request.ts`         | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/gateway/enterprise-data/controlled-sar-provider.ts`           | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/gateway/enterprise-data/on-demand-projection-materializer.ts` | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/gateway/enterprise-data/scheduled-projection-materializer.ts` | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/gateway/enterprise-security/controls.ts`                      | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/gateway/server-methods/account-computer-login.ts`             | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/gateway/server-methods/enterprise-data-assets.ts`             | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/gateway/server-methods/enterprise-data-m4.ts`                 | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/gateway/server-methods/enterprise-data-sar-admin.ts`          | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/gateway/server-methods/enterprise-data.ts`                    | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/gateway/server-methods/enterprise-security-controls.ts`       | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/gateway/server-methods/group-shared-doc.ts`                   | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/gateway/server-methods/nodes.ts`                              | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/site-capability/account-browser-port.ts`                      | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/site-capability/index.ts`                                     | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/site-capability/learning-persistence.ts`                      | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/site-capability/readonly-pilot-audit.ts`                      | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/site-capability/runtime.ts`                                   | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/site-capability/write-runtime.ts`                             | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/task-outcome/entrypoints/cli.ts`                              | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/task-outcome/entrypoints/collab.ts`                           | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/task-outcome/entrypoints/cron.ts`                             | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `src/task-outcome/entrypoints/gateway-agent.ts`                    | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `ui/src/styles/chat/grouped.css`                                   | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `ui/src/styles/components.css`                                     | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `ui/src/styles/workbench.css`                                      | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `ui/src/ui/account-computer/desktop-clipboard.ts`                  | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `ui/src/ui/ports/platform/agents/page.ts`                          | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `ui/src/ui/ports/platform/device-platform/page.css`                | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `ui/src/ui/ports/platform/models/sections/model-assets-list.css`   | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `ui/src/ui/ports/platform/productization/p1-fixtures.ts`           | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |
| `ui/src/ui/ports/platform/tenants/page.ts`                         | oxfmt/空白/换行/import 重排；`git diff -w` 无实质逻辑或仅排版 | 已审通过（执行者自检） |

## B. 无运行时影响的类型清理

| 路径                                         | 归类依据 / 备注                                                                       | 审查状态               |
| -------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------- |
| `src/gateway/server-methods/meeting.ts`      | 仅增加 issueMeetingApprovalConfirmation 导入（若未使用则为死导入/类型侧）             | 已审通过（执行者自检） |
| `ui/src/ui/app-view-state-shell-slices.ts`   | 新增可选字段 artifactPreviewMissIds?: string[]（类型面；运行时默认 undefined）        | 已审通过（执行者自检） |
| `ui/src/ui/ports/platform/models/adapter.ts` | 类型注解/import type/断言/签名收窄；`git diff` 无控制流或副作用语句变更（或仅排版级） | 已审通过（执行者自检） |

## B2. 已单独批准的 UI 文案变更（≠ 类型清理）

记忆中心 / 数据目录的**文件删除文案**是 O5 产品文案，不是「无运行时影响的类型清理」。

| 路径                                                    | 归类依据 / 备注                                                    | 审查状态                      |
| ------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------- |
| `ui/src/ui/ports/employee/views/data-directory-page.ts` | O5：忘记→删除记忆文件（标签/按钮/title）；已单独批准的 UI 文案变更 | 已审通过（审核 Agent 已确认） |
| `ui/src/ui/ports/employee/views/memory-center-page.ts`  | O5：忘记→删除此记忆文件（按钮/title）；已单独批准的 UI 文案变更    | 已审通过（审核 Agent 已确认） |

（同批 `render-model-data-directory.ts` / `render-model-memory-center.ts` 的成功提示文案见 §D，同属已单独批准的 UI 文案变更。）

## B3. 任务元数据

| 路径                  | 归类依据 / 备注                              | 审查状态               |
| --------------------- | -------------------------------------------- | ---------------------- |
| `.loom/registry.yaml` | Loom 任务注册/元数据，**不是**运行时类型清理 | 已审通过（执行者自检） |

## C. 测试夹具修正

| 路径                                                                            | 归类依据 / 备注                                                                              | 审查状态               |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------- |
| `docs/acceptance/stage3-cli-errors-evidence.test.ts`                            | 可执行 Vitest（名称含 evidence ≠ 文档）；从误分的 §F 迁入                                    | 已审通过（执行者自检） |
| `src/gateway/collaboration-learning/wl2-stop-revoke-wake.evidence.test.ts`      | 可执行 Vitest（名称含 evidence ≠ 文档）；从误分的 §F 迁入                                    | 已审通过（执行者自检） |
| `scripts/__tests__/sandbox-print-pdf.test.ts`                                   | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `scripts/openbot-surface.test.ts`                                               | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/agents/execution-preflight/execution-preflight.test.ts`                    | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/agents/pi-embedded-runner/tool-result-char-estimator.test.ts`              | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/agents/pi-tools.before-tool-call.ogui-wait.test.ts`                        | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/agents/tools/browser-tool.account-serial.test.ts`                          | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/agents/tools/collaboration-board-tool.test.ts`                             | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/auto-reply/dispatch.ogui-legacy.test.ts`                                   | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/auto-reply/reply/collaboration-capability-context.test.ts`                 | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/auto-reply/reply/get-reply-run.inbound-depth-router.test.ts`               | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/auto-reply/reply/get-reply-run.ogui-wait.test.ts`                          | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/browser/novnc-observer-http.test.ts`                                       | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/cli/cli-errors.test.ts`                                                    | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/config/sessions/ogui-decision-lifecycle.test.ts`                           | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/conversation-task/preserve-article-across-cut.test.ts`                     | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/cron/owner-scheduled-task.chain.test.ts`                                   | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/gateway/agent-runtime-version-catalog.test.ts`                             | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/gateway/collaboration-dispatch/claim-contract.test.ts`                     | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/gateway/collaboration-dispatch/collab-s1-board-challenge-flow.test.ts`     | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/gateway/collaboration-dispatch/collab-s2-plan-gate-all-paths.test.ts`      | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/gateway/collaboration-dispatch/collab-s3-submit-review-versioning.test.ts` | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/gateway/collaboration-dispatch/collab-s4-heartbeat-scheduler.test.ts`      | 心跳调度回归（含 duplicate chain / pollIntervalMs 短间隔）；契约=GroupTaskHeartbeatScheduler | 已审通过（执行者自检） |
| `src/gateway/collaboration-dispatch/collab-s5-limited-self-advance.test.ts`     | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/gateway/collaboration-dispatch/discussion-turn-prompt.test.ts`             | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/gateway/collaboration-dispatch/member-progress-export.test.ts`             | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/gateway/collaboration-dispatch/self-advance.test.ts`                       | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/gateway/collaboration-dispatch/single-group-unattended.test.ts`            | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/gateway/collaboration-learning/claim-contract-entry.test.ts`               | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/gateway/collaboration-learning/handoff-contract-entry.test.ts`             | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/gateway/collaboration-learning/owner-decision-emit.test.ts`                | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/gateway/collaboration-learning/platform-role-binding-mt.test.ts`           | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/gateway/collaboration-learning/private-memory-promote.test.ts`             | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/gateway/enterprise-data/controlled-sar-provider.test.ts`                   | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/gateway/enterprise-data/data-asset-linkage.test.ts`                        | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/gateway/enterprise-data/knowledge-publication.test.ts`                     | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/gateway/enterprise-data/sar-a3-bridge-halt-admin.test.ts`                  | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/gateway/enterprise-data/sar-a4-projection-identity-auth.test.ts`           | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/gateway/enterprise-data/sar-a5-dual-center-browser-loop.test.ts`           | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/gateway/enterprise-data/sar-validation-records.test.ts`                    | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/gateway/server-methods/diagnosis-approval.pack.test.ts`                    | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/gateway/server-methods/enterprise-diagnosis-approval.test.ts`              | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/gateway/server-methods/memory-forget-gateway-isolation.test.ts`            | O4 权限矩阵 / O5 forget 隔离；契约=data.memory.forget                                        | 已审通过（执行者自检） |
| `src/gateway/server-methods/rpc-tenant-scope.test.ts`                           | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/integrations/device-digital-human/claw4-firmware-http.test.ts`             | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/integrations/device-digital-human/claw4-firmware-p0.test.ts`               | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/memory/memory-batch1-o4-o5-diagnose.test.ts`                               | O4 权限矩阵 / O5 forget 隔离；契约=data.memory.forget                                        | 已审通过（执行者自检） |
| `src/progress-ledger/execution-step-canonical.test.ts`                          | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/shared/workspace-deliverable-path.test.ts`                                 | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/site-capability/sar-r2-account-browser.test.ts`                            | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/site-capability/sar-r3-learning-persistence.test.ts`                       | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/site-capability/sar-r4-write-ledger.test.ts`                               | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `src/task-orchestration/readonly-invoke.test.ts`                                | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `test/scripts/check-isolation-fail-closed.test.ts`                              | 隔离 fail-closed 正负例；临时 fixture；seat-tenant-index 白名单                              | 已审通过（执行者自检） |
| `test/scripts/check-openbot-ui-boundaries.test.ts`                              | UI 边界正负例；经 OPENBOT_CHECK_REPO_ROOT 临时 fixture 调真实脚本                            | 已审通过（执行者自检） |
| `ui/src/ui/account-computer/desktop-input-capability.test.ts`                   | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `ui/src/ui/account-computer/desktop-session-runtime.test.ts`                    | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `ui/src/ui/chat/generated-preview-artifact.test.ts`                             | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `ui/src/ui/ports/diagnosis/diagnosis-approval-client.node.test.ts`              | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `ui/src/ui/ports/employee/daibai-guide-history-wire.node.test.ts`               | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `ui/src/ui/ports/employee/views/daibai-team-onboarding.node.test.ts`            | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `ui/src/ui/ports/employee/views/data-directory-page.node.test.ts`               | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `ui/src/ui/ports/employee/views/memory-center-page.node.test.ts`                | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `ui/src/ui/ports/employee/views/workbench-stage.node.test.ts`                   | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `ui/src/ui/ports/platform/agents/binding-row-mutations.node.test.ts`            | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `ui/src/ui/ports/platform/device-platform/page.browser.test.ts`                 | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |
| `ui/src/ui/views/workbench-home-model.node.test.ts`                             | 夹具/断言对齐接口；随 landing-stream check-green                                             | 已审通过（执行者自检） |

## D. 运行时逻辑变化（逐项）

### `src/cli/cli-errors.ts`

- **审查状态**：待审
- **修改前**：非 Error/非 string 用 String(err) 参与网关拒绝/用法分类
- **修改后**：非 Error/非 string 消息落为空串，避免 "[object Object]" 误匹配
- **根因**：TS/字符串化副作用；fix(cli) 65289b40
- **回归证据**：src/cli/cli-errors.test.ts 有对应修改

### `src/diagnosis/intervention-dispatch.ts`

- **审查状态**：待审
- **修改前**：外层嵌套 `status∉{queued,failed,blocked}` 分支 + **其后已有** `status !== "queued" → not_queued`
- **修改后**：删除外层死分支，保留单一 `status !== "queued" → not_queued`
- **实际控制流结论**：改前改后有效门闩相同——**仅 `queued` 可 dispatch**；failed/blocked 在改前亦被后续门闩拒绝。属不可达嵌套清理，非行为收紧。
- **根因**：ODIAG check-green / 可读性
- **回归证据**：无本批独立回归用例标明

### `src/gateway/collaboration-dispatch/decision-engine.ts`

- **审查状态**：待审
- **修改前**：id.includes("skill")（id 可能为 null/undefined → throw）
- **修改后**：(id ?? "").includes("skill")
- **根因**：空值防护；失败模式从抛错→不匹配 skill
- **回归证据**：`decision-engine.test.ts` — missing/empty agentId selection

### `src/gateway/collaboration-dispatch/group-task-heartbeat-scheduler.ts`

- **审查状态**：已审通过（审核 Agent 已确认）（重复排队修复局部通过）
- **修改前**：setInterval；finally 无 clear 再挂超时；updateConfig 在 inFlight 时仍 arm → 双计时链
- **修改后**：递归 setTimeout；仅 armTimer clear-then-schedule；inFlight 时 updateConfig 只改 cfg（禁用则 clear）
- **根因**：Floor §2.2 禁 setInterval + 并发 updateConfig 竞态
- **回归证据**：collab-s4-heartbeat-scheduler.test.ts（含 duplicate chain）；fail-before/pass-after logs

### `src/gateway/collaboration-dispatch/mode-b-wake-round-dispatcher.ts`

- **审查状态**：待审（本轮已改代码为 `single_primary`；待审核 Agent 确认）
- **修改前（历史 check-green）**：非法字面量 `"explicit"` → 曾改为 `"explicit_multi"`
- **终审应有值**：单 lead wake 与 `matchedBots.length===1` 定义一致，顶层与 `roundPlan.mentionMode` 均为 **`single_primary`**（`primaryMode: "single"`，`primaryQueue` 仅 lead）
- **实际控制流结论**：`explicit_multi` 表示多成员显式提及队列；单 owner wake 不得使用。消费路径见 `mode-b-wake-round-dispatcher.test.ts`（经 `executeCollaborationRound`）。
- **根因**：终审对照 mention-resolution / 消费方
- **回归证据**：`src/gateway/collaboration-dispatch/wake-round-dispatch.test.ts` (Mode B consumption path)

### `src/gateway/collaboration-dispatch/task-dispatch-auth-recheck.ts`

- **审查状态**：待审
- **修改前**：本地 hasMembershipSurface
- **修改后**：调用 hasDeliveryMembershipSurface（行为意图等价）
- **根因**：权限复核路径与 delivery actor binding 对齐
- **回归证据**：依赖 delivery-actor-binding 单测/既有 ACL 测试

### `src/gateway/collaboration-learning/delivery-actor-binding.ts`

- **审查状态**：待审
- **修改前**：MembershipSource.governance 无 ownerUserId；membership surface helper 在 recheck 本地
- **修改后**：导出 hasDeliveryMembershipSurface；类型含 ownerUserId；逻辑与旧本地 helper 等价
- **根因**：抽公共 API + 类型补全 ownerUserId（surface 判定本就可读 owner）
- **回归证据**：task-dispatch-auth-recheck 改调用导出函数

### `src/gateway/evolution-control/soft-observe-dh-loop.ts`

- **审查状态**：待审
- **修改前**：`classifySoftObserveDhStep` 在 reapply_canary/verify 条件内重复写 `experiment.result !== "regressed"`；`logEvolutionLoop` 对象形参
- **修改后**：去掉分支内重复比较；`logEvolutionLoop(event, fields)` 二元调用
- **实际控制流结论**：函数前部已有 `experiment.result === "regressed" → step:"skip"` 早退；分支内比较在到达前不可达（亦曾触发 TS2367）。**regressed 仍由函数前部早退为 skip**；分支内比较为不可达死代码。其余为 log API 形参对齐。
- **根因**：check-green / 死代码与 API 对齐
- **回归证据**：无本批独立回归

### `src/gateway/server-methods/collaboration-learning.ts`

- **审查状态**：待审
- **修改前**：`assertValidParams(params, adminDailySummaryValidator, trySelfAdvanceValidator, method, respond)`——第 3 实参被当成 `method`，字符串 method 被当成 `respond`
- **修改后**：`assertValidParams(params, adminDailySummaryValidator, method, respond)` 四参对齐
- **实际控制流结论**：合法 `{groupId}` 在改前也能通过（validate 成功早退）；非法参数在改前会把非函数当 respond 调用。改后非法参数正确 `respond(false, …)`。
- **根因**：错误实参清理
- **回归证据**：`src/gateway/server-methods/collaboration-learning.test.ts`（adminDailySummary params gate）

### `src/task-outcome/result-service.ts`

- **审查状态**：待审
- **修改前**：`("expectedVersion" in transition) && transition.type !== "create"`
- **修改后**：`("expectedVersion" in transition)`
- **实际控制流结论**：`SubmitTransition` 的 `create` 变体**不含** `expectedVersion` 字段，故 `"expectedVersion" in transition` 对 typed create 本为 false。去掉 `type !== "create"` 是冗余守卫清理；合法 create 路径不变。仅当错误地给 create 塞入 expectedVersion（非类型内）时才会多走 not_found。
- **根因**：c744c496 类型/条件简化
- **回归证据**：无本批专项用例

### `ui/src/ui/ports/employee/render-model-data-directory.ts`

- **审查状态**：已审通过（审核 Agent 已确认）— **已单独批准的 UI 文案变更**（≠ 类型清理）
- **修改前**：忘记成功文案「已删除指定记忆条目。」
- **修改后**：「已删除所选记忆文件」（O5 文案）
- **根因**：O5 file-delete copy
- **回归证据**：memory O4/O5 测试与 8b9e0ebf

### `ui/src/ui/ports/employee/render-model-memory-center.ts`

- **审查状态**：已审通过（审核 Agent 已确认）— **已单独批准的 UI 文案变更**（≠ 类型清理）
- **修改前**：「请先选择要忘记的记忆。」/「已忘记这条记忆。」
- **修改后**：「请先选择要删除的记忆文件。」/「已删除所选记忆文件」
- **根因**：O5 file-delete copy
- **回归证据**：memory O4/O5 测试与 8b9e0ebf

### `ui/src/ui/ports/enterprise/enterprise-connection-copy.ts`

- **审查状态**：待审
- **修改前**：loading 谓词含 `connected !== true && !lastError && !terminal`
- **修改后**：loading 谓词为 `loadingPhase || (!lastError && !terminal)`
- **实际控制流结论**：该 loading 分支之上已有 `connected !== false → phase:"ready"` 早退，故进入 loading 时必有 `connected === false`，`connected !== true` 恒真。删除该合取项为**行为保持**的简化，不改变 connected/loading/disconnected 相位划分。
- **根因**：UI 连接态文案 / TS 简化
- **回归证据**：无本批专项用例

### 单列：`pollIntervalMs < 1s`

- **调用方**：`startGroupTaskHeartbeatScheduler(opts)` — 仅当显式传入 `opts.pollIntervalMs`；生产读 `resolveGroupTaskHeartbeatScanIntervalMs(cfg)` 仍 `Math.max(1_000, …)`。
- **必要性**：S4 调度可靠性测试需亚秒间隔验证单链/并发 updateConfig；不等于生产覆盖参数语义。
- **审查状态**：已审通过（审核 Agent 已确认；与重复排队修复一并局部通过）。

## E. 检查规则变化

| 路径                                         | 例外理由 / 约束保留                                                                                        | 正负例                          | 审查状态                      |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------- |
| `scripts/check-core-composition-root-loc.ts` | 7 个 maxLines 锁到 origin/main 实测尺寸；硬上限/why/算法保留；架构债见主文 §1                              | 见主文 §1–§2 与 test/scripts/\* | 已审通过（审核 Agent 已确认） |
| `scripts/check-openbot-ui-boundaries.mjs`    | app.ts allowlist +4 controllers（main 已接线）；OPENBOT_CHECK_REPO_ROOT 测试入口（默认不变）；负例 fixture | 见主文 §1–§2 与 test/scripts/\* | 已审通过（审核 Agent 已确认） |
| `scripts/check-isolation-fail-closed.mjs`    | bareSeatAllowlist + seat-tenant-index；OPENBOT_CHECK_REPO_ROOT；负例 fixture                               | 见主文 §1–§2 与 test/scripts/\* | 已审通过（审核 Agent 已确认） |

## F. 文档 / 证据 / 规格

| 路径                                                                                                | 归类依据 / 备注                     | 审查状态                   |
| --------------------------------------------------------------------------------------------------- | ----------------------------------- | -------------------------- |
| `.kiro/specs/client-apps-pc-mobile/contracts/account-session-model.md`                              | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `.kiro/specs/client-apps-pc-mobile/contracts/push-model.md`                                         | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `.kiro/specs/client-apps-pc-mobile/requirements.md`                                                 | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `.kiro/specs/client-apps-pc-mobile/tasks.md`                                                        | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `.kiro/specs/constitutional-governance-state-convergence/current-state.md`                          | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `.kiro/specs/constitutional-governance-state-convergence/evidence/2026-10-14-state-refresh.md`      | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `.kiro/specs/conversation-task-runtime/p4-5-gate-c-orch-shadow.md`                                  | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `.kiro/specs/delivery-reliability-evidence-program/evidence/g3b-path-convergence-evidence-prep.md`  | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `.kiro/specs/delivery-reliability-evidence-program/evidence/g4a-recovery-evidence-prep.md`          | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `.kiro/specs/delivery-reliability-evidence-program/evidence/registry-kiro-loom-handoff.md`          | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `.kiro/specs/delivery-reliability-evidence-program/tasks.md`                                        | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `.kiro/specs/delivery-reliability-evidence-program/wp00/feasibility-gate-2026-10-24.md`             | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `.kiro/specs/delivery-reliability-evidence-program/wp00/path-ownership-conflicts.md`                | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `.kiro/specs/delivery-reliability-evidence-program/wp00/pilot-charter.md`                           | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `.kiro/specs/delivery-reliability-evidence-program/wp00/storage-reuse-adr.md`                       | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `.kiro/specs/delivery-reliability-evidence-program/wp01/result-evidence-contract-draft.md`          | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `.kiro/specs/delivery-reliability-evidence-program/wp02/takeover-and-recovery-slice.md`             | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `.kiro/specs/delivery-reliability-evidence-program/wp03/context-budget-ownership-audit.md`          | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `.kiro/specs/delivery-reliability-evidence-program/wp04/fabric-compare-design.md`                   | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `.kiro/specs/delivery-reliability-evidence-program/wp05/path-convergence-prep.md`                   | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `.kiro/specs/delivery-reliability-evidence-program/wp06/execution-step-canonical-schema.md`         | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `.kiro/specs/delivery-reliability-evidence-program/wp06/field-mapping-adr.md`                       | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `.kiro/specs/delivery-reliability-evidence-program/wp06/ledger-field-increment.md`                  | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `.kiro/specs/delivery-reliability-evidence-program/wp06/live-invoke-readiness.md`                   | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `.kiro/specs/delivery-reliability-evidence-program/wp06/orchestration-persistence-lease-design.md`  | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `.kiro/specs/delivery-reliability-evidence-program/wp06/readonly-multistep-pilot.md`                | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `.kiro/specs/delivery-reliability-evidence-program/wp07/adapter-capability-matrix.md`               | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `.kiro/specs/delivery-reliability-evidence-program/wp07/external-side-effect-idempotency-design.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `.kiro/specs/delivery-reliability-evidence-program/wp12/initial-inventory.md`                       | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `deploy/production/M0B_M2B_OPERATOR_RUNBOOK.md`                                                     | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `deploy/production/README.md`                                                                       | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `deploy/production/RELEASE_RECORD.md`                                                               | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `deploy/production/env-authority-matrix.md`                                                         | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `deploy/production/exec-efficiency-inbound-depth-greyscale.md`                                      | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/acceptance/openbot-inventory-acceptance-plan.md`                                              | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |

| `docs/architecture/desktop-web-shell-checklist.zh-CN.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/architecture/multiplatform-acceptance-matrix.zh-CN.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/architecture/multiplatform-sharing.zh-CN.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/architecture/single-chain-tool-protocol.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/cli/local-files.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/P0-OPS-CHECKLIST.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/account-computer-artifact-grant-2026-10-08.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/account-computer-browser-plan-once-2026-10-08.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/account-computer-cn-qr-sms-handoff-acceptance-brief-2026-10-18.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/account-computer-cn-wechat-qr-sms-otp-2026-10-18.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/account-computer-default-ai-takeover-2026-10-18.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/account-computer-live-login-e2e-acceptance-brief-2026-10-18.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/account-computer-login-password-fixture.html` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/account-computer-novnc-token-refresh-2026-10-08.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/account-computer-p6-golden-path-acceptance-brief-2026-10-17.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/account-computer-p6a-production-cutover-checklist-2026-10-17.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/account-computer-p6b-production-default-on-2026-10-17.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/account-computer-sms-otp-fixture.html` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/account-computer-strip-display-name-2026-10-08.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/account-computer-takeover-learning-2026-10-08.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/account-computer-wechat-qr-fixture.html` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/account-computer-worker-live-login-e2e-acceptance-brief-2026-10-18.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/account-computer-zhihu-login-e2e-acceptance-brief-2026-10-18.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/account-sandbox-skills-visibility-2026-10-15.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collab-c0-progress-export-freeze-2026-10-13.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collab-c1-claim-progress-states-2026-10-13.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collab-c2-assistant-mention-dispatch-consumer-2026-10-13.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collab-c2-wake-contract-2026-10-13.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collab-c3-peer-review-gate-2026-10-13.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collab-c4-ogui-handoff-projection-2026-10-13.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collab-challenge-window-group-allowlist-2026-10-15.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collab-context-p3-private-memory-promote-2026-10-14.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collab-lane-context-effective-cutover-2026-10-14.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collab-p0-status-inventory-2026-10-12.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collab-p0-tenant-isolation-gate-FINAL-v3-2026-10-15.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collab-p0-wake-round-dispatch-consumer-2026-10-19.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collab-p1-artifact-accept-loop-2026-10-19.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collab-p1-shared-board-fact-2026-10-15.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collab-p1-status-inventory-2026-10-12.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collab-p2-context-scope-single-track-2026-10-14.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collab-p2-private-todolist-2026-10-15.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collab-p2-status-inventory-2026-10-12.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collab-p3-status-inventory-2026-10-12.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collab-p3-wake-heartbeat-2026-10-15.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collab-p4-5-status-inventory-2026-10-12.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collab-p4-self-advance-submit-2026-10-15.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collab-p4a-propose-handoff-entry-2026-10-12.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collab-p4b-task-board-claim-2026-10-12.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collab-p4c-rcis-async-2026-10-12.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collab-p5-challenge-window-2026-10-15.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collab-p5-multibeat-gate-2026-10-12.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collab-s1-board-challenge-FINAL-v3-2026-10-15.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collab-s2-plan-gate-all-paths-FINAL-v3-2026-10-15.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collab-s3-rpc-schema-align-2026-10-15.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collab-s3-submit-review-versioning-FINAL-v3-2026-10-15.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collab-s4-heartbeat-scheduler-FINAL-v3-2026-10-15.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collab-s5-limited-self-advance-FINAL-v3-2026-10-15.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collab-selfrun-blockers-platform-2026-10-15.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/collaboration-runtime-alignment/Collaboration-Runtime-Constitution-and-Implementation-Matrix.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/employee-skill-lifecycle-channel-2026-10-10.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/employee-skill-lifecycle-channel-optimization-plan-2026-10-10.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/employee-skill-lifecycle-gate-a-baseline-diff-2026-10-10.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/employee-skill-lifecycle-gate-b-d5-d9-mapping-2026-10-10.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/employee-skill-lifecycle-gate-c-section-5-2-live-2026-10-10.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/employee-skill-lifecycle-gate-c-section-5-2-rerun-overlay-2026-10-10.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/employee-skill-lifecycle-slice-observation-277f6c53-2026-10-10.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/employee-skill-lifecycle-vertical-slice-2026-10-10.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/evidence/memory-batch1-final-review-affected-tests-20261026.log` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/evidence/memory-batch1-heartbeat-fail-before-20261026.log` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/evidence/memory-batch1-heartbeat-pass-after-20261026.log` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/evidence/memory-batch1-pnpm-check-after-boundary-20261026-1414.log` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/evidence/memory-batch1-pnpm-check-after-format19-20261026-1410.log` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/evidence/memory-batch1-pnpm-check-after-isolation-20261026-1416.log` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/evidence/memory-batch1-pnpm-check-after-lint-fixes-20261026-1412.log` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/evidence/memory-batch1-pnpm-check-after-loc-budget-20261026-1415.log` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/evidence/memory-batch1-pnpm-check-after-openapi-20261026-1350.log` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/evidence/memory-batch1-pnpm-check-after-policy-consumption-20261026-1420.log` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/evidence/memory-batch1-pnpm-check-after-setinterval-20261026-1418.log` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/evidence/memory-batch1-pnpm-check-after-tsgo-green-20261026-1410.log` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/evidence/memory-batch1-pnpm-check-baseline-fresh-20261026-1349.log` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/evidence/memory-batch1-pnpm-check-final-green-20261026-1424.log` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/evidence/memory-batch1-pnpm-check-final-review-20261026.log` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/evidence/memory-batch1-tsgo-after-govtask-20261026-1356.log` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/evidence/memory-batch1-tsgo-baseline-fresh-20261026-1349.log` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/evidence/memory-batch1-tsgo-final-green-20261026-1424.log` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/evidence/memory-batch1-tsgo-final-review-20261026.log` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/evidence/memory-batch1-tsgo-ts7016-fix-2026-10-26-1335.log` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/evidence/memory-o4-o5-isolation-verify-2026-10-26.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/evidence/memory-o4-o5-tests-20261026-1536.log` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/exec-efficiency-p2-observability-dashboards-2026-10-12.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/interactive-choice-follow-up-mvp-2026-10-12.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/memory-batch1-check-green-review-2026-10-26.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/memory-center-candidate-view-plan-2026-10-26.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/memory-system-batch1-implementation-2026-10-26.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/memory-system-o4-o5-disposition-2026-10-26.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/memory-system-optimization-plan-2026-10-26.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/memory-system-review-report-2026-10-26.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/ogui-form-p0-single-select-2026-10-13.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/ogui-p1-typebox-schema-2026-10-13.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/ogui-p3-canvas-adapter-2026-10-13.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/ogui-p4-skill-ui-contract-2026-10-13.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/oi-intelligent-bind-s0-s1-2026-10-13.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/oi-intelligent-bind-s2-github-2026-10-13.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/oi-intelligent-bind-s3-social-2026-10-13.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/oi-intelligent-bind-s4-wechat-personal-2026-10-13.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/oi-intelligent-bind-s5-live-path-2026-10-13.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/oi-intelligent-bind-s6-social-verified-live-2026-10-19.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/oi-x-twitter-oauth-personal-identity-2026-10-14.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/openbot-cn-office-capability-approval-backend-2026-10-16.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/openbot-dev-delivery-pipeline-standard-2026-07-20.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/openbot-diagnosis-p14-independent-approval-2026-09-03.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/openbot-diagnosis-p15-trunk-convergence-2026-09-03.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/openbot-diagnosis-p16-936-2026-09-04.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/openbot-diagnosis-p17-ledger-2026-09-04.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/openbot-diagnosis-p19-2026-09-04.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/openbot-diagnosis-p20-2026-09-05.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/openbot-diagnosis-p20.1-2026-09-05.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/openbot-diagnosis-p20.2-ledger-2026-09-05.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/openbot-diagnosis-track-i-intervention-m2-2026-10-14.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/openbot-execution-chain-mainpath-standby-2026-10-12.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/openbot-unified-image-incremental-enablement-2026-08-26.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/sar-a1-sar-provider-wire-2026-10-18.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/sar-a2-validation-records-2026-10-18.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/sar-a3-bridge-halt-admin-2026-10-18.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/sar-a4-projection-identity-auth-2026-10-18.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/sar-a5-dual-center-browser-loop-2026-10-25.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/sar-e4-knowledge-projection-supply-2026-10-17.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/sar-r5-readonly-pilot-report-2026-10-18.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/skill-precipitation-pipeline-2026-10-13.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/target-codebase-evidence-2026-10-10.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/task-outcome/call-chain-and-replacements.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/design/task-outcome/contract.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/diagnosis/conversation-eval-code-audit-2026-10-11.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/integrations/device-digital-human/claw4-firmware-http-compat.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/integrations/device-digital-human/openapi.yaml` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/integrations/device-platform/joint-acceptance.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/notes/openbot-batch0-publish-baseline-2026-10-21.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/notes/openbot-batch7-task-surface-2026-10-21.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/reference/templates/AGENTS.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `docs/tools/exec-approvals.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/cyber-ppt/references/pptx-routing.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/execution-discipline/references/full.zh-CN.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/interactive-choice-follow-up/SKILL.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/ogui-form/SKILL.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-bilibili/SKILL.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-bilibili/references/field-contract.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-bilibili/references/live-evidence.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-bilibili/references/path-map.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-douyin/SKILL.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-douyin/references/field-contract.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-douyin/references/live-evidence.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-douyin/references/path-map.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-github-personal/SKILL.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-github-personal/references/field-contract.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-github-personal/references/oauth-path.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-kuaishou/SKILL.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-kuaishou/references/field-contract.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-kuaishou/references/live-evidence.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-kuaishou/references/path-map.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-personal-email/SKILL.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-personal-email/references/field-contract.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-wechat-official/SKILL.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-wechat-official/references/cloud-pc-live-evidence.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-wechat-official/references/field-contract.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-wechat-personal/SKILL.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-wechat-personal/references/field-contract.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-wechat-personal/references/local-channel-map.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-weibo/SKILL.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-weibo/references/field-contract.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-weibo/references/live-evidence.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-weibo/references/path-map.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-x-twitter/SKILL.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-x-twitter/references/field-contract.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-x-twitter/references/live-evidence.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-x-twitter/references/oauth-path.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-xiaohongshu/SKILL.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-xiaohongshu/references/field-contract.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-xiaohongshu/references/live-evidence.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-xiaohongshu/references/path-map.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-zhihu/SKILL.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-zhihu/references/field-contract.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-zhihu/references/live-evidence.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-bind-zhihu/references/path-map.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-grant-owned-bots/SKILL.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-orchestrate-personal-identity/SKILL.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/oi-orchestrate-personal-identity/references/catalog-map.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/openbot-docs/references/skills-routing.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/openbot-platform-ops/SKILL.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/openbot-platform-ops/references/operational-identity.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/pptx/SKILL.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `skills/user-guidance-protocol/SKILL.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `src/agents/sandbox/ACCOUNT_WORKER_SANDBOX_IMAGES.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |

| `src/gateway/delivery-lane/EVENTS.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |
| `src/gateway/delivery-lane/template-library/README.md` | 文档、证据日志、设计/规格；无运行时 | 不再需要（非运行时审批项） |

## 生成元数据

- 固定起止：`8070ef52e04bd0331ab113bdb15b090247b329c6`（含）→ `578b3a7de134d98a305fa077a58cd05145bb3bf4`（含）
- 生成命令基线：`git diff --name-only 8070ef52^..578b3a7d`（与正文「含 8070ef52」一致；**勿**改用 `8070ef52..HEAD`）
- 分类经启发式 + 人工覆写（runtime / check / 文案 / mentionMode / intervention / soft-observe / cli-errors / result-service / enterprise-connection-copy / Loom 元数据 / evidence 测试归类）。
- **不要**把类型修复自动当成无行为变化：凡条件/分支/字面量/消息分类有差，均列入 §D 待审或已审。
- 「已审通过」一律带括号区分：**执行者自检** vs **审核 Agent 已确认**。
