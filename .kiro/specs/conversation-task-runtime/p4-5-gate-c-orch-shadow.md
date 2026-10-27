# ConversationTask Runtime — P4.5 Gate C ORCH_SHADOW 观察（无 invoke）

> Owner(本切片): Cursor cloud agent · Task: `conversation-task-runtime` / Gate C
> 关联: `./p4-5-orchestration-plane.md` · `./p4-5-admission-package.md` · `./p4-5-seq45-b-predeploy.md` · `./p2-5-production-readiness.md`（B→A→D→C）
> 状态: **Gate C = ORCH_SHADOW observation APPROVED** · **invoke = FROZEN** · **LIVE_INVOKE = false** · **无 host swap** · **无 ledger 行** · `OPENBOT_CONVERSATION_TASK_ORCH_DISPATCH` / `ORCH_NODE` / `ORCH_BROWSER` = NOT APPROVED · `CTR activation/projection/authorization` = NOT APPROVED
> 日期: 2026-08-29

## 0. 范围（本 PR 不是 cutover，也不是 ledger 行）

本文件记录 **Gate C** 的批准范围：**只**允许 Orchestration Plane 在 `shadowEnabled && !dispatchEnabled` 时真正跑 `routeStep` 并记录 reason codes。

本 PR **不是**：

- 生产 host 换镜像 / 换容器 / nginx
- `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` / `RELEASE_RECORD.md` 新行
- 发明 cutover SHA
- 打开 `ORCHESTRATION_LIVE_INVOKE`
- 打开 DISPATCH / NODE / BROWSER
- 打开 CTR `activation` / `projection` / `authorization`
- 把 `OPENBOT_CONVERSATION_TASK_ORCH_SHADOW` 的 **source default** 翻成 ON（`feature.ts` 缺 env 仍 OFF；host env 稍后）

**seq 号不要混：**

| 名称                  | 含义                                                                         | 本 PR                 |
| --------------------- | ---------------------------------------------------------------------------- | --------------------- |
| #796 seq 46 / 47      | Aliyun ledger **重建**（已回滚的未验活前向）                                 | **不是** 本次 CTR cut |
| CTR 口头「seq 46」    | **下一次前向 LIVE host cut**（本 PR 合入且 GHCR 镜像存在之后，由操作者执行） | 稍后，不是本 PR       |
| Aliyun ledger nextSeq | 那次 host cut 之后记 **seq 48**（`pnpm delivery:cutover:record`）            | 稍后，不是本 PR       |

合入主干 ≠ 已上线 ≠ 已 cutover。cutover 是之后的操作者步骤。

## 1. 内核合同（观察必须是真的）

今日若只开 shadow、空 allowlist、CTR activation OFF，旧 `considerDispatch` 会在 `routeStep` 之前 no-op。Gate C 改为：

1. `shadowEnabled && !dispatchEnabled` ⇒ 调用 `routeStep`，记录 reason codes（`orch_shadow_observe`）
2. `invoke` / `enqueue` / `invokedTool` / `wroteLedger` / `job` 仍为 false / null
3. `dispatchEnabled` / `nodeEnabled` / `browserEnabled` / `ORCHESTRATION_LIVE_INVOKE` 任一为 true ⇒ fail-closed，不 invoke
4. 不调用 `createWebSearchTool` / `createWebFetchTool` / `createBrowserTool` / `createNodesTool` / `listNodes` / `system.run` / `sessions_spawn`
5. 不调用 `runActivationGate` / `openTaskStore` / Progress Ledger writer

## 2. 逐项复核（本 PR）

| #   | 项                                       | 证据                                                                                                                                                 | 结果 |
| --- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | LIVE_INVOKE 冻结                         | `ORCHESTRATION_LIVE_INVOKE === false`                                                                                                                | PASS |
| 2   | 空 allowlist + activation OFF 不 invoke  | `considerDispatch` shadow-only 测试                                                                                                                  | PASS |
| 3   | shadow-only 真正打分                     | `routeStep` 选出 `web_read` 且 `loggedReasonCodes` 含 ladder + `orch_shadow_observe`                                                                 | PASS |
| 4   | DISPATCH / NODE / BROWSER 仍 fail-closed | 输入这些 flag 为 true ⇒ `orch_live_path_armed_fail_closed` 或 allowlist no-op；`invokedTool` false                                                   | PASS |
| 5   | source default 仍 OFF                    | `feature.ts` `envEnabled` 未改；`readOrchestrationFlags({})` 全 false                                                                                | PASS |
| 6   | 无 env 示例 / compose / CI 打开          | 不改 `.env.example` / compose / CI / deploy overlay                                                                                                  | PASS |
| 7   | 无 ledger / 无 LIVE SHA                  | 不改 `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` / `RELEASE_RECORD` / `ledger.test.ts` | PASS |

## 3. 爆炸半径

合入后二进制含 shadow-observe 内核。flags 默认仍 OFF。host **稍后**才设 `OPENBOT_CONVERSATION_TASK_ORCH_SHADOW`。未设 env 时行为与合入前相同（dormant no-op）。

不向 `env.list` / `.env.docker` / compose / CI 写入任何 `OPENBOT_CONVERSATION_TASK_ORCH_*`。

## 4. 回滚

代码级：不设 `OPENBOT_CONVERSATION_TASK_ORCH_SHADOW`（或缺省 OFF）即回到 dormant no-op。无需重新部署即可关掉观察。

host cut / ledger 回滚不在本文件范围。

## 5. 签署边界

- 本文件是 Gate C **观察**合同，不是 A/D，不是 ledger 行
- 实施 owner（Cursor Agent）不得视为生产 cutover 签署
- flykingvip-cloud 的 PR Approve 是代码审，不替代 host cutover
- 合入不打开 DISPATCH / NODE / BROWSER / CTR activation，也不把 `ORCH_SHADOW` source default 翻成 ON
