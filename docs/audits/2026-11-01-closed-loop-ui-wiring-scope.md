# 下一笔前后端接入：结果否定与企业诊断对照

本文件是下一笔 PR 的实施清单。它不实现按钮，不新增诊断库，也不改 `task.outcome.rejectResult` 的 scope。#180 仍是仅 RPC。

依赖：#179 合入 main 之后，#180 按文末脚本接到 `origin/main` 并复验，再把 base 改为 `main`。未复验不要改 base，也不要 merge。

## 权限策略

已验证事实：

- `task.outcome.rejectResult` 登记在 `operator.write`（`src/gateway/server-methods/packs/manifest.ts` 的 `task-outcome-reject` 包）。同一 scope 还覆盖 `tasks.create` / `tasks.update` / `tasks.bindSession`、`support.cases.create|resolve|close`、`user.daibai.execute`、`fabric.tool.execute`、steward/group 文件写入、supervisor 写入、artifact grant、`dataGovernance.laterWave.evaluateEnablement`。
- 平台管理员创建时的默认 scope 含 `operator.write`（`src/gateway/platform-auth/auth-helpers.ts` 的 `PLATFORM_ADMIN_SCOPES`；界面文案在 `ui/src/ui/ports/platform/system-settings/page.ts` 把该 scope 标成「操作：发送消息、执行任务」）。员工主管中心写明创建任务需要 `operator.write`，没有时请联系管理员（`ui/src/ui/ports/employee/views/employee-supervisor-center.ts`）。
- 员工自助加入和企业管理员激活写入的是 `DEFAULT_PLATFORM_AUTH_SCOPES`：`operator.admin`、`operator.approvals`、`operator.pairing`，并不显式包含 `operator.write`（`src/gateway/platform-auth/routes-employee-register.ts`、`src/gateway/platform-auth/routes-enterprise.ts`）。`operator.admin` 会替代绝大多数写方法（`src/gateway/method-scopes.ts` 的 `authorizeOperatorScopesForMethod`）。例外只有 `platform.diagnosis.approval.decide` 和 `enterprise.mesh.asset.pause`。因此今天一个普通员工会话可以通过 scope 门调用拒绝接口。这是既有的 admin 替代，不是任务主体专用能力。
- 真正的对象限制在 handler：调用者只取已认证的 `platformUserId`，企业租户只取 membership。`callerOwnsTaskOutcome` 要求规范化后的 subject 与任务 `subjectRef` 相同；企业任务还要求租户非空且相等。请求体里的 subject 字符串和 `client.user` 不算授权。
- 创建任务时若没有 `platformUserId`，聊天入口会把 `subjectRef` 落成 sessionKey。之后用 platformUserId 拒绝会 `unauthorized`。不得猜测身份，不得批量补写归属。

本回合没有改权限代码，也没有把终端用户加成通用 operator。

下一笔 PR 的最小权限改动（先做后端，再做按钮）：

1. 把 `task.outcome.rejectResult` 放进 `ADMIN_SCOPE_DOES_NOT_SUBSTITUTE`，使 `operator.admin` 不再打开这个方法。
2. 从 `operator.write` 包里移出该方法，避免「能点否定」等于「能建任务、关支持单、执行大白、写文件」。
3. scope 门改为：连接上已有非空 `platformUserId` 的调用可以进入 handler；handler 继续按 subjectRef 与企业租户失败关闭。不匹配、缺身份、跨租户都返回 `unauthorized`，且不披露别人的版本。
4. 不把 `operator.write` 或 `operator.admin` 加进员工默认 scope。

## 实勘到的界面

仓库里没有名为「结果不符合要求」的按钮。`ui/` 下也没有 `taskJudgement` 或 `outcomeVersion` 字段。

| 表面             | 文件                                                                                                                                                                                        | 现在有什么                                                                                                                                                          | 下一笔怎么用                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 聊天任务卡       | `ui/src/ui/views/chat.ts` 的 `renderTaskCard` / `parseTaskCard`；类型在 `ui/src/ui/types/chat-types.ts`                                                                                     | 标题、步骤、状态（进行中/等待中/已阻塞/已完成/失败）、可选 message。解析器丢掉未知字段                                                                              | 只有服务端事件已经带上 taskId、agentId、outcomeVersion 时才显示按钮。卡片 id 不是 TaskOutcome taskId，不能拿来调用 RPC |
| 聊天产物上下文   | 同文件 `parseArtifactContext`                                                                                                                                                               | 有 `task_id`，没有 outcomeVersion                                                                                                                                   | 不能单独作为否定目标                                                                                                   |
| 定时任务结果气泡 | `ui/src/ui/chat/cron-result-message.ts`                                                                                                                                                     | Markdown 标记，不是 TaskOutcome                                                                                                                                     | 不在此加按钮                                                                                                           |
| 主管任务板       | `ui/src/ui/supervisor/supervisor-task-board.ts`                                                                                                                                             | 运营侧任务，创建依赖 `operator.write`                                                                                                                               | 不是终端用户的结果卡，不加这个按钮                                                                                     |
| 企业诊断页       | `ui/src/ui/ports/diagnosis/diagnosis-panel.ts` 调 `runDiagnosisDiagnose`；版面在 `ui/src/ui/ports/enterprise/diagnosis/enterprise-diagnosis-surface.ts` 与 `enterprise-diagnosis-report.ts` | 目标选择已区分数字人与协作小组（`ui/src/ui/ports/diagnosis/diagnosis-targets.ts`）。报告正文和投送后缀已有。没有「关联原任务 / 结果版本 / 当前处理 / 复验结果」四行 | 在现有报告区块追加这四行，数据只来自同一次 `diagnosis.diagnose` 返回的 `taskOutcomeEvidence`                           |
| 平台诊断页       | `ui/src/ui/ports/platform/diagnosis/platform-diagnosis-surface.ts`                                                                                                                          | 与企业诊断共用面板入口                                                                                                                                              | 同一套空态文案，不另做一套诊断模型                                                                                     |

来源数字人或协作小组用诊断页已经选中的 roster 标签（`DiagnosisTargetOption.label` 与 `kind`）。evidence 里没有负责人姓名。roster 对不上时显示服务端给出的 id，或「未声明」。前端不推测负责人、处理状态或成功结果。

## #180 已经返回的字段

拒绝 RPC `task.outcome.rejectResult`：

| 结果 | 字段                                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 成功 | `ok: true`，`record`（追加后的 correction 版本），`replayed`                                                                                            |
| 失败 | `ok: false`，`code`，有时有 `tipVersion`                                                                                                                |
| code | `unauthorized`，`agent_unresolved`，`not_found`，`not_a_closed_result`，`version_conflict`，`rejected`，参数不全时 handler 另返回 `task_ref_incomplete` |

诊断 `diagnosis.diagnose` 在请求带上 `taskOutcome.taskId + outcomeVersion + agentId` 时附加 `taskOutcomeEvidence`：

| 成功 | `taskId`，`outcomeVersion`，`judgement`，`reasonCode`，`lifecycle`，`toolObservations` |
| 失败 code | `unauthorized`，`not_found`，`version_missing`，`outcome_version_changed`（可带 `tipVersion`），`read_failed`，`task_ref_incomplete`，`agent_unresolved` |

同一段文字会追加到 `reportText` 末尾，且发生在投送之后，不改变注入正文。工具失败只出现在观察计数里，不改 `judgement`。

## 缺口

| 产品需要                   | #180                                                         | 下一笔                                                                                              |
| -------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| 用户点击「结果不符合要求」 | 无入口                                                       | 绑服务端给出的 taskId + outcomeVersion + agentId                                                    |
| 无权限                     | RPC `unauthorized`                                           | 按钮旁显示权限不足，不改本地状态                                                                    |
| 版本冲突                   | `version_conflict` 与 `tipVersion`                           | 显示证据已过期，不用旧版本再提交                                                                    |
| 无法关联身份               | 缺 platformUserId 或 subject 是 sessionKey 时 `unauthorized` | 显示无法关联身份。不补写历史归属                                                                    |
| 成功后的真实状态           | `record` 是 correction，不是新的一次执行                     | 展示 `record` 的判定与原因。文案禁止写「已重新执行」                                                |
| 关联原任务、结果版本       | evidence 成功时有 taskId 与 outcomeVersion                   | 诊断详情两行直接显示；失败且 code 为 `outcome_version_changed` 时写「证据已过期」                   |
| 当前处理                   | 没有单独的处理单或负责人字段                                 | 无 correction / 无处理记录时固定写「尚未处理」。有 correction 时只显示 record 里的判定与 reasonCode |
| 复验结果                   | 没有复验写入                                                 | 固定写「未复验」                                                                                    |
| 跨用户 / 跨租户            | handler 已拒绝                                               | 前端不绕过；验收用别人的会话调用，期望后端 `unauthorized`                                           |

聊天任务卡今天的事件没有 outcomeVersion。下一笔如果不能从既有任务结果事件读到 taskId、agentId、outcomeVersion 三个服务端字段，按钮不出现。不允许前端用会话、卡片 id 或最近一条任务去猜。

## 验收用例

| 编号 | 步骤                                                                          | 期望                                                                           |
| ---- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| A1   | 任务主体在结果上点击「结果不符合要求」，请求带服务端 taskId 与 outcomeVersion | 同一任务新增一个 correction 版本；界面显示纠正后的判定，不出现「已重新执行」   |
| A2   | 企业诊断对同一 taskId + 该版本调用 `diagnosis.diagnose`                       | `taskOutcomeEvidence.judgement` 与拒绝后的 tip 一致；详情能看到关联任务与版本  |
| A3   | 另一用户或另一租户调用拒绝或诊断                                              | 后端 `unauthorized`；响应不包含对方的判定正文                                  |
| A4   | 用旧 outcomeVersion 再点一次                                                  | `version_conflict` 或诊断 `outcome_version_changed`；界面写证据已过期          |
| A5   | 创建时没有 platformUserId 的历史任务                                          | 拒绝失败关闭；界面写无法关联身份；磁盘上的 subjectRef 不变                     |
| A6   | 诊断对象是数字人或协作小组                                                    | 详情用来源 roster 的标签；没有处理记录写「尚未处理」；没有复验证据写「未复验」 |
| A7   | 只持有 `operator.read`、且下一笔已按上面收紧 scope                            | 不能靠 read 或 admin 替代调用拒绝；主体本人仍可调用                            |

A7 在本清单落地之前不要当已通过。今天 admin 替代仍会放行 scope 门。

## 明确不做

- 不把 UI 改动放进 #180。
- 不新建平行诊断库、处理状态机或通知链路。
- 不做自动处理、原场景复验、大白统一通知。这三项仍是后续独立项。
- 不猜测身份，不批量补写历史任务归属。
- 不把终端用户提升为 `operator.write` 或 `operator.admin`。
- 不部署，不打开 remediation、Issue 复查回写、claimContract、治理 auto。
- 不 merge #179 或 #180。只有后续明文「可以合入 #179」或单独授权合入 #180 之后才合入。

## #179 合入之后的接 main 脚本

#179 仍 OPEN 时不要执行。合入并确认 `origin/main` 含 #179 之后：

```
git fetch origin main
git rebase --onto origin/main origin/cursor/closed-loop-isolation-contract-490b cursor/closed-loop-negation-diagnosis-490b
```

重跑本清单所依赖的六份 vitest，再把 #180 的 base 改为 `main`。
