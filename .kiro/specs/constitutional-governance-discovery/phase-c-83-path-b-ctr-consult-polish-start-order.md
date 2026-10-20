# Phase C §8.3 ABC Knife3 — Path B CTR consult 抛光开工令

> 开工令 id：`phase_c_83_path_b_ctr_consult_polish_start_order`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-c-83-path-b-ctr-consult-polish-start-order.md`。  
> 日期：**2026-09-26**（Asia/Shanghai）  
> 前置接受：`phase-c-83-path-b-ctr-consult-polish-acceptance.md`  
> 有界范围：`phase-c-83-path-b-ctr-consult-polish-scope.md`  
> 本页是 **ABC Knife3（Path B）第二门开工令**。不是 Meta-Schema 工程开工，不是 C10 pass，不是整段 D GO，不是 defer-close / enforce 偷渡。

## 1. 授权一句话

在 Path B CTR consult 抛光范围已按接受记录记名接受的前提下：

1. **立即授权** discovery 文档三件套 + operate-path / product-confirmation / path-a residual / path-c residual 最小 xref 入库（本 PR）。  
2. **继而授权** 引用本开工令的实现 PR：落地 scope §3 回归锁 ± 可选 CTR 显式 `taskId` 传参；主张 **`code-present`**；无新旗标；无 defer-close；无 enforce；不宣称 C10 pass。  
3. **不授权** cancel 路径新 consult、跨进程持久化、或任何推迟 `closed` 的行为。

## 2. 基线

| 项 | 值 |
| --- | --- |
| Base branch | `main` |
| Baseline SHA | `5566bc3f77f8f033cb95324e95dbeb2ea650e6f4`（#89 merge；Path A reuse-observe helper lock） |
| Path A docs | #88（`f34a7d8fbef9d9321b75259198f66525e2d0d8e6`） |
| Path C impl | #87（`3949ff92e6316c295c3d573076115edaf4a88337`） |
| Path C docs | #86（`946b3893ecc3f11d5e951e87c79ba90a333cae7e`） |
| §8.3 运营路径 | #85（`f6c6a92360f001e52b568fdf5e5af58dd60a6ee0`） |
| Scope PR | （本 PR；合入后回填 URL） |
| 实现 PR | （另开；须在描述中引用本开工令 id；**本 turn 不开**） |

## 3. 落点（paths）

### 3.1 本 PR（docs-only）

| 落点 | 路径 |
| --- | --- |
| 接受记录 | `.kiro/specs/constitutional-governance-discovery/phase-c-83-path-b-ctr-consult-polish-acceptance.md` |
| 本开工令 | `.kiro/specs/constitutional-governance-discovery/phase-c-83-path-b-ctr-consult-polish-start-order.md` |
| 书面范围 | `.kiro/specs/constitutional-governance-discovery/phase-c-83-path-b-ctr-consult-polish-scope.md` |
| 最小 xref | `phase-c-83-operate-path-confirmation-scope.md` §10；`phase-c-83-product-confirmation.md` §1；`phase-c-83-path-a-observe-helper-lock-scope.md` §7；`phase-c-83-path-c-bypass-table-lock-scope.md` §7 |

### 3.2 实现 PR（引用本令；建议路径；本 turn 不开）

| 落点 | 路径 |
| --- | --- |
| 回归锁（优先） | `src/agents/execution-preflight/ctr-close-consult-lock.test.ts`（名可微调） |
| 显式 taskId 契约 | `src/agents/execution-preflight/completion-send.test.ts`（扩展）和/或上述 lock |
| 可选 CTR 传 taskId | `src/conversation-task/reply-completion.ts`（仅零 defer 语义） |
| 既有 reply 测例收紧 | `src/conversation-task/reply-completion.test.ts` |
| 对照表 | `src/agents/execution-preflight/allowed-entry-disposition.ts`（只读对齐 CTR 行；**不**改处置） |
| 对照实现 | `consultDeliveryHoldForClose` in `completion-hold.ts`；`observeConversationTaskReplyCompleted` in `reply-completion.ts` |

**不**落点：defer-close；enforce；cancel 新 consult；新 `OPENBOT_*` 旗标；跨进程持久化；`packages/constitutional-*`；Phase C 冻结包；把 CTR 行改成 `reuse-observe`。

## 4. 主张天花板

- 允许：登记「CTR 整行 `n/a-not-tri-state` 已与 FC-02 consult 形状对齐并回归锁定；`closeDeferred` 恒 false；显式 taskId API 契约稳定；无 defer-close；C10 仍不能 pass」  
- 禁止：`runtime-enabled` / `production-proven` / C10 pass / Decision GO / C GO / 整段 D GO / UNIQUE≥1 / Meta-Schema 工程开席 / defer-close / enforce

## 5. 回滚

docs-only：

```bash
git revert <scope-docs-landing-commit-sha(s)>
```

实现 PR：

```bash
git revert <implement-commit-sha(s)>
# or delete ctr-close-consult-lock test (+ optional taskId pass-through) and restore prior call shape
```

FC-02 旗标语义保持 default-off；无新运行时旗标可残留；close 路径不得留下 defer 行为。

## 6. 测试门（实现 PR）

```bash
# 旁路表仍绿（Path C 不回退；CTR 行仍 n/a-not-tri-state）
pnpm exec vitest run src/agents/execution-preflight/allowed-entry-disposition.test.ts

# Path A 回归锁仍绿（不回退）
pnpm exec vitest run src/agents/execution-preflight/reuse-observe-helper-lock.test.ts

# Path B 回归锁（路径以实现 PR 为准）
pnpm exec vitest run src/agents/execution-preflight/ctr-close-consult-lock.test.ts

# 既有 FC-02 / consult 测例
pnpm exec vitest run src/conversation-task/reply-completion.test.ts
pnpm exec vitest run src/agents/execution-preflight/completion-send.test.ts
```

须覆盖：ENV 名稳定；CTR 行仍 `n/a-not-tri-state`；observe→consult 且 `closeDeferred: false`；flag default-off；显式 `taskId` 契约；咨询失败仍写 `closed`。

## 7. OUT（本开工令不授权）

- defer-close；`closeDeferred: true`；条件化跳过 `closed`  
- enforce；Path / Gate；live invoke；Fabric-on  
- cancel 路径新 consult；跨进程持久化  
- 新 soft-observe；豁免入口接线；新 `OPENBOT_*` 旗标  
- C10 pass；Decision GO；整段 D GO；C GO  
- Meta-Schema / constitutional-contracts / 四产品工程  
- 改写冻结正文；重开 #58–#89 为杂项清单  
- 本 scope PR 内直接改 `src/`（实现必须另 PR；本 turn **不开**实现 PR）

## 8. 残差

- cancel 路径 consult — **另文已立**：`phase-c-83-cancel-path-consult-observe-scope.md` + acceptance + start-order；**实现已合入** #96（`8b107a3d`；仍禁 defer；本 Path B 开工令仍 **不授权** 重开 cancel）  
- 咨询/收据跨进程持久化 — **另文已立**：`phase-c-83-cross-process-consult-persist-scope.md` + acceptance + start-order（本 Path B 开工令仍 **不授权** 跨进程持久化实现）  
- C10 claim-gate residual（**非** pass）— **另文已立**：`phase-c-83-c10-claim-gate-residual-*`；**C10 仍不能 pass**；挡门项不由本刀关闭  
- #80 推翻路径 — 不启动  
