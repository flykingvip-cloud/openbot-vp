# Phase D Path-Gate — shadow Path-select report-only bridge 开工令（**本 docs PR + 后续实现 PR**）

> 开工令 id：`phase_d_path_gate_shadow_select_report_start_order`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-d-path-gate-shadow-select-report-start-order.md`。  
> 日期：**2026-09-26**（Asia/Shanghai）  
> 前置接受：`phase-d-path-gate-shadow-select-report-acceptance.md`  
> 有界范围：`phase-d-path-gate-shadow-select-report-scope.md`  
> **引用 Owner track：** `phase_d_meta_schema_path_gate_owner_track_acceptance`（#101）  
> 本页是 **Path-Gate 第一有界刀第二门开工令**。**立即授权本 docs PR**（三件套 + 可选最小 xref）。**继而授权**引用本令的后续实现 PR（scope §3.2；仅报告桥）。**不是** C10 pass，不是 Decision C GO，不是整段 D GO，不是 Gate 收紧，不是本 PR 改 `src/` / `packages/`。  
> **C10 仍不能 pass。** 合入本令所授权之任何 PR ≠ PASS/GO。把本页读成整段 D GO / C GO / C10 pass / Gate 已收紧 = **FAIL**。

## 1. 授权一句话

在本刀范围已按接受记录记名接受、且已引用 Owner Path-Gate track acceptance 的前提下：

1. **立即授权** discovery 文档三件套 + 可选最小 xref 入库（本 PR；**docs-only**）。  
2. **不授权** 本 PR 改 `src/` / `packages/`、旗标默认值、热路径、Fabric-on、live invoke、enforce、Gate 收紧。  
3. **继而授权** 引用本开工令 id 的**后续**实现 PR：按 scope §3.2 在 `runtime-facade/shadow.ts` 做 dual-opt-in **仅报告**桥接；主张 **`code-present`**；`executed` 恒 false；无热路径接线。  
4. **不授权** C10 pass、Decision C GO、unique-benefit PASS、整段 D GO、整段 P8b 执行、P8c、改写 Phase C 冻结正文。

合入本 docs PR ≠ 授权在本 PR 改 `packages/`；≠ C10 pass；≠ 整段 D GO。

## 2. 基线

| 项 | 值 |
| --- | --- |
| Base branch | `main` |
| Baseline SHA | `c9fdc09a3b1752186ae5aab79cef428eb25b6b8e`（#101 merge；Owner Path-Gate track） |
| Owner track | `phase_d_meta_schema_path_gate_owner_track_acceptance`（#101） |
| Knife1 select | #74 `phase_d_p8b_knife1_select_only`（已落地；本刀不重做登记） |
| Runtime shadow | #60 `phase_d_runtime_facade_shadow_only`（已落地；本刀扩展报告桥） |
| Scope PR | （本 PR；合入后回填 URL） |
| 实现 PR | （另开；须在描述中引用本开工令 id；**本 turn 不开**） |

站桩：**C10 仍不能 pass**；unique-benefit FAIL；NO-GO COMPLETE；本合入 ≠ PASS/GO。

## 3. 落点（paths）

### 3.1 本 PR（docs-only）

| 落点 | 路径 |
| --- | --- |
| 接受记录 | `.kiro/specs/constitutional-governance-discovery/phase-d-path-gate-shadow-select-report-acceptance.md` |
| 本开工令 | `.kiro/specs/constitutional-governance-discovery/phase-d-path-gate-shadow-select-report-start-order.md` |
| 书面范围 | `.kiro/specs/constitutional-governance-discovery/phase-d-path-gate-shadow-select-report-scope.md` |
| 最小 xref（可选） | `docs_phase_d_bounded_closeout.md`；`phase-d-p8b-knife1-scope.md` §9；可选 `phase-d-p8b-p8c-deferred.md` |

### 3.2 明确不落点（本 PR）

| 项 | 约束 |
| --- | --- |
| `src/` | **不**改 |
| `packages/` | **不**改 |
| 旗标默认 / ENV 默认开 | **不**改 |
| Phase C 冻结包 | **不**改写 |

### 3.3 后续实现 PR（引用本令；本 turn 不开）

| 落点 | 路径 |
| --- | --- |
| shadow 报告桥 | `packages/constitutional-contracts/src/runtime-facade/shadow.ts` |
| 单测 | `packages/constitutional-contracts/src/runtime-facade/shadow.test.ts` |
| 包说明 | `packages/constitutional-contracts/README.md`（短节） |
| 对照 API | `packages/constitutional-contracts/src/legal-path/select.ts`（复用；不重做 Knife1） |

**不**落点：gateway chat / tool invoke / ACP / AOR / dispatch / gateway-hook；P8a `path-gap/report.ts` 空集升格；`executed=true`；新 enforce 旗标。

## 4. 旗标（实现 PR；本 PR 不改代码）

| 项 | 值 |
| --- | --- |
| Shadow | 复用 `OPENBOT_CONSTITUTIONAL_SHADOW`（或显式 `shadow: true`） |
| Select | 复用 `OPENBOT_CONSTITUTIONAL_LEGAL_PATH_SELECT`（或显式 `select: true`） |
| 桥接条件 | **两者皆 opt-in** 才可表面化非空 `selectedPath` |
| 默认 | 两旗标均 **关**（行为面 = 今日 #60） |
| 读法 | 模块**不**读 `process.env`；仅调用方快照 / 显式选项 |

## 5. `executed` 与主张

- `executed`：**恒 false**（本开工令禁止副作用执行面）  
- `sideEffects`：恒空  
- `readyToTighten` / Gate 收紧：**仍禁止**；不得因报告桥变为 true  
- 主张天花板：**`code-present`**  
- 禁止：`runtime-enabled` / `production-proven` / C5 全面 pass /「Path 已在热路径」/「Gate 已收紧」

## 6. 回滚

docs-only：

```bash
git revert <scope-docs-landing-commit-sha(s)>
```

实现 PR：

```bash
git revert <implement-commit-sha(s)>
# or restore shadow.ts selectedPath hard-null / legalPathSelectable hard-false
```

秒级行为回滚：不要同时传入 shadow+select opt-in，或保持两 ENV unset。

不得借回滚或重开声称曾「短暂 GO / 短暂 pass / 短暂 Gate 收紧」。

## 7. 测试门（实现 PR）

```bash
pnpm --dir packages/constitutional-contracts test
pnpm --dir packages/constitutional-contracts typecheck
pnpm --dir packages/constitutional-contracts build
```

须覆盖：双关 inert；仅 shadow 不选中；双开命中登记则报告选中且 `executed=false`；涂装候选拒绝；旗标关回滚到 #60 面。

本令 docs PR：**无** `src/` / `packages/` 测试门。

验收阅读清单（人工 / 独立验收 bot）：

1. 是否引用 Owner track acceptance  
2. 三件套是否每页写明 **C10 仍不能 pass**、C NO-GO、非整段 D GO  
3. 是否声称 C10 pass / C GO / 整段 D GO / Gate 已收紧 / `executed=true`  
4. 本 PR diff 是否仅 discovery（+ 可选最小 xref）；无 `src/` / `packages/`

## 8. OUT（本开工令不授权）

- C10 pass；Decision C GO；unique-benefit PASS；整段 D GO  
- 本 PR 改 `src/` / `packages/`  
- Fabric-on；live invoke；enforce；热路径 Gate 收紧  
- 整段 P8b 执行 GO；P8c  
- 改写 Phase C 冻结正文  
- 把引用本令的实现 PR 读成「已获整段 Path-Gate / D GO」而无 OUT 边界

## 9. 残差

- P8b 执行 opt-in；轨迹空间 >1；旁路表闭合 — 仍挡  
- P8c / Gate 收紧 ADR / C5 全面 pass — 仍挡  
- C10 §6 挡门 — 仍挡  
- #58–#66 收口 — 仍站
