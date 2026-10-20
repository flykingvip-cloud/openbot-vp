# Phase 2 Shadow 观测期协议

> **Parent plan:** [Phase 2 shadow 实施计划 v0.1](./openbot-task-focus-unify-phase2-shadow-implementation-plan-2026-09-13.md)
> **PR:** [#1107](https://github.com/gmood2008/openbot/pull/1107) implementation; [#1112](https://github.com/gmood2008/openbot/pull/1112) Cycle 0 evidence; [#1120](https://github.com/gmood2008/openbot/pull/1120) HMAC perms + harness rename; [#1121](https://github.com/gmood2008/openbot/pull/1121) gate-prep; [#1122](https://github.com/gmood2008/openbot/pull/1122)–[#1125](https://github.com/gmood2008/openbot/pull/1125) gate-pass records
> **Status:** PR 1107 landed `16cea426e711516629e52c0522c39a7a77628655`. PR 1120 landed `b03ffa66a8870f42042f4a0f743bd1b7cd1b6926`. PR 1126 landed `f73443dae6a9f326e09a8a775e641d2f5f814842`. Local LaunchAgent RUNNING `2026-09-14T10:42:42Z` is `b07683f99da4c85c3145c5f2df04b7b184782fb7` and contains `#1107` + `#1120`. LIVE remains `16cea426e711` (lacks `#1120`). Window application filed, **not signed**. Cycle 0 **signed as** `synthetic_observe_api` + `runtime_callsite_harness` only — **not** `launchd_gateway`. Observation only. **不得**进入 Phase 3a / 3b / 4 / 5
> **Date:** 2026-09-14

本文件是观测期操作合同。目标是验证“我们正确看到了什么”，不是把 shadow 变成执行器。

## 1. 允许与禁止

允许：

- 开启 `OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW=1`
- 配置独立 `OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW_HMAC_KEY`
- 观察 Chat、Cron isolated、协作 round、Subagent
- 写入脱敏 `objective-shadow.jsonl`
- 生成只读指标和观测报告
- 修复仅限 shadow 自身的日志、脱敏、幂等和观测缺陷

禁止：

- 修改 Prompt、Completion、Run status、Delivery、Ledger
- 创建或持久化 ObjectiveParticipation / WorkUnitDefinition / WorkUnitLease / ActiveLeasePointer / ObjectiveContribution
- 开启 Objective Lease、协作调度、alignment gate
- 修改 Phase 1b Cron L2 prompt
- 开始 Phase 3a / 3b 运行时接入
- 使用 admin 绕过 PR 策略或 CI

## 2. 合入闭环

合入前必须：

```text
git fetch origin
git rev-parse origin/main
git status --short
```

并确认：无 unresolved review thread；无新增运行时越界；自动合入仍启用；不使用 admin bypass。

合入后记录 landed SHA，并核对：

```text
git show --stat <landed-sha>
git merge-base --is-ancestor <landed-sha> origin/main
```

## 3. 观测配置

```text
OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW=1
OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW_HMAC_KEY=<独立密钥>
# or, restart-safe file inject (key file is outside the repo):
OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW_HMAC_KEY_FILE=/path/to/hmac
```

- flag 未设置、为 `0`、`false` 或空值时完全 no-op
- HMAC key 缺失或无效时 fail-closed，不写日志
- HMAC 必须由外部 secret manager / 受控环境变量 / 0600 key file 持久管理，进程重启后可恢复同一 key
- key-file fallback 读取前必须 `lstat`：普通文件、非 symlink、`mode & 0o077 === 0`、owner 为当前进程用户；任一不满足则 fail-closed
- `runtime_callsite_harness` 证明接线函数可达，不得当作 `launchd_gateway`；三套语料不得加总
- 本机托管：macOS Keychain `openbot.objective-shadow.hmac` + `~/.openbot/secrets/objective-shadow-hmac`；用 `scripts/dev/objective-shadow-hmac-inject.sh ensure`
- 不得把 key、tenant / group 原文、用户消息、prompt、模型输出、目标正文、Ledger / evidence 正文写入日志、window state 或报告
- shadow 日志与 window state 不得复用 Progress Ledger 或 coordination store
- 合成 observe-API 记录与真实 ingress 接线记录必须分文件，不得混为一组

默认路径：`~/.openbot/logs/objective-shadow.jsonl` 与 `objective-shadow.window.json`。

只读报告：

```text
bun src/objective-shadow/observation-report.ts --landed=<landed-sha>
```

## 4. 每日报告字段

每份报告至少包含：观测开始时间；当前 landed SHA；每类 ingress 记录数；resolved / conflict / allowlist_rejected / skipped / out_of_scope；sourceConflict / allowlistRejected / inheritViolation 率；redaction_dropped；hmac_key_missing；forbiddenWriteAttempts；JSONL 重复 runId；每类 ingress 的 proposed generated / discarded；是否出现运行结果变化；是否出现 Prompt / Completion / Ledger / Lease / Pointer / Contribution 写入。

报告不得包含用户原文或敏感身份信息。`hmac_key_missing` 按设计不落盘，JSONL 派生计数应为 0。

## 5. 必须持续验证的场景

1. Chat 有真实 ConversationTask：Objective ID / revision 来自 Task，不来自 runId / sessionId。
2. Chat 没有 ConversationTask：skipped，不得生成伪造 Objective。
3. Cron 同一 job 的不同 occurrence：Objective ID / revision 稳定，runId / occurrence 不同。
4. Cron goal、intent、acceptance、compiled instruction 变化：revision 变化。
5. Cron 只有永久 jobId、没有 occurrence：不得把 jobId 当 occurrence 写入。
6. 协作 round：返回 `collab_deferred_phase3b`，不得生成单聊 exclusive unit。
7. Subagent 缺 parent snapshot：记录 `inherit_violation`，不得自行解析新 Objective。
8. Subagent 使用 session key 作为 parentRunId：必须拒绝或记录 inherit violation。
9. 同一 runId 重复观测：最多一条 JSONL。
10. flag OFF：不写 JSONL、不写 window state、不改变任何运行行为。
11. 缺 HMAC key：不写日志、不改变运行结果。
12. window 达到 7 天或 N=500：停止落盘，后续只返回 `window_closed`。
13. 脱敏扫描：日志不得出现 tenant / group、邮箱、电话、token、绝对路径和任务正文。
14. replay：只运行纯函数，不写生产日志，不创建任何协调对象。

## 6. 停止条件

出现以下任一情况，立即关闭 shadow writer，并将 flag 置 OFF：

- `forbiddenWriteAttempts > 0`
- 任何 Lease、Pointer、Contribution、Participation 或 Ledger 写入
- Prompt、Completion、Run status 或 Delivery 发生变化
- JSONL 出现明文敏感信息
- 出现无 runId 的日志
- 窗口关闭后仍持续写入
- 观测记录出现跨 tenant 或 revision 污染
- 实际 Objective 仍由 runId、sessionId、永久 jobId 或恒定 revision 伪造
- 观测日志无法与 landed SHA 对应

停止后提交 Decision 记录；不得为凑满 N=500 自动重新开启。

## 7. 窗口与结束

- 墙钟：首次成功写入起 7×24 小时
- 次数：每个 ingress 最多 500 条
- 先到先停，不自动续期

观测期结束不能自动批准 Phase 3。申请下一阶段前必须齐全：

1. 观测窗口关闭证据
2. 四类 ingress 指标汇总
3. `forbiddenWriteAttempts = 0`
4. 脱敏和无明文泄漏报告
5. replay 稳定性报告
6. 运行行为未改变的回归证据
7. source conflict / allowlist / inherit violation 分析
8. Phase 3a 设计草案
9. Phase 3b 独立协作设计草案
10. 专家组对 3a / 3b 分别签收

## 8. launchd_gateway 开窗门禁

`#1120` 合入验收已通过。Cycle 0 目前只签收 `synthetic_observe_api` 与 `runtime_callsite_harness`。**在下列全部满足之前，不得写 `sourceKind: launchd_gateway` 报告，也不得把三类语料加总。**

**`#1121` 门禁准备已通过；正式 `launchd_gateway` 开窗仍未授权。** 本地 LaunchAgent RUNNING 现为 `b07683f99d`，SHA 祖先门禁已过；申请见 `docs/design/evidence/objective-shadow-launchd-gateway-window-application-b07683f99d-2026-09-14.md`。生产 LIVE 仍是 `16cea426e711`。签收前禁止设置生产 flag、采集或伪造 `launchd_gateway` 语料，或进入 Phase 3a / 3b / 4 / 5。以实际进程/容器 `build-info.commit` 为准，不接受仅凭分支名或 PR SHA 推断已上线。

共享工作树若无法 `git fetch origin`（Git 元数据权限），不改变门禁结论。**正式开窗申请必须在可写 Git 环境中重新执行 SHA 与部署核验。**

开窗前硬条件：

1. 受控部署完成后，从实际运行进程/容器读取 `build-info.commit`
2. 该 RUNNING SHA 必须同时包含 `#1107` `16cea426e711516629e52c0522c39a7a77628655` 与 `#1120` `b03ffa66a8870f42042f4a0f743bd1b7cd1b6926`
3. 通过 forward-only、delivery-alignment、live-image identity
4. LaunchAgent plist 未被直接改写
5. HMAC key-file 恢复检查通过
6. 提交完整 `launchd_gateway` window application（可写 Git 环境重核后的 RUNNING，不是分支/PR SHA）
7. 专家组单独签收后，才允许注入生产 flag 并开始真实采集

开窗后必须提供：

- 容器/进程 `build-info.commit`
- LaunchAgent 未被直接改写的证据
- 真实 Chat、Cron isolated、协作 round、Subagent 记录
- 独立 `launchd_gateway` 报告与 checksum
- `forbiddenWriteAttempts = 0`、无泄漏、无运行行为变化
- 与 synthetic / harness 分离的统计

批准状态保持：

| 项                                 | 状态                                           |
| ---------------------------------- | ---------------------------------------------- |
| `#1120`                            | 已通过合入验收                                 |
| `#1121` 门禁准备                   | 通过                                           |
| 可写 Git RUNNING 重核              | LaunchAgent `b07683f99d` 过；LIVE 仍缺 `#1120` |
| Cycle 0 `synthetic_observe_api`    | 已验证                                         |
| Cycle 0 `runtime_callsite_harness` | 已验证                                         |
| Cycle 0 `launchd_gateway` 开窗     | **未授权**                                     |
| Phase 3a / 3b / 4 / 5              | 未批准                                         |
