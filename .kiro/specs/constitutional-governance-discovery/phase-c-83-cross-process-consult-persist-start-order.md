# Phase C §8.3 残差刀 — cross-process consult/receipt persist 开工令

> 开工令 id：`phase_c_83_cross_process_consult_persist_start_order`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-c-83-cross-process-consult-persist-start-order.md`。  
> 日期：**2026-09-26**（Asia/Shanghai）  
> 前置接受：`phase-c-83-cross-process-consult-persist-acceptance.md`  
> 有界范围：`phase-c-83-cross-process-consult-persist-scope.md`  
> 本页是 **cross-process consult/receipt persist 第二门开工令**。不是 Meta-Schema 工程开工，不是 C10 pass，不是整段 D GO，不是跨域写权威 / defer-close / enforce 偷渡。

## 1. 授权一句话

在 cross-process consult/receipt persist 范围已按接受记录记名接受的前提下：

1. **立即授权** discovery 文档三件套 + Path B / cancel residual（± operate-path / C10 progress）最小 xref 入库（本 PR；**docs-only**）。  
2. **继而授权** 引用本开工令的**后续**实现 PR：窄持久化 delivery-close consult 记录 / validation receipts 跨进程重启；主张 **`code-present`**；若有 ENV 则 **default-off**；**必须不**改 `closeDeferred`；无跨域写；无 enforce；无 live invoke；不宣称 C10 pass。  
3. **不授权** 跨域写权威、C10 claim gate / pass、defer-close、enforce、Meta-Schema / Phase D / Path-Gate 收紧、或改写 Phase C 冻结正文。

两段门说明（与 cancel-path / Path B 同构）：**本 PR 只落文档**；实现必须另开 PR，并在描述中引用本开工令 id（`phase_c_83_cross_process_consult_persist_start_order`）。合入本 docs PR ≠ 授权在本 PR 改 `src/`。**本 turn 不开实现 PR。**

## 2. 基线

| 项 | 值 |
| --- | --- |
| Base branch | `main` |
| Baseline SHA | `8b107a3d01dccdb78ba4404e6f80c4b25cf1514c`（#96 merge；cancel-path consult observe impl） |
| Cancel impl | #96（`8b107a3d…` / impl tip `2e85ed99…`） |
| Cancel docs | #95 |
| Path B impl | #92（`e371bc03…`） |
| Path B docs | #91 |
| Path A impl | #89 |
| Path A docs | #88 |
| Path C impl | #87 |
| Path C docs | #86 |
| §8.3 运营路径 | #85 |
| Scope PR | （本 PR；合入后回填 URL） |
| 实现 PR | （另开；须在描述中引用本开工令 id；**本 turn 不开**） |

站桩：Path B / cancel 合入 ≠ PASS/GO；C10 仍不能 pass；unique-benefit FAIL；NO-GO COMPLETE。

## 3. 落点（paths）

### 3.1 本 PR（docs-only）

| 落点 | 路径 |
| --- | --- |
| 接受记录 | `.kiro/specs/constitutional-governance-discovery/phase-c-83-cross-process-consult-persist-acceptance.md` |
| 本开工令 | `.kiro/specs/constitutional-governance-discovery/phase-c-83-cross-process-consult-persist-start-order.md` |
| 书面范围 | `.kiro/specs/constitutional-governance-discovery/phase-c-83-cross-process-consult-persist-scope.md` |
| 最小 xref | `phase-c-83-path-b-ctr-consult-polish-scope.md` §7；`phase-c-83-path-b-ctr-consult-polish-start-order.md` §8；`phase-c-83-cancel-path-consult-observe-scope.md` §7；`phase-c-83-cancel-path-consult-observe-start-order.md` §8；可选 `phase-c-83-operate-path-confirmation-scope.md` §10 / `phase-c-83-c10-claim-gate-progress.md` |

### 3.2 实现 PR（引用本令；建议路径；本 turn 不开）

| 落点 | 路径 |
| --- | --- |
| consult/receipt 持久化 | conversation-task / completion-hold 邻域本域 storage（路径以实现 PR 为准）— **仅** delivery-close consult 记录 / validation receipts |
| ENV | 若有：须 **default-off**；禁 enforce；禁 default-on；语义不对则停笔等 Owner |
| 回归测例 | 新增/扩展 vitest：重启（或等价）后记录仍在；closeDeferred 恒 false；不 defer close/cancel；flag off 行为不变 |
| 对照 | 今日 in-process ring `DELIVERY_CLOSE_CONSULT_LIMIT=32`；FC-02 / cancel-path 形状（observe；吞错；不 defer） |

**不**落点：跨域写权威；defer-close；enforce；C10 claim gate；新 enforce `OPENBOT_*`；`packages/constitutional-*`；Phase C 冻结包；重开 Path A/B/C / cancel 已锁契约。

## 4. 主张天花板

- 允许：登记「delivery-close consult/receipt 可跨进程重启保留（default-off；不改 closeDeferred；无跨域写）；C10 仍不能 pass；Path B / cancel 合入 ≠ PASS/GO」  
- 禁止：`runtime-enabled` / `production-proven` / C10 pass / Decision GO / C GO / 整段 D GO / UNIQUE≥1 / Meta-Schema 工程开席 / 跨域写 / defer-close / enforce

## 5. 回滚

docs-only：

```bash
git revert <scope-docs-landing-commit-sha(s)>
```

实现 PR：

```bash
git revert <implement-commit-sha(s)>
# or remove persist layer + tests; restore in-process ring-only shape
```

不得留下 defer close/cancel 行为；无 enforce 旗标可残留；closeDeferred 语义不得被改脏。

## 6. 测试门（实现 PR）

```bash
# Path B / Path A / Path C / cancel-path 回归不回退
pnpm exec vitest run src/agents/execution-preflight/ctr-close-consult-lock.test.ts
pnpm exec vitest run src/agents/execution-preflight/reuse-observe-helper-lock.test.ts
pnpm exec vitest run src/agents/execution-preflight/allowed-entry-disposition.test.ts
pnpm exec vitest run src/conversation-task/reply-completion.test.ts
pnpm exec vitest run src/agents/execution-preflight/completion-send.test.ts
# cancel-path consult 测例（路径以实现合入后为准）
# pnpm exec vitest run <cancel-path-consult-observe-lock.test.ts>

# 跨进程 persist 测例（路径以实现 PR 为准）
# pnpm exec vitest run <cross-process-consult-persist.test.ts>
```

须覆盖：重启（或等价）后 consult/receipt 仍可读；default-off；**永不**改 closeDeferred / 推迟 close/cancel；无跨域写；无 enforce；无 live invoke。

## 7. OUT（本开工令不授权）

- 跨域写权威；跨账本单点写入；C11 工程单写  
- defer-close；`closeDeferred: true`；条件化跳过 `cancelled`/`closed`  
- enforce；Path / Gate；live invoke；Fabric-on  
- C10 claim gate / pass；Decision GO；整段 D GO；C GO  
- Meta-Schema / Phase D / Path-Gate 收紧；constitutional-contracts / 四产品工程  
- 改写冻结正文；重开 #58–#96 为杂项清单  
- 本 scope PR 内直接改 `src/`（实现必须另 PR；本 turn **不开**实现 PR）  
- 发明 enforce 旗标；default-on ENV

## 8. 残差

- C10 claim-gate residual — **另文已立**（同批）：`phase-c-83-c10-claim-gate-residual-*`（**C10 仍不能 pass**）  
- C10 pass 挡门项 — 不由本刀关闭  
- Meta-Schema / Phase D / Path-Gate — 未授权  
- 跨域写 / C11 单写 — 未授权  
- #80 推翻路径 — 不启动  
