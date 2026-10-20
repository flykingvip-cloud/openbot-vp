# Phase D P8c — 有界影子↔legacy 对照报告 开工令（**本 docs PR + 后续实现 PR**）

> 开工令 id：`phase_d_p8c_shadow_legacy_compare_start_order`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-d-p8c-shadow-legacy-compare-start-order.md`。  
> 日期：**2026-09-27**（Asia/Shanghai）  
> 前置接受：`phase-d-p8c-shadow-legacy-compare-acceptance.md`  
> 有界范围：`phase-d-p8c-shadow-legacy-compare-scope.md`  
> **引用 Owner track：** `phase_d_meta_schema_path_gate_owner_track_acceptance`（#101）  
> **对照：** Doc02 §9.3 P8c；`phase-d-p8b-p8c-deferred.md`（整段 P8c 仍不批准 → 本令有界报告对照例外）  
> 本页是 **P8c 有界影子↔legacy 对照报告 第二门开工令**。**立即授权本 docs PR**（三件套 + 最小 xref）。**继而授权**引用本令的后续实现 PR（scope §3.2；包本地对照报告）。**不是** C10 pass，不是 Decision C GO，不是整段 D GO，不是整段 P8c 完成，不是 Gate 收紧，不是本 PR 改 `src/` / `packages/`。  
> **C10 仍不能 pass。** 合入本令所授权之任何 PR ≠ PASS/GO。把本页读成整段 D GO / C GO / C10 pass / 整段 P8c GO / Gate 已收紧 = **FAIL**。

## 1. 授权一句话

在本刀范围已按接受记录记名接受、已引用 Owner Path-Gate track acceptance、且 Knife1 + Path-Gate 报告/诊断 + 有界 EXECUTE（#108/#111）已落地的前提下：

1. **立即授权** discovery 文档三件套 + 最小 xref 入库（本 PR；**docs-only**）。  
2. **不授权** 本 PR 改 `src/` / `packages/`、旗标默认值、热路径、Fabric-on、live invoke、enforce、Gate 收紧、登记扩展、`readyToTighten=true`。  
3. **继而授权** 引用本开工令 id 的**后续**实现 PR：按 scope §3.2 在 `@openbot/constitutional-contracts` runtime-facade（及/或极小 `compare.ts`）做**默认关**影子↔legacy 对照报告（`OPENBOT_CONSTITUTIONAL_SHADOW_COMPARE`）；仅当 SHADOW 开 ∧ COMPARE 开 ∧ 调用方 legacy 快照足够时 `shadowCompared=true`；主张 **`code-present`**；**优先包本地**；无热路径接线；无登记 >1；**`readyToTighten` 永远 false**。  
4. **不授权** C10 pass、Decision C GO、unique-benefit PASS、整段 D GO、整段 P8c 完成、Gate 收紧 ADR、改写 Phase C 冻结正文。

合入本 docs PR ≠ 授权在本 PR 改 `packages/`；≠ C10 pass；≠ 整段 D GO；≠ 整段 P8c GO；≠ Gate 已收紧。

## 2. 基线

| 项 | 值 |
| --- | --- |
| Base branch | `main` |
| Baseline SHA | `0335ae8b78ddf08f1fa6d083c62208152ac44b9d`（main tip；含 #111 P8b execute impl） |
| Owner track | `phase_d_meta_schema_path_gate_owner_track_acceptance`（#101） |
| Knife1 select | `phase_d_p8b_knife1_select_only` |
| Path-Gate | #103/#104 报告桥；#106/#107 诊断 |
| P8b execute opt-in | docs #108 + impl #111；`phase_d_p8b_execute_opt_in_start_order` |
| Scope PR | （本 PR；合入后回填 URL） |
| 实现 PR | （另开；须在描述中引用本开工令 id：`phase_d_p8c_shadow_legacy_compare_start_order`；**本 turn 不开**） |

站桩：**C10 仍不能 pass**；unique-benefit FAIL；NO-GO COMPLETE；本合入 ≠ PASS/GO。

## 3. 落点（paths）

### 3.1 本 PR（docs-only）

| 落点 | 路径 |
| --- | --- |
| 接受记录 | `.kiro/specs/constitutional-governance-discovery/phase-d-p8c-shadow-legacy-compare-acceptance.md` |
| 本开工令 | `.kiro/specs/constitutional-governance-discovery/phase-d-p8c-shadow-legacy-compare-start-order.md` |
| 书面范围 | `.kiro/specs/constitutional-governance-discovery/phase-d-p8c-shadow-legacy-compare-scope.md` |
| 最小 xref | `phase-d-p8b-p8c-deferred.md` §4.2；`docs_phase_d_bounded_closeout.md` 新 §；可选 Path-Gate / execute scope 残差一行 |

### 3.2 明确不落点（本 PR）

| 项 | 约束 |
| --- | --- |
| `src/` | **不**改 |
| `packages/` | **不**改 |
| 旗标默认 / ENV 默认开 | **不**改；本 PR **只命名** COMPARE，不落地代码常量 |
| `legal-path/registry.ts` 扩集 | **不**改 |
| Gate 收紧 ADR | **不**发明为本刀交付 |
| Phase C 冻结包 | **不**改写 |

### 3.3 后续实现 PR（引用本令；本 turn 不开）

| 落点 | 路径 |
| --- | --- |
| 对照报告 | `packages/constitutional-contracts/src/runtime-facade/shadow.ts` 及/或 `runtime-facade/compare.ts`（或 legal-path 下极小 `compare.ts`） |
| 旗标常量 | 同包；`SHADOW_COMPARE_ENV = "OPENBOT_CONSTITUTIONAL_SHADOW_COMPARE"` |
| 单测 | 对应 `*.test.ts` |
| 包说明 | `packages/constitutional-contracts/README.md`（短节） |
| 对照 API | 复用既有 shadow 报告面；不重做 Knife1 / EXECUTE |

**不**落点（第一实现）：gateway chat / tool invoke / ACP / AOR / dispatch / gateway-hook；登记集 >1；新 enforce / Gate 收紧旗标；`readyToTighten=true`；扩 `executed`。

**极小消费者例外：** 仅当实现 PR 描述**显式命名**且仍引用本开工令时，才可加一行包外调用点；默认**禁止**。

## 4. 旗标（实现 PR；本 PR 不改代码）

| 项 | 值 |
| --- | --- |
| Shadow（前置） | 复用 `OPENBOT_CONSTITUTIONAL_SHADOW`（或显式 `shadow: true`） |
| Compare（本刀） | **新建** `OPENBOT_CONSTITUTIONAL_SHADOW_COMPARE`（或显式 `compare: true`） |
| Legacy 输入 | 调用方 `legacyDecision` / `legacyPathRef`（字符串快照；**非** Path） |
| 对照条件 | **SHADOW 开** ∧ **COMPARE 开** ∧ **两侧足够可对照** → 才允许 `shadowCompared=true` |
| 默认 | COMPARE **关**；SHADOW 仍独立、默认关 |
| 读法 | 模块**不**读 `process.env`；仅调用方快照 / 显式选项 |
| 与 EXECUTE | 不要求 EXECUTE；本刀**不**扩 `executed` |

## 5. `shadowCompared` / `readyToTighten` 与主张

- `shadowCompared`：仅当 §4 条件满足可为 `true`；否则 **false**  
- 报告字段：`compareMatch`（bool\|null）、`legacyDecisionPresent`、`constitutionalDecisionPresent` / 复用 `selectedPath`、`compareMessage`（或等价）  
- **`readyToTighten`：本刀永远 false**；禁止因对照匹配而翻 true  
- `executed`：本令**不**授权扩展；仍由独立 EXECUTE opt-in 管辖  
- 登记集大小：本令**不**授权 >1  
- 主张天花板：**`code-present`**  
- 与 C5：可写 report-present **进度**；**禁止** C5 pass / C10 pass  
- 禁止：`runtime-enabled` / `production-proven` /「Path 已在热路径」/「Gate 已收紧」/「整段 P8c 已完成」

## 6. 回滚

docs-only：

```bash
git revert <scope-docs-landing-commit-sha(s)>
```

实现 PR：

```bash
git revert <implement-commit-sha(s)>
# or keep OPENBOT_CONSTITUTIONAL_SHADOW_COMPARE unset / compare: false
```

秒级行为回滚：不要传入 COMPARE opt-in，或保持 ENV unset → `shadowCompared=false`。

不得借回滚或重开声称曾「短暂 GO / 短暂 pass / 短暂 Gate 收紧 / 短暂整段 P8c」。

## 7. 测试门（实现 PR）

```bash
pnpm --dir packages/constitutional-contracts test
pnpm --dir packages/constitutional-contracts typecheck
pnpm --dir packages/constitutional-contracts build
```

须覆盖：默认关 inert；仅 SHADOW → `shadowCompared=false`；SHADOW∧COMPARE + 两侧足够 → `shadowCompared=true` 且报告字段表面化；COMPARE 关回滚；不足输入时不得 `shadowCompared=true`；`readyToTighten` 恒 false；涂装别名不得升格为 Path；模块不读 `process.env`。

本令 docs PR：**无** `src/` / `packages/` 测试门。

验收阅读清单（人工 / 独立验收 bot）：

1. 是否引用 Owner track acceptance；是否引用 Doc02 §9.3 P8c；deferred §4.2 是否诚实区分「整段」vs 有界对照例外  
2. 三件套是否每页写明 **C10 仍不能 pass**、C NO-GO、非整段 D GO、非整段 P8c 完成、不 Gate 收紧  
3. 是否声称 C10 pass / C GO / 整段 D GO / Gate 已收紧 / COMPARE 默认开 / `readyToTighten` 可翻 true / 登记已扩  
4. 本 PR diff 是否仅 discovery（+ 最小 xref）；无 `src/` / `packages/`

## 8. OUT（本开工令不授权）

- C10 pass；Decision C GO；unique-benefit PASS；整段 D GO；整段 P8c 完成；C5 全面 pass  
- 本 PR 改 `src/` / `packages/`  
- Fabric-on；live invoke 生产默认；enforce；热路径 Gate 收紧；Gate 收紧 ADR 作为本刀  
- 登记集 >1；涂装 Workflow/sessionKey 为 Path  
- 改写 Phase C 冻结正文  
- 用 COMPARE 翻 `readyToTighten=true`  
- 把引用本令的实现 PR 读成「已获整段 Path-Gate / D / P8c GO」而无 OUT 边界

## 9. 残差

- 登记 >1 / 旁路表闭合 — 仍挡  
- 热路径接线 / **Gate 收紧 ADR** — 仍挡（Doc02：收紧另立）  
- Fabric-on / live invoke 默认 / enforce — 仍挡  
- C10 §6 挡门 — 仍挡  
- #58–#66 收口 — 仍站
