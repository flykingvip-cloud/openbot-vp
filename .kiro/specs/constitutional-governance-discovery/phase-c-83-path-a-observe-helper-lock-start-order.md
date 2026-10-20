# Phase C §8.3 ABC Knife2 — Path A observe 助手锁开工令

> 开工令 id：`phase_c_83_path_a_observe_helper_lock_start_order`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-c-83-path-a-observe-helper-lock-start-order.md`。  
> 日期：**2026-09-26**（Asia/Shanghai）  
> 前置接受：`phase-c-83-path-a-observe-helper-lock-acceptance.md`  
> 有界范围：`phase-c-83-path-a-observe-helper-lock-scope.md`  
> 本页是 **ABC Knife2（Path A）第二门开工令**。不是 Meta-Schema 工程开工，不是 C10 pass，不是整段 D GO，不是新 soft-observe，不是 Path B 偷渡。

## 1. 授权一句话

在 Path A observe 助手锁范围已按接受记录记名接受的前提下：

1. **立即授权** discovery 文档三件套 + operate-path / product-confirmation / path-c residual 最小 xref 入库（本 PR）。  
2. **继而授权** 引用本开工令的实现 PR：落地 scope §3 回归锁 ± 可选小范围共享 observe 壳；主张 **`code-present`**；无新旗标；无新 soft-observe；不触豁免入口；不宣称 C10 pass。  
3. **不授权** Path B，直至 Path A 实现关闭后再另立接受 + 开工令。

## 2. 基线

| 项 | 值 |
| --- | --- |
| Base branch | `main` |
| Baseline SHA | `3949ff92e6316c295c3d573076115edaf4a88337`（#87 merge；Path C allowed-entry disposition table lock） |
| Path C docs | #86（`946b3893ecc3f11d5e951e87c79ba90a333cae7e`） |
| §8.3 运营路径 | #85（`f6c6a92360f001e52b568fdf5e5af58dd60a6ee0`） |
| Scope PR | （本 PR；合入后回填 URL） |
| 实现 PR | （另开；须在描述中引用本开工令 id） |

## 3. 落点（paths）

### 3.1 本 PR（docs-only）

| 落点 | 路径 |
| --- | --- |
| 接受记录 | `.kiro/specs/constitutional-governance-discovery/phase-c-83-path-a-observe-helper-lock-acceptance.md` |
| 本开工令 | `.kiro/specs/constitutional-governance-discovery/phase-c-83-path-a-observe-helper-lock-start-order.md` |
| 书面范围 | `.kiro/specs/constitutional-governance-discovery/phase-c-83-path-a-observe-helper-lock-scope.md` |
| 最小 xref | `phase-c-83-operate-path-confirmation-scope.md` §10；`phase-c-83-product-confirmation.md` §1；`phase-c-83-path-c-bypass-table-lock-scope.md` §7 |

### 3.2 实现 PR（引用本令；建议路径）

| 落点 | 路径 |
| --- | --- |
| 回归锁（优先） | `src/agents/execution-preflight/reuse-observe-helper-lock.test.ts`（名可微调） |
| 可选共享壳 | `src/agents/execution-preflight/observe-only-preflight.ts`（仅当五处内联复制已值得抽取且零语义变化） |
| 既有 per-entry 测例收紧 | `tools-invoke-http` / `capability-agent-invoke-runtime` / `nodes` / `dispatch-acp` / `inter-agent-bus` / `cli-steer-preflight-observe` 相关 test |
| FC-07 既有 helper | `src/acp/cli-steer-preflight-observe.ts`（可委托共享壳或保持独立） |
| 对照表 | `src/agents/execution-preflight/allowed-entry-disposition.ts`（只读对齐；**不**改豁免行） |

**不**落点：豁免入口新 observe；新 `OPENBOT_*` 旗标；`packages/constitutional-*`；Path B CTR defer/enforce；Phase C 冻结包；gateway/ACP 热路径 enforce 接线。

## 4. 主张天花板

- 允许：登记「六处 reuse-observe 助手契约已与 #87 旁路表对齐并回归锁定；无新 soft-observe；C10 仍不能 pass」  
- 禁止：`runtime-enabled` / `production-proven` / C10 pass / Decision GO / C GO / 整段 D GO / UNIQUE≥1 / Meta-Schema 工程开席 / Path B 开工

## 5. 回滚

docs-only：

```bash
git revert <scope-docs-landing-commit-sha(s)>
```

实现 PR：

```bash
git revert <implement-commit-sha(s)>
# or delete shared observe shell (+tests) and restore per-entry inline helpers
```

六旗标语义保持 default-off；无新运行时旗标可残留。

## 6. 测试门（实现 PR）

```bash
# 旁路表仍绿（Path C 不回退）
pnpm exec vitest run src/agents/execution-preflight/allowed-entry-disposition.test.ts

# Path A 回归锁（路径以实现 PR 为准）
pnpm exec vitest run src/agents/execution-preflight/reuse-observe-helper-lock.test.ts

# 既有 per-entry observe 测例（实现方可按触及面收窄）
pnpm exec vitest run src/acp/cli-steer-preflight-observe.test.ts
# + tools-invoke / capability-invoke / nodes.invoke / dispatch-acp / inter-agent-bus 相关 observe 测例
```

须覆盖：六 ENV 名稳定；#87 六行仍 `reuse-observe`；observe 路径不 `applyPreflightToTools` / 不 `armCompletionHold`；flag default-off。

## 7. OUT（本开工令不授权）

- 新 soft-observe；豁免入口接线；破玻璃开关  
- Path / Gate / enforce / live invoke；Fabric-on  
- C10 pass；Decision GO；整段 D GO；C GO  
- Path B（须 Path A 关闭后另文）  
- Meta-Schema / constitutional-contracts / 四产品工程  
- 改写冻结正文；重开 #58–#87 为杂项清单  
- 本 scope PR 内直接改 `src/`（实现必须另 PR）

## 8. 残差

- Path B consult 抛光 — Path A 关闭后另文  
- C10 pass 挡门项 — 不由本刀关闭  
- #80 推翻路径 — 不启动  
