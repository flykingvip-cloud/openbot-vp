# Phase D P8b — 有界执行 opt-in 开工令（**本 docs PR + 后续实现 PR**）

> 开工令 id：`phase_d_p8b_execute_opt_in_start_order`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-d-p8b-execute-opt-in-start-order.md`。  
> 日期：**2026-09-26**（Asia/Shanghai）  
> 前置接受：`phase-d-p8b-execute-opt-in-acceptance.md`  
> 有界范围：`phase-d-p8b-execute-opt-in-scope.md`  
> **引用 Owner track：** `phase_d_meta_schema_path_gate_owner_track_acceptance`（#101）  
> **对照：** Doc02 §9.3 P8b；`phase-d-p8b-p8c-deferred.md`（执行 opt-in 残差 → 本令有界授权）  
> 本页是 **P8b 有界执行 opt-in 第二门开工令**。**立即授权本 docs PR**（三件套 + 最小 xref）。**继而授权**引用本令的后续实现 PR（scope §3.2；包本地 execute stub）。**不是** C10 pass，不是 Decision C GO，不是整段 D GO，不是整段 P8b 完成，不是 Gate 收紧，不是本 PR 改 `src/` / `packages/`。  
> **C10 仍不能 pass。** 合入本令所授权之任何 PR ≠ PASS/GO。把本页读成整段 D GO / C GO / C10 pass / 整段 P8b GO / Gate 已收紧 = **FAIL**。

## 1. 授权一句话

在本刀范围已按接受记录记名接受、已引用 Owner Path-Gate track acceptance、且 Knife1 选中-only + Path-Gate 报告/诊断已落地的前提下：

1. **立即授权** discovery 文档三件套 + 最小 xref 入库（本 PR；**docs-only**）。  
2. **不授权** 本 PR 改 `src/` / `packages/`、旗标默认值、热路径、Fabric-on、live invoke、enforce、Gate 收紧、登记扩展。  
3. **继而授权** 引用本开工令 id 的**后续**实现 PR：按 scope §3.2 在 `@openbot/constitutional-contracts` legal-path 面做**默认关**执行 opt-in（`OPENBOT_CONSTITUTIONAL_LEGAL_PATH_EXECUTE`）；仅当选中已成立且该旗标开时 `executed=true`；主张 **`code-present`**；**优先包本地 stub**；无热路径接线；无登记 >1。  
4. **不授权** C10 pass、Decision C GO、unique-benefit PASS、整段 D GO、整段 P8b 完成、P8c、改写 Phase C 冻结正文。

合入本 docs PR ≠ 授权在本 PR 改 `packages/`；≠ C10 pass；≠ 整段 D GO；≠ 整段 P8b GO。

## 2. 基线

| 项 | 值 |
| --- | --- |
| Base branch | `main` |
| Baseline SHA | `1ce3d77e655cd96f1dca87540fd3441e2a45d58d`（#107 merge；Path-Gate diagnostics impl） |
| Owner track | `phase_d_meta_schema_path_gate_owner_track_acceptance`（#101） |
| Knife1 select | `phase_d_p8b_knife1_select_only`（选中前置；`executed` 曾恒 false） |
| Path-Gate | #103/#104 报告桥；#106/#107 诊断 |
| Scope PR | （本 PR；合入后回填 URL） |
| 实现 PR | （另开；须在描述中引用本开工令 id：`phase_d_p8b_execute_opt_in_start_order`；**本 turn 不开**） |

站桩：**C10 仍不能 pass**；unique-benefit FAIL；NO-GO COMPLETE；本合入 ≠ PASS/GO。

## 3. 落点（paths）

### 3.1 本 PR（docs-only）

| 落点 | 路径 |
| --- | --- |
| 接受记录 | `.kiro/specs/constitutional-governance-discovery/phase-d-p8b-execute-opt-in-acceptance.md` |
| 本开工令 | `.kiro/specs/constitutional-governance-discovery/phase-d-p8b-execute-opt-in-start-order.md` |
| 书面范围 | `.kiro/specs/constitutional-governance-discovery/phase-d-p8b-execute-opt-in-scope.md` |
| 最小 xref | `phase-d-p8b-p8c-deferred.md` §4.2；`phase-d-path-gate-shadow-select-diagnostics-scope.md` §7；可选 `docs_phase_d_bounded_closeout.md` |

### 3.2 明确不落点（本 PR）

| 项 | 约束 |
| --- | --- |
| `src/` | **不**改 |
| `packages/` | **不**改 |
| 旗标默认 / ENV 默认开 | **不**改；本 PR **只命名** EXECUTE，不落地代码常量 |
| `legal-path/registry.ts` 扩集 | **不**改 |
| Phase C 冻结包 | **不**改写 |

### 3.3 后续实现 PR（引用本令；本 turn 不开）

| 落点 | 路径 |
| --- | --- |
| 执行 opt-in | `packages/constitutional-contracts/src/legal-path/execute.ts`（或等价扩展） |
| 旗标常量 | 同包；`LEGAL_PATH_EXECUTE_ENV = "OPENBOT_CONSTITUTIONAL_LEGAL_PATH_EXECUTE"` |
| 单测 | 对应 `*.test.ts` |
| 包说明 | `packages/constitutional-contracts/README.md`（短节） |
| 对照 API | `packages/constitutional-contracts/src/legal-path/select.ts`（选中前置；不重做 Knife1 登记） |

**不**落点（第一实现）：gateway chat / tool invoke / ACP / AOR / dispatch / gateway-hook；P8a 空集升格；登记集 >1；新 enforce 旗标；P8c 对照面。

**极小消费者例外：** 仅当实现 PR 描述**显式命名**且仍引用本开工令时，才可加一行包外调用点；默认**禁止**。

## 4. 旗标（实现 PR；本 PR 不改代码）

| 项 | 值 |
| --- | --- |
| Select（前置） | 复用 `OPENBOT_CONSTITUTIONAL_LEGAL_PATH_SELECT`（或显式 `select: true`） |
| Execute（本刀） | **新建** `OPENBOT_CONSTITUTIONAL_LEGAL_PATH_EXECUTE`（或显式 `execute: true`） |
| 执行条件 | **选中已成立**（`selectedPath` 非空）**且** EXECUTE opt-in → 才允许 `executed=true` |
| 默认 | EXECUTE **关**；SELECT 仍独立、默认关 |
| 读法 | 模块**不**读 `process.env`；仅调用方快照 / 显式选项 |
| 与 SHADOW | 不要求 shadow；执行面独立于报告桥 |

## 5. `executed` 与主张

- `executed`：仅当 §4 条件满足可为 `true`；否则 **false**  
- `sideEffects`：第一实现宜空或仅包内可审计标记；禁止默默写网关/租户数据  
- `readyToTighten` / Gate 收紧：**仍禁止**；不得因 `executed=true` 变为 true  
- 登记集大小：本令**不**授权 >1  
- 主张天花板：**`code-present`**  
- 与 C5：可写 path-present **进度**；**禁止** C5 pass / C10 pass  
- 禁止：`runtime-enabled` / `production-proven` /「Path 已在热路径」/「Gate 已收紧」/「整段 P8b 已完成」

## 6. 回滚

docs-only：

```bash
git revert <scope-docs-landing-commit-sha(s)>
```

实现 PR：

```bash
git revert <implement-commit-sha(s)>
# or keep OPENBOT_CONSTITUTIONAL_LEGAL_PATH_EXECUTE unset / execute: false
```

秒级行为回滚：不要传入 EXECUTE opt-in，或保持 ENV unset → `executed=false`。

不得借回滚或重开声称曾「短暂 GO / 短暂 pass / 短暂 Gate 收紧 / 短暂整段 P8b」。

## 7. 测试门（实现 PR）

```bash
pnpm --dir packages/constitutional-contracts test
pnpm --dir packages/constitutional-contracts typecheck
pnpm --dir packages/constitutional-contracts build
```

须覆盖：默认双关 inert；仅 SELECT 选中 → `executed=false`；SELECT∧EXECUTE + 合法选中 → `executed=true`；EXECUTE 关回滚；无选中时 EXECUTE 开仍不得执行；涂装别名拒绝；模块不读 `process.env`。

本令 docs PR：**无** `src/` / `packages/` 测试门。

验收阅读清单（人工 / 独立验收 bot）：

1. 是否引用 Owner track acceptance；是否引用 Doc02 §9.3 P8b；deferred §4.2 是否诚实区分「整段」vs 有界 opt-in  
2. 三件套是否每页写明 **C10 仍不能 pass**、C NO-GO、非整段 D GO、非整段 P8b 完成  
3. 是否声称 C10 pass / C GO / 整段 D GO / Gate 已收紧 / EXECUTE 默认开 / 登记已扩  
4. 本 PR diff 是否仅 discovery（+ 最小 xref）；无 `src/` / `packages/`

## 8. OUT（本开工令不授权）

- C10 pass；Decision C GO；unique-benefit PASS；整段 D GO；整段 P8b 完成；C5 全面 pass  
- 本 PR 改 `src/` / `packages/`  
- Fabric-on；live invoke 生产默认；enforce；热路径 Gate 收紧；P8c  
- 登记集 >1；涂装 Workflow/sessionKey 为 Path  
- 改写 Phase C 冻结正文  
- 把引用本令的实现 PR 读成「已获整段 Path-Gate / D / P8b GO」而无 OUT 边界

## 9. 残差

- 登记 >1 / 旁路表闭合 — 仍挡  
- 热路径接线 / Gate 收紧 ADR / P8c — 仍挡  
- Fabric-on / live invoke 默认 / enforce — 仍挡  
- C10 §6 挡门 — 仍挡  
- #58–#66 收口 — 仍站
