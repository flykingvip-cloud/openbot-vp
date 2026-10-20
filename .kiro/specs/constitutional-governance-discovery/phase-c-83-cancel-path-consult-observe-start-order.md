# Phase C §8.3 残差刀 — cancel-path consult observe 开工令

> 开工令 id：`phase_c_83_cancel_path_consult_observe_start_order`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-c-83-cancel-path-consult-observe-start-order.md`。  
> 日期：**2026-09-26**（Asia/Shanghai）  
> 前置接受：`phase-c-83-cancel-path-consult-observe-acceptance.md`  
> 有界范围：`phase-c-83-cancel-path-consult-observe-scope.md`  
> 本页是 **cancel-path consult observe 第二门开工令**。不是 Meta-Schema 工程开工，不是 C10 pass，不是整段 D GO，不是 defer-close / enforce / 跨进程持久化偷渡。

## 1. 授权一句话

在 cancel-path consult observe 范围已按接受记录记名接受的前提下：

1. **立即授权** discovery 文档三件套 + Path B residual（± operate-path）最小 xref 入库（本 PR；**docs-only**）。  
2. **继而授权** 引用本开工令的**后续**实现 PR：在 cancel 生命周期上挂 soft-observe consult（优先复用 FC-02 ENV；语义不对则 OUT 等 Owner）；主张 **`code-present`**；default-off；吞错；**必须不** defer cancel/closed；无 enforce；无 live invoke；不宣称 C10 pass。  
3. **不授权** 跨进程咨询/收据持久化、C10 claim gate / pass、defer-close、enforce、Meta-Schema / Phase D / Path-Gate 收紧、或改写 Phase C 冻结正文。

两段门说明（与 Path B 同构）：**本 PR 只落文档**；实现必须另开 PR，并在描述中引用本开工令 id（`phase_c_83_cancel_path_consult_observe_start_order`）。合入本 docs PR ≠ 授权在本 PR 改 `src/`。

## 2. 基线

| 项 | 值 |
| --- | --- |
| Base branch | `main` |
| Baseline SHA | `e74ffb34c1e4ee53a1ea46391beea11db2ed2f04`（#93 merge；含 Path B #92 `e371bc03…`） |
| Path B impl | #92（`e371bc03f05116929d3c3aa80d3e6892db9bc6ac`） |
| Path B docs | #91（`b920d03b98ce272cd12adb2b2a5ec9b59cd1080d`） |
| Path A impl | #89（`5566bc3f77f8f033cb95324e95dbeb2ea650e6f4`） |
| Path A docs | #88（`f34a7d8fbef9d9321b75259198f66525e2d0d8e6`） |
| Path C impl | #87（`3949ff92e6316c295c3d573076115edaf4a88337`） |
| Path C docs | #86（`946b3893ecc3f11d5e951e87c79ba90a333cae7e`） |
| §8.3 运营路径 | #85（`f6c6a92360f001e52b568fdf5e5af58dd60a6ee0`） |
| Scope PR | （本 PR；合入后回填 URL） |
| 实现 PR | （另开；须在描述中引用本开工令 id；**本 turn 不开**） |

站桩：A/B/C 合入 ≠ PASS/GO；C10 仍不能 pass；unique-benefit FAIL；NO-GO COMPLETE。

## 3. 落点（paths）

### 3.1 本 PR（docs-only）

| 落点 | 路径 |
| --- | --- |
| 接受记录 | `.kiro/specs/constitutional-governance-discovery/phase-c-83-cancel-path-consult-observe-acceptance.md` |
| 本开工令 | `.kiro/specs/constitutional-governance-discovery/phase-c-83-cancel-path-consult-observe-start-order.md` |
| 书面范围 | `.kiro/specs/constitutional-governance-discovery/phase-c-83-cancel-path-consult-observe-scope.md` |
| 最小 xref | `phase-c-83-path-b-ctr-consult-polish-scope.md` §7；`phase-c-83-path-b-ctr-consult-polish-start-order.md` §8；可选 `phase-c-83-operate-path-confirmation-scope.md` §10 |

### 3.2 实现 PR（引用本令；建议路径；本 turn 不开）

| 落点 | 路径 |
| --- | --- |
| cancel 路径 soft-observe | `src/conversation-task/focus-switch.ts`（cancel fence）或 cancel 生命周期权威调用点 → `consultDeliveryHoldForClose` |
| ENV | 优先复用 `OPENBOT_CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT`；语义不对则停笔等 Owner（另 default-off ENV；**禁** enforce 旗标） |
| 回归测例 | 新增/扩展 vitest（路径以实现 PR 为准）：flag off 仍 cancel；flag on 记 observe 且不推迟；吞错仍完成 transition |
| 对照实现 | `consultDeliveryHoldForClose` in `completion-hold.ts`；reply 路径 `observeConversationTaskReplyCompleted` in `reply-completion.ts`（形状对齐；不 defer） |

**不**落点：defer-close；enforce；跨进程持久化；C10 claim gate；新 enforce `OPENBOT_*`；`packages/constitutional-*`；Phase C 冻结包；重开 Path A/B/C 已锁契约。

## 4. 主张天花板

- 允许：登记「cancel 路径已挂 soft-observe consult（default-off；吞错；不 defer cancel/closed）；优先复用 FC-02 ENV；C10 仍不能 pass；A/B/C 合入 ≠ PASS/GO」  
- 禁止：`runtime-enabled` / `production-proven` / C10 pass / Decision GO / C GO / 整段 D GO / UNIQUE≥1 / Meta-Schema 工程开席 / defer-close / enforce / 跨进程持久化

## 5. 回滚

docs-only：

```bash
git revert <scope-docs-landing-commit-sha(s)>
```

实现 PR：

```bash
git revert <implement-commit-sha(s)>
# or remove cancel-path consult call + tests; restore prior cancel fence shape
```

ENV 语义保持 default-off（若复用 FC-02）；不得留下 defer cancel/closed 行为；无 enforce 旗标可残留。

## 6. 测试门（实现 PR）

```bash
# Path B / Path A / Path C 回归不回退
pnpm exec vitest run src/agents/execution-preflight/ctr-close-consult-lock.test.ts
pnpm exec vitest run src/agents/execution-preflight/reuse-observe-helper-lock.test.ts
pnpm exec vitest run src/agents/execution-preflight/allowed-entry-disposition.test.ts

# 既有 FC-02 / consult 测例仍绿
pnpm exec vitest run src/conversation-task/reply-completion.test.ts
pnpm exec vitest run src/agents/execution-preflight/completion-send.test.ts

# cancel-path consult 测例（路径以实现 PR 为准）
# pnpm exec vitest run <cancel-path-consult-observe-lock.test.ts>
```

须覆盖：flag default-off；开时只记观察；**永不**推迟 cancel/`closed`；咨询失败仍完成 transition；无 enforce；无 live invoke。

## 7. OUT（本开工令不授权）

- defer-close；`closeDeferred: true`；条件化跳过 `cancelled`/`closed`  
- enforce；Path / Gate；live invoke；Fabric-on  
- 跨进程咨询/收据持久化  
- C10 claim gate / pass；Decision GO；整段 D GO；C GO  
- Meta-Schema / Phase D / Path-Gate 收紧；constitutional-contracts / 四产品工程  
- 改写冻结正文；重开 #58–#92 为杂项清单  
- 本 scope PR 内直接改 `src/`（实现必须另 PR；本 turn **不开**实现 PR）  
- 发明 enforce 旗标；在 Owner 未裁定 ENV 复用前擅自第二支非 default-off ENV 当交付

## 8. 残差

- 跨进程咨询/收据持久化 — **另文已立**：`phase-c-83-cross-process-consult-persist-scope.md` + acceptance + start-order（本 cancel 开工令仍 **不授权** 跨进程持久化）  
- C10 claim-gate residual（**非** pass）— **另文已立**：`phase-c-83-c10-claim-gate-residual-*`；**C10 仍不能 pass**；挡门项不由本刀关闭  
- Meta-Schema / Phase D / Path-Gate — 未授权  
- FC-02 ENV 复用若经 Owner 裁定不对 — 另文选定 default-off ENV（仍禁 enforce）  
- #80 推翻路径 — 不启动  
- **实现后记：** 引用本开工令的实现 PR **已合入** #96（merge `8b107a3d`）；合入 ≠ PASS/GO  
