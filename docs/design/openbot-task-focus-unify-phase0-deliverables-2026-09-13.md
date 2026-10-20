# Phase 0 交付物：任务聚焦与执行一体化

> **Parent:** [openbot-task-focus-unified-execution-review-2026-09-13.md](./openbot-task-focus-unified-execution-review-2026-09-13.md) v0.3.1
> **Status:** Phase 0 **COMPLETE** v1.4（HEAD/计数已同步 §9；待专家组复验 §9–§10）
> **Branch:** `cursor/task-focus-unify-phase0`
> **Executed:** 2026-09-13（v1.1 整改：worktree 清理、Git 提交、Phase 1a 标 N/A）

---

## 1. Fresh Trunk SHA（三方核对）

| 字段                        | 值                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| **Canonical trunk**         | `origin/main`                                                                             |
| **SHA**                     | `620c767fb1c47fa9e8206eee1b190165ecfeb1ff`                                                |
| **Commit subject**          | `Delivery: record seq85 6bc9ff13f6 production cutover (#1106)`                            |
| **Re-verified**             | 2026-09-13 `git fetch origin` 后 `HEAD == origin/main`                                    |
| **Isolation worktree base** | `620c767fb1`（ancestor check **pass**）                                                   |
| **Shared dirty tree**       | `/Users/daniel/AI项目/openbot` @ `a79cc5309e`（**非** Phase 0 基线；WIP **禁止 replay**） |

---

## 2. 隔离 Worktree / 分支信息

| 字段              | 值                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------- |
| **Worktree 路径** | `/Users/daniel/AI项目/openbot-task-focus-unify`                                              |
| **分支名**        | `cursor/task-focus-unify-phase0`                                                             |
| **Tracking**      | `origin/main`                                                                                |
| **创建命令**      | `git worktree add ../openbot-task-focus-unify -b cursor/task-focus-unify-phase0 origin/main` |

### 2.1 Worktree 洁净性（整改项 #1）

**v1.0 问题：** `pnpm install` 后 16 个 `extensions/*/node_modules` 跟踪文件被修改（UNATTRIBUTED 安装副作用），错误声称 clean。

**整改：**

```bash
cd /Users/daniel/AI项目/openbot-task-focus-unify
git restore extensions/
git status --short          # 预期：无输出（仅 docs 提交前）
bun scripts/agent-attribution.ts   # 预期：dirty files: 0
```

| 复验项                              | 结果（2026-09-13 整改后）           |
| ----------------------------------- | ----------------------------------- |
| `git status --short`（docs 提交前） | **空**                              |
| `agent-attribution`                 | **dirty files: 0**；unattributed: 0 |
| 在途 harmful 源码                   | **不存在**（见 §8）                 |

**说明：** `node_modules` 可存在于 worktree 供测试，但 **不得**留下已跟踪文件的 diff；测试后 `git restore extensions/` 或勿提交 install 副作用。

---

## 3. Ingress 完整分类（Phase 0 定稿）

分类：`ingress` | `nested_caller` | `adapter` | `cross_cut` | `out_of_scope`

### 3.1 核心 Ingress

| Path                                                  | Class   | L1 入口          | 内核路径                  |
| ----------------------------------------------------- | ------- | ---------------- | ------------------------- |
| `src/gateway/server-methods/chat.ts`                  | ingress | `chat.send`      | chat pipeline → Pi/CLI    |
| `src/gateway/collaboration-dispatch/round-runtime.ts` | adapter | 协作 round       | 注入 `runBot`             |
| `src/auto-reply/dispatch-from-config.ts`              | adapter | Channel + chat   | `getReplyFromConfig`      |
| `src/auto-reply/reply/dispatch-acp.ts`                | ingress | ACP session      | ACP runtime（非 Pi/CLI）  |
| `src/gateway/server-methods/agent.ts`                 | ingress | `agent` RPC      | `agentCommandFromIngress` |
| `src/commands/agent.ts`                               | ingress | CLI              | Pi/CLI                    |
| `src/gateway/openai-http.ts`                          | ingress | HTTP completions | `agentCommandFromIngress` |
| `src/gateway/openresponses-http.ts`                   | ingress | OpenResponses    | 同上                      |
| `src/gateway/server-node-events.ts`                   | ingress | 节点事件         | `agentCommandFromIngress` |
| `src/gateway/boot.ts`                                 | ingress | BOOT.md          | `agentCommand`            |
| `src/gateway/server-cron.ts` (isolated)               | ingress | Cron job         | `isolated-agent/run.ts`   |
| `src/gateway/server-cron.ts` (heartbeat)              | ingress | Heartbeat        | `heartbeat-runner`        |
| `src/gateway/supervisor/worker-executor.ts`           | ingress | Supervisor       | `runCliAgent`             |
| `extensions/voice-call/src/response-generator.ts`     | ingress | Voice-call       | Pi                        |

### 3.2 Messaging Channels（ingress → chat 主链）

Telegram、Discord、Slack、Signal、iMessage、WhatsApp Web；扩展 BlueBubbles、Zalo、Feishu、Mattermost、Matrix、MSTeams — 均经 `dispatchInboundMessage` / `dispatchReplyFromConfig` 汇入 chat pipeline。

### 3.3 Nested Callers

`agent-runner-execution.ts`、`agent-runner-memory.ts`、`followup-runner.ts`、`subagent-spawn.ts`、`sessions-send-tool.ts`、`extensions/llm-task/src/llm-task-tool.ts`、`llm-slug-generator.ts`、compaction / overflow LLM。

### 3.4 Cross-Cut

Plugin hooks（`before_model_resolve`、`before_prompt_build`、`before_agent_start`）；`agent-run-governance.ts`；`commercial-run-entrypoints.registry.ts`。

### 3.5 Out of Scope

`gated-candidate-run.ts`（dormant）；`models/list.probe.ts`；ACP runtime 内部（Phase 0–5 不接 Objective）。

---

## 4. Objective Allowlist（Phase 0 定稿）

| ingress                      | 允许 source                                           | 禁止 source                                            |
| ---------------------------- | ----------------------------------------------------- | ------------------------------------------------------ |
| `cron_isolated`              | `cron`                                                | `conversation_task`, `legacy_context`, `collaboration` |
| `chat`                       | `conversation_task`, `legacy_context`, `inbound_turn` | `cron`                                                 |
| `collaboration_turn`         | `collaboration`, `inbound_turn`                       | 个人 legacy 隐式覆盖组目标                             |
| `subagent`                   | inherit parent snapshot                               | 自行 resolve                                           |
| `heartbeat`                  | `inbound_turn`                                        | `conversation_task`, `cron`                            |
| `gateway_agent` / CLI / HTTP | `inbound_turn`, `legacy_context`                      | `cron`, `conversation_task`（除非显式 bind）           |
| `acp`                        | out of scope Phase 0–5                                | —                                                      |

每次 run **冻结** `objectiveId + revision + source`（I9）。

**content / delivery（I15）：**

```text
contentOutcome   = f(execution, validation, enabledAlignmentGate)
deliveryOutcome  = g(deliveryAttempt, deliveryResult)
delivery-only ok ⇔ contentOutcome successful AND deliveryOutcome failed
```

---

## 5. Replay 决策表（共享 dirty tree — **禁止 replay 到 Phase 0 分支**）

**来源：** `/Users/daniel/AI项目/openbot` @ `a79cc5309e`（28 dirty files；15 CONFLICT）

| 文件                                                        | 共享树处置  | 是否 replay 到 `cursor/task-focus-unify-phase0` |
| ----------------------------------------------------------- | ----------- | ----------------------------------------------- |
| `src/cron/isolated-agent/run.ts`（L4 gate）                 | lander 协调 | **禁止** — trunk 本无此代码                     |
| `src/cron/task-focus.ts`                                    | cursor WIP  | **禁止** — 留待 **Phase 1b** 从零新增           |
| `src/conversation-task/ledger-binding.ts`（reply evidence） | CONFLICT    | **禁止**                                        |
| `src/conversation-task/reply-completion.ts`                 | CONFLICT    | **禁止**                                        |
| `src/conversation-task/focus-prompt.ts`                     | CONFLICT    | **禁止** — Phase 3                              |
| UI / CTR 并行 WIP                                           | 各 owner    | **禁止**                                        |
| 本专项设计文档                                              | 本任务      | **是** — 仅 docs/ 两文件提交到 Phase 0 分支     |

**铁律：** clean `origin/main` **不含** harmful WIP → **不得**先 replay 有害代码再制造「回滚 PR」（专家组整改项 #3）。

---

## 6. 门禁测试报告

**环境：** `openbot-task-focus-unify` @ `620c767fb1`，`OPENBOT_TEST_PROFILE=low`
**复跑：** 2026-09-13（整改后，`git restore extensions/` 之后）

### 6.1 命令

```bash
cd /Users/daniel/AI项目/openbot-task-focus-unify
OPENBOT_TEST_PROFILE=low pnpm test \
  src/cron/isolated-agent.uses-last-non-empty-agent-text-as.test.ts \
  src/conversation-task/ledger-binding.test.ts
```

### 6.2 结果

| 套件                                                       | 结果     | Vitest 计数             |
| ---------------------------------------------------------- | -------- | ----------------------- |
| `isolated-agent.uses-last-non-empty-agent-text-as.test.ts` | PASS     | 20 passed               |
| `ledger-binding.test.ts`                                   | PASS     | 3 passed                |
| **合计**                                                   | **PASS** | **23 passed, 0 failed** |
| Exit code                                                  | 0        | Duration ~13–15s        |

### 6.3 未纳入（trunk 无文件）

`task-focus.test.ts`、`reply-completion.test.ts` — Phase 1b 引入后纳入。

### 6.4 信息性对比（dirty shared tree）

`openbot/` @ `a79cc5309e` 含 L4 alignment 时，Cron 套件 **2 failed / 20 passed**。说明 harmful WIP **仅存在于共享树**，必须通过 **隔离/废弃** 处理，**非** Phase 0 分支回滚。

---

## 7. Phase 1a — **N/A**（clean trunk）

| 项         | 说明                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| **结论**   | Phase 1a **不适用**于 `cursor/task-focus-unify-phase0`                                                                    |
| **原因**   | `origin/main` 不存在 L4 alignment gate、`task-focus.ts`、`reply-completion`、reply→Ledger evidence                        |
| **证据**   | `git diff origin/main...HEAD --stat` → 空（docs 提交前）                                                                  |
| **证据**   | `rg assessTaskOutputAlignment src/` → 无匹配                                                                              |
| **证据**   | `rg completeConversationTaskLedgerOnReply src/` → 无匹配                                                                  |
| **下一步** | harmful WIP **禁止 replay**；共享树 WIP 由各自 owner 在 **原分支废弃或重写**；**Phase 1b** 在 Phase 0 签收后 **独立批准** |

---

## 8. Phase 0 退出检查

| 项                                 | 状态                                                      |
| ---------------------------------- | --------------------------------------------------------- |
| Fresh trunk SHA                    | ✅ `620c767fb1`                                           |
| 隔离 worktree + 洁净性             | ✅ §2.1                                                   |
| Ingress / Objective 合同           | ✅ §3–§4                                                  |
| Replay 决策（禁止 harmful replay） | ✅ §5                                                     |
| 门禁测试                           | ✅ §6（23/23，2026-09-13 复跑）                           |
| Git 提交链 + trailers              | ✅ §9（6 commits；签收 tip 见 §9.2 `git rev-parse HEAD`） |
| `git diff --check`                 | ✅ exit 0                                                 |
| Loom register + tasks.md           | ✅ §10                                                    |
| 无生产代码行为变更                 | ✅（docs + registry）                                     |

**Phase 0 结论：COMPLETE v1.4 — 待专家组复验签收。Phase 1a N/A；Phase 1b 未批准。**

---

## 9. Git 证据

| 字段                 | 值                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| **Branch**           | `cursor/task-focus-unify-phase0`                                                                          |
| **HEAD**             | 签收 tip = **`git rev-parse HEAD`**（§9.2；**不内嵌** 40 字符 SHA，见 §9.3）                              |
| **Trunk base**       | **`620c767fb1c47fa9e8206eee1b190165ecfeb1ff`**（`origin/main`，2026-09-13 re-fetch 仍一致）               |
| **领先 origin/main** | **6** commits（docs + governance）                                                                        |
| **Trailers**         | 全部提交含 `Task: task-focus-unified-execution` · `Agent: cursor-task-focus-unify`                        |
| **验收口径**         | §9.2 全绿；`git rev-list --count origin/main..HEAD` 须为 **6**；签收 SHA 以 `git rev-parse HEAD` 输出为准 |

### 9.1 提交链

| SHA                                        | Subject                                                      |
| ------------------------------------------ | ------------------------------------------------------------ |
| `0c783f8e926d08c8321af73fe3e3c8a63e9511e6` | Docs: Phase 0 task-focus unification planning deliverables   |
| `4d0ffb7d2decf72790c7f2cae021b85986b726bc` | Docs: record Phase 0 gate commit SHA in deliverables         |
| `b5f5f295627ee62c265a30c17b2d0cff1879d097` | Docs: fix trailing whitespace on Phase 0 deliverables        |
| `884a523bccec475030fb41dda147d9ef3d857409` | Governance: add task-focus-unified-execution spec tasks.md   |
| `ed12159ee8914987b014280dffbfdf7951a5df94` | Governance: Loom register task-focus-unified-execution owner |
| _（§9.2 `git rev-parse HEAD`）_            | Docs: Phase 0 v1.4 governance evidence and commit chain sync |

### 9.2 复验命令（专家组）

```bash
cd /Users/daniel/AI项目/openbot-task-focus-unify
git fetch origin
git rev-parse HEAD origin/main
git diff --check origin/main...HEAD    # 预期：无输出，exit 0
git status --short                     # 预期：无输出
bun scripts/agent-attribution.ts       # 预期：dirty 0, unattributed 0
pnpm loom status | rg task-focus-unified
git diff origin/main...HEAD --stat
git log origin/main..HEAD --oneline
git rev-list --count origin/main..HEAD   # 预期：6
git rev-parse HEAD                       # 签收 tip（专家组记录此 40 字符 SHA）
```

### 9.3 为何不内嵌 tip SHA（v1.4 定稿）

第 6 条提交（tip）的 tree **若写入 tip 自身 40 字符 SHA**，则 `git commit --amend` 会改变 object id，文档与 `git rev-parse HEAD` **无法同时稳定一致**（非收敛固定点）。v1.4 起：**签收 SHA 以 §9.2 `git rev-parse HEAD` 为唯一真源**；§9.1 末行 subject 标识 v1.4 amend，不写 tip SHA。

---

## 10. Loom 治理（Phase 0 整改项 #1）

| 字段              | 值                                                       |
| ----------------- | -------------------------------------------------------- |
| **Task id**       | `task-focus-unified-execution:cursor-task-focus-unify`   |
| **Owner / Agent** | `cursor-task-focus-unify`                                |
| **Session id**    | `b63f0ca1-e3c2-4242-b29f-8e9bca14fcfe`                   |
| **IDE**           | `cursor`                                                 |
| **Registry**      | `.loom/registry.yaml`（`pnpm loom register` 2026-09-13） |
| **Spec tasks**    | `.kiro/specs/task-focus-unified-execution/tasks.md`      |

验证：

```bash
pnpm loom status --json | rg task-focus-unified
bun scripts/agent-attribution.ts
```

---

## 11. 修订历史

| 版本    | 日期       | 说明                                                                      |
| ------- | ---------- | ------------------------------------------------------------------------- |
| 1.0     | 2026-09-13 | 初版（有误：未提交、worktree 非 clean、Phase 1a 误定义）                  |
| 1.1     | 2026-09-13 | 专家复验整改：restore extensions、Phase 1a N/A、Git 提交                  |
| 1.2     | 2026-09-13 | Loom register + tasks.md；trailing whitespace 清理                        |
| **1.3** | 2026-09-13 | 完整 Git 提交链；§8 退出检查；治理复验就绪                                |
| **1.4** | 2026-09-13 | 6 commits；§9.2/§9.3 签收以 `git rev-parse HEAD` 为真源（不内嵌 tip SHA） |
