# Collaboration Runtime v1 + CSC v1.1 生产验收决定

Date: 2026-08-22

Status: **已签署 · 最新 tip 代码/测试通过 · 生产部署 BLOCKED**

Parents: [协作运行协议 v1.0](/design/collaboration-runtime-protocol-v1-execution-2026-08-21) · [Production Runtime Contract](/design/collaboration-production-runtime-contract-v1-2026-08-21) · [CSC v1.1](/design/context-scope-controller-v1-supplement-2026-08-21)

---

## 0. 决定

2026-08-22 15:25 签署。现行唯一生产发布输入是当时最新的 `origin/main` tip。过期 candidate tag **不得**继续当发布输入。

| 项                                                  | 决定                                                       |
| --------------------------------------------------- | ---------------------------------------------------------- |
| 退役 `48ee0918c795` / `provenance/sha-48ee0918c795` | 代码/测试 PASS · 已退役                                    |
| 退役 `d40e685586` / `provenance/sha-d40e685586ec`   | 代码/测试 PASS · 已退役                                    |
| 退役 `2e09b95e7376` / `provenance/sha-2e09b95e7376` | 代码/测试 PASS · 已退役                                    |
| 退役 `555eef84041c` / `provenance/sha-555eef84041c` | 代码/测试 PASS · 已退役                                    |
| 现行候选 `25df222f26971854b00f52a611e810c26e2e8b91` | **PASS** · 15 files / 85 passed · 无 overlay · dirty=0     |
| Implementation / Contract tests / 统一性            | **PASS**                                                   |
| Provenance L1（本地 candidate tag）                 | `provenance/sha-25df222f2697` · **未 push** · 不是 cutover |
| Release ledger / LIVE 对齐                          | **PENDING**                                                |
| Production deployment                               | **BLOCKED · 禁止切流**                                     |
| 脏工作区 / 侧分支 tip                               | **不得作为构建或部署输入**                                 |

LIVE 仍是 `5480cefe12`（overlay `context-compiler-main-r1`），不含现行候选。未为 `25df222f26` 写入 `releases.jsonl`。

本合同签署的是「当前 tip 能不能当主干候选」，不是「能不能上生产」。设计原则保持冻结。

---

## 1. 批准的统一生产流程

唯一允许的生产链路：

```text
用户输入
  → Scope Resolution
  → Mandatory Context + User Scope
  → Authorization / Policy Filter
  → Retrieval Plan
  → Context Assembly
  → Intent / Inbound Depth
  → Round State Machine
  → Primary / Supplement Dispatch
  → Execution
  → Quality Review
  → Ledger
  → Memory Learning（仅在治理条件满足时）
```

职责锁死：

| 层                   | 决定什么                                |
| -------------------- | --------------------------------------- |
| Collaboration Policy | 怎么协作                                |
| Context Policy / CSC | 本轮允许看什么                          |
| Round State Machine  | 当前能否执行                            |
| Retrieval Planner    | 从授权源里具体取什么                    |
| Ledger               | 事实                                    |
| Memory Learning      | 不得从 Context 使用结果直接写回个人记忆 |

若 CSC 另起执行循环、权限模型或账本，判定为架构分叉，**不能接受**。

---

## 2. Collaboration Runtime v1 — 历史 P0 合同（已由 #589 / #594 关闭）

以下四项曾批准为 P0 运行时合同阻断。现行主干已含修复；**不再作为现行代码闸门**。未完成第 0 节生产对齐之前，仍不得签署生产部署。

### 2.1 `stepRound()` 吞异常后继续构造内存状态

`src/gateway/collaboration-dispatch/round-runtime.ts` 的 `stepRound()` 在 `applyRoundTransition()` 失败后 `catch` 空捕获，仍用 `transitionRoundState()` 拼一份仅存在于内存的 round，并返回给后续调度。这违反 fail-closed 与恢复合同（C2 / C5）：CAS、IO、持久化失败后，调度层以为状态已前进，磁盘上没有对应快照/事件。

### 2.2 Round Store CAS 不是原子 CAS

`writePersistedRound()` 先 `readPersistedRound()` 再 `writeFile()`。这是 read-then-write，不是单次原子 compare-and-swap。并发 `transition` 可以互相覆盖。`expectedStateVersion` 检查与写入之间没有文件锁或原子 rename-if-match。

### 2.3 `CANDIDATE_DROPPED` 绕过统一 transition

Cheap Gate DROP 走 `recordCandidateDropped()` → 只 `appendRoundEvent()`。不经过 `applyRoundTransition()`，因此 **不推进** 快照的 `lastEventSeq` / `stateVersion` / `seenEventIds`。事件序列与快照分叉。

### 2.4 快照写入与事件追加不是一次提交

`applyRoundTransition()` 先 `writePersistedRound()` 再 `appendRoundEvent()`。中间失败会出现「状态已变、账本缺事件」。没有 journal / 临时文件 / 同事务提交。

### 2.5 一并确认的非 P0 但同样阻断生产签署的项

- `seenEventIds.slice(-200)`：eventId 幂等不是永久拒绝（C3 不满足）。
- 当前工作区大量未提交变更：不能作为生产候选输入。
- R1–R10 测试文件存在，但**干净的 `origin/main` worktree 上的可重复执行证据**尚未作为本决定的附件；脏树上的局部跑通不能替代合同证据。

条款对照：C2 State Persistence、C3 Event Idempotency、C5 Cancel / Recovery 均未闭合。

---

## 3. CSC v1.1 — 生产不通过（事实更正 + 仍不签署）

### 3.1 批准审查方的生产结论

CSC **不得宣称已接入可部署的 Collaboration Runtime**。以下验收矩阵在生产意义上仍未满足：

1. 普通聊天不触发知识库 / Workspace 全量扫描 — **无干净主干证据**
2. 明确指定文件时只访问该文件 — **无干净主干证据**
3. 群 Mandatory Context 与额外检索分层 — **无干净主干证据**
4. Scope 请求经过授权和保密过滤 — **无干净主干证据**
5. Context Budget 在运行时强制生效 — **未满足**（预算写入 audit 字段，检索路径没有硬截断）
6. Scope 结果进入 Round 快照、事件和 Ledger — **未满足**（Round 快照可挂 `contextScopePlan`；**未写入 Collaboration Ledger**；授权后的 plan 不保证回写 round 事件）
7. 来源可解释性与审计可被企业验收 — **未满足**（另有 `context-scope-audit.jsonl`，不是 Ledger；构成平行账本风险）

### 3.2 必须更正的审查表述

「主工作区没有发现 ContextScopeController / ContextScopePlan」**对当前脏工作区不成立**。本树已有未提交 WIP：

- `src/gateway/context-scope/`（controller / plan / budget / authorize / audit / catalog / expansion）
- `get-reply-run.ts`：先 `resolveContextScopePlan` + `authorizeContextScopePlan`，再决定是否 `buildKnowledgeUniversePromptContext`
- `bootstrapCollaborationRound`：把 plan 冻进 `PersistedRound.contextScopePlan`

这只证明**方向没有分叉**，不证明**可验收**。

`get-reply-run.ts → buildKnowledgeUniversePromptContext` 仍然存在，这是 Retrieval Planner 的入口，不是 CSC 缺失的充分证据。充分证据必须是：Scope 过滤之后，minimal 不预取、focused 只打所选源、budget 硬限制、结果进入 **同一条** Round 事件 + Collaboration Ledger。

当前 CSC WIP **不得**作为「已完成 / 已接入 Runtime」对外陈述。在 Round Store 合同修复并落到干净 `origin/main` 之前，CSC 状态标记为 **未完成**。

### 3.3 禁止项（再次确认）

- 不把 CSC audit JSONL 做成第二套生产账本；最终必须并入 Collaboration Ledger 或作为其派生投影
- 不绕过 Member Visibility
- 不从 Context 使用结果直写个人记忆
- 不 overlay LIVE

---

## 4. 批准的下一步顺序（锁死）

只允许按此顺序，不得并行开新的协作话术 / 辩论 / 第二套 Runtime：

1. **先修 Round Store（P0 合同）**
   - `stepRound()` fail-closed：持久化失败必须抛出 / 中止调度，禁止内存假前进
   - 原子 CAS：同一 `stateVersion` 的 compare-and-swap（文件锁或 write-to-tmp + 校验后 rename，且冲突 fail-closed）
   - `CANDIDATE_DROPPED` 走统一 `applyRoundTransition`（或等价地推进 `lastEventSeq` / `stateVersion`）
   - 快照 + 事件一次提交（先写事件再改快照，或 journal；不允许已变状态缺事件）
   - eventId 永久幂等（持久化 seen 集，不得只留最近 200）
2. **再补齐 CSC 接入（仍走同一 Runtime）**
   - Scope Plan 授权 + 密级过滤的结果写回 Round 快照
   - Budget 在检索路径强制生效
   - Scope 进入 Round 事件 + Collaboration Ledger（禁止平行账本成为 SoT）
   - 1:1 与群聊同一套 Scope / Retrieval / Assembly / Ledger 语义
3. **最后在干净的最新 `origin/main` worktree 重跑**
   - R1–R10
   - CSC 验收矩阵（上节 7 条）
   - 通过之前，生产部署保持禁止

---

## 5. 签署栏

| 角色               | 结论                       |
| ------------------ | -------------------------- |
| 专家验收           | 整体不通过；禁止生产部署   |
| 执行团队（本决定） | **批准上述结论与修复顺序** |
| 生产 cutover       | **不得启动**               |

签署日期：2026-08-22

---

## 6. 干净 `origin/main` 重跑附件（2026-08-22 01:11）

本附件只记录第三步执行证据，**不改写第 0 节生产闸门**。

| 项                 | 值                                                                                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 基线               | `origin/main` `e0d5c3750166692bbcdd324854ee65e4a358a9f1`（PR #584）                                                                                                  |
| 工作树             | `/tmp/openbot-collab-csc-acceptance`（detached，未切本会话工作区分支）                                                                                               |
| 候选构造           | 在该基线上 overlay 本切片：`src/gateway/collaboration-dispatch/`、`src/gateway/context-scope/`、`src/gateway/collaboration-ledger/`、`knowledge-universe-context.ts` |
| `get-reply-run.ts` | **未 overlay**（仍为主干文件）。Ledger/Scope 接线证据在模块测试，不在主干 reply 入口                                                                                 |
| 脏工作区 HEAD      | `5480cefe12`（落后 `origin/main`；`origin/main` 不是当前脏树 ancestor）                                                                                              |

### 6.1 R1–R10 + Round Store 合同

`OPENBOT_TEST_PROFILE=low pnpm exec vitest run` 于上述 worktree：

- `round-runtime.test.ts` + `round-store.test.ts` + `round-state-machine.test.ts`：**3 files / 26 tests passed**
- 含 R1–R10、CAS 并发 fail-closed、txn 恢复、永久 eventId、`CANDIDATE_DROPPED` 推进 `stateVersion`/`lastEventSeq`

### 6.2 CSC 验收矩阵（单元 / 模块）

| #   | 矩阵项                              | 干净树上的证据                                                                                                                          | 结果                            |
| --- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 1   | 普通聊天不预取知识库 / 不全量扫描   | `controller.test.ts` minimal；主干 `inbound-depth` chat lane skip；`get-reply-run.inbound-depth-*.test.ts` 20 passed（主干 reply 入口） | 通过（模块）                    |
| 2   | 明确指定文件时只访问该文件          | `controller.test.ts` focused；`knowledge-hints.test.ts` file/folder ids                                                                 | 通过（模块）                    |
| 3   | 群 Mandatory Context 与额外检索分层 | `controller.test.ts` group mandatory cannot be turned off                                                                               | 通过（模块）                    |
| 4   | Scope 经授权和保密过滤              | `authorize.test.ts` 4 cases                                                                                                             | 通过（模块）                    |
| 5   | Context Budget 运行时硬截断         | `budget.test.ts` maxFiles=0 / cap / maxTokens                                                                                           | 通过（模块）                    |
| 6   | Scope 进入 Round 快照 + Ledger      | `runtime-join.test.ts` 回写快照；`reader.test.ts` `kind: context_scope`                                                                 | 通过（模块）                    |
| 7   | 可解释性 / 企业审计                 | `audit.test.ts` 仍写 JSONL；Ledger 已有 `context_scope`。JSONL 不得当生产 SoT                                                           | 部分：Ledger 有记录，JSONL 仍在 |

同批 CSC 相关：`context-scope` + ledger + inbound-depth + mention-resolution **12 files / 51 tests passed**。

### 6.3 仍禁止生产部署的原因

1. Overlay **不是** `origin/main` tip 上的已合并提交；生产只能切 `origin/main` 合入后的 SHA。
2. 当前脏分支 `cursor/connect-live-collab-sot` **落后** `origin/main`，不能把脏树 tip 当候选。
3. 主干 `get-reply-run.ts` 尚未带上 Scope→Ledger 接线；1:1 与群在主干 reply 入口上的同一语义未在该 worktree 的入口文件上证明。
4. `context-scope-audit.jsonl` 仍存在，只能当 Ledger 的派生投影，不能当第二套 SoT。

下一步（仍不 overlay LIVE）：把本切片经 PR 合入 `main` 后，在新的 `origin/main` tip **无 overlay** 再跑同一命令。合入前生产闸门保持 **禁止**。

---

## 7. 2026-08-22 复验：专家主张核对（不改写第 0 节闸门）

本轮专家结论「仍不通过、禁止部署」**对生产闸门仍然成立**。下列主张按输入对象拆开核验，避免把脏树 / 旧 overlay 附件误当成当前 trunk。

| 专家主张                                                     | 核对对象                                                 | 结论                                                                                                                              |
| ------------------------------------------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `origin/main...HEAD = 155 0` 且 `origin/main` 不是 HEAD 祖先 | 脏工作区 `cursor/connect-live-collab-sot` @ `5480cefe12` | **成立**。该树不得构建或部署。                                                                                                    |
| 工作树仍有 211 个 dirty 项                                   | 同上脏工作区                                             | **成立**（`git status --porcelain` = 211）。                                                                                      |
| 测试是 overlay，不是主干候选                                 | 本文第 6 节 `/tmp/openbot-collab-csc-acceptance` 附件    | **对第 6 节成立**。该附件不能再当生产候选证据。                                                                                   |
| `get-reply-run.ts` 没有 overlay / 入口未接线                 | 第 6 节 overlay 构造                                     | **当时成立**。                                                                                                                    |
| 基线仍未合入主干                                             | 当前 `origin/main`                                       | **已过时**。PR [#589](https://github.com/gmood2008/openbot/pull/589) 已于 2026-08-21T19:54:00Z 合入，merge `02b48596d0`。         |
| CSC 审计仍存在平行 JSONL                                     | 合入后主干 + 生产方法                                    | **部分成立**。JSONL 文件仍作为派生投影写入；合入时 `context.scope.audit.list` 仍读 JSONL。后续切片改为只读 Collaboration Ledger。 |
| 缺少合入后 SHA / 对齐 / provenance / LIVE                    | 生产 cutover                                             | **成立**。本轮未 overlay LIVE，未打 `provenance/sha-*`，LIVE 容器当时不可用。这些是 cutover 门，不是「代码未进主干」的证明。      |

### 7.1 合入后无 overlay 复跑（已完成，仍不签署生产）

| 项           | 值                                                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 首次干净 tip | `/tmp/openbot-collab-csc-main-verify` detached `02b48596d0`（当时等于 `origin/main`，无 overlay）                                               |
| 含候选       | `2595f88197`（#589 fail-closed authorize + persist-before-retrieve）                                                                            |
| 套件         | R1–R10 + Round Store CAS + CSC + inbound-depth：**14 files / 79 passed**                                                                        |
| 日志         | `/tmp/collab-csc-main-verify-02b48596d0.log`                                                                                                    |
| 主干入口     | `get-reply-run.ts` 已含 authorize → persist（托管群 `requireSnapshot`）→ `mayRetrieveOptionalKnowledge` → retrieve；JSONL 仅 best-effort append |

`origin/main` 此后继续前进（dependabot 等）。#589 **仍是祖先**。后续入口 / Ledger SoT 修补必须从**当时最新** `origin/main` 再开 PR，不得回到脏树。

### 7.2 本轮仍禁止部署的原因（有效）

1. 脏工作区 `5480cefe12` 落后主干 155 提交且 211 dirty，**不是**候选。
2. 第 6 节 overlay 附件**作废**，不能再引用为生产证据。
3. 生产镜像 / LIVE `build-info.json` / `provenance/sha-*` / `verify-delivery-alignment` 尚未对 `02b48596d0` 或更新 tip 签署。`pnpm delivery:ledger:audit` 在干净树上为 29 releases / **0 errors**（历史 overlay 警告保留）。
4. `context-scope-audit.jsonl` 仍可本地写入；在生产方法改读 Ledger 之前，企业审计面仍有平行账本风险。

生产 cutover 继续禁止。#594 已合入。现行闸门与下一步见第 8 节。

---

## 8. 2026-08-22 12:03 签署：最新 tip 复验通过，仍禁止切流

| 项                          | 值                                                                    |
| --------------------------- | --------------------------------------------------------------------- |
| 现行候选                    | `555eef84041cbbe54b05f99f6965c7c057f55900`（Merge #600）              |
| 复验树                      | `/tmp/openbot-csc-final-555eef84041` · dirty=0 · 无 overlay           |
| 套件                        | 15 files / 85 passed · `/tmp/openbot-csc-final-555eef84041-tests.log` |
| 本地 tag                    | `provenance/sha-555eef84041c`（candidate identity，未 push）          |
| `delivery:ledger:audit`     | 31 releases / 0 errors / 11 historical warnings                       |
| `verify-forward-only`       | allow · LIVE `5480cefe12` 是候选祖先                                  |
| `cutover-from-ghcr --plan`  | forward-only PASS · 未 stage/swap                                     |
| `verify-delivery-alignment` | FAIL=1：origin 无该 tag                                               |
| LIVE `build-info.json`      | `5480cefe12` · overlay `context-compiler-main-r1`                     |
| GHCR 镜像                   | 无（Docker Release 仍因 Actions 账单失败）                            |
| 退役 tag                    | `48ee0918c795`、`d40e685586ec`、`2e09b95e7376`                        |

PR [#603](https://github.com/gmood2008/openbot/pull/603) 已批准；本签署文档 rebase 到当前 `origin/main` 后合入。合入**不**等于生产 cutover。

下一步只允许对**当时最新** `origin/main` 做发布准备：GHCR 镜像 → alignment → ledger → smoke → 灰度 → 回滚演练。全部绿灯前 **不许切 LIVE**。若主干再次前进，必须作废本 tip 并重跑。

---

## 9. 2026-08-22 15:25 签署：最新 tip `25df222f26` 复验通过，仍禁止切流

| 项                          | 值                                                                      |
| --------------------------- | ----------------------------------------------------------------------- |
| 现行候选                    | `25df222f26971854b00f52a611e810c26e2e8b91`（#597 Task Progress Ledger） |
| 复验树                      | `/tmp/openbot-csc-final-25df222f26` · dirty=0 · 无 overlay              |
| 套件                        | 15 files / 85 passed · `/tmp/openbot-csc-final-25df222f26-tests.log`    |
| 本地 tag                    | `provenance/sha-25df222f2697`（candidate identity，未 push）            |
| `delivery:ledger:audit`     | 31 releases / 0 errors / 11 historical warnings                         |
| `verify-forward-only`       | allow · LIVE `5480cefe12` 是候选祖先                                    |
| `verify-delivery-alignment` | **未跑完 / 预期 FAIL**（origin 无 tag、无 GHCR 镜像）                   |
| LIVE `build-info.json`      | `5480cefe12` · overlay `context-compiler-main-r1`                       |
| GHCR 镜像                   | 无（Docker Release 仍因 Actions 账单失败）                              |
| 退役 tag                    | `555eef84041c`、`48ee0918c795`、`d40e685586ec`、`2e09b95e7376`          |

PR [#603](https://github.com/gmood2008/openbot/pull/603) 已批准；本签署文档 rebase 到 `25df222f26` 后合入。合入**不**等于生产 cutover。

下一步（Step 3）：恢复 Actions 计费 → push `provenance/sha-25df222f2697` → GHCR 镜像 → `cutover-from-ghcr --stage` → alignment → ledger → smoke / 灰度 / 回滚演练。全部绿灯前 **不许切 LIVE**。若主干再次前进，必须作废 `25df222f26` 并重跑 Step 1。
