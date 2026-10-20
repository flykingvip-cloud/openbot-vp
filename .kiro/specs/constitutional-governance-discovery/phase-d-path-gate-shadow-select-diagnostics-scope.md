# Phase D Path-Gate — shadow Path-select diagnostic report enrichment（书面范围；**非整段 D GO**）

> 范围 id：`phase_d_path_gate_shadow_select_diagnostics`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-d-path-gate-shadow-select-diagnostics-scope.md`。  
> 日期：**2026-09-26**（Asia/Shanghai）  
> 对照：Doc02 §9.3；`phase-d-meta-schema-path-gate-owner-track-scope.md`；`phase-d-path-gate-shadow-select-report-scope.md`；`phase-d-p8b-knife1-scope.md`；`phase-d-runtime-facade-shadow.md`；`phase-d-p8b-p8c-deferred.md`；`docs_phase_d_bounded_closeout.md`  
> 前置：`phase-d-path-gate-shadow-select-diagnostics-acceptance.md` + `phase-d-path-gate-shadow-select-diagnostics-start-order.md`  
> **引用 Owner track：** `phase_d_meta_schema_path_gate_owner_track_acceptance`（#101；`c9fdc09a`）— 本刀为 track 下**第二把**有界 Path-Gate 刀，另开两段门。  
> **承接第一刀：** `phase_d_path_gate_shadow_select_report` — docs #103 `4078ffd6` + impl #104 `1bf1810c`（dual-opt-in 已表面化 `selectedPath`；`executed=false`）。  
> **本 PR = docs-only 书面范围 / 接受 / 开工令**。编码实现须引用本开工令另开实现 PR；**不**在本 PR 改 `src/` / `packages/`。  
> **基线 tip：** `1bf1810c882c25ef0cf2e7a3662021736edbf0e6`（#104 merge 或其后）。**合入 ≠ PASS/GO。**  
> **站桩（全文有效）：Phase C NO-GO COMPLETE；unique-benefit FAIL；C10 仍不能 pass。** 把本包读成 C10 pass / Decision C GO / 整段 D GO / unique-benefit PASS = **FAIL**。

## 0. 为何开本刀（第一刀报告桥合入后的自然下一格）

| 现象 | 证据 |
| --- | --- |
| Owner track 已合入 | #101 `c9fdc09a`；后续刀须**新** accept+start-order |
| 第一刀已合入 | #103 docs + #104 impl；`phase_d_path_gate_shadow_select_report`；shadow 可表面化 `selectedPath` / `legalPathSelectable` |
| Owner 开下一刀令 | 2026-09-26（Asia/Shanghai）：第一刀完成后「开下一刀」 |
| Knife1 select 诊断面已存在 | `LegalPathSelectResult` 已有 `selectEnabled` / `effectiveLegalPathIds` / `candidatePresent` / `candidateAccepted` / `message` |
| 真实缺口 | #104 桥接后 shadow 结果仍**丢弃**上述诊断字段；观察面只见选中结果，不见为何选/不选与有效登记集 |
| 站桩 | C **NO-GO**；unique-benefit **FAIL**；**C10 仍不能 pass**；整段 P8b 执行面 / P8c / Gate 收紧仍 defer |

本刀把该缺口收成独立书面三件套：授权**日后**在 `@openbot/constitutional-contracts` runtime-facade shadow 上，于**既有** dual-opt-in（SHADOW ∧ LEGAL_PATH_SELECT）下，把 Knife1 select **诊断字段**表面化到 shadow 报告结果——**仍** `executed=false`；**不**扩登记集；**不**热路径 Gate 收紧；**不** Fabric-on；**不**整段 P8b 执行。**合入本 docs PR ≠ PASS/GO；合入后续实现 PR 亦 ≠ 整段 D GO。**

## 1. Path-Gate 阶梯盘点（主 tip @ #104；诚实）

| 阶 | tip 状态 | 说明 |
| --- | --- | --- |
| Doc02 §9.3 P8a 缺口命名 | **已落地** | `packages/constitutional-contracts/src/path-gap/report.ts` |
| P8b Knife1 选中-only | **已落地** | `src/legal-path/{registry,select}.ts`；诊断字段在 select 结果上 |
| Runtime façade shadow | **已落地** | #60 基座 |
| 第一刀 shadow↔select 仅报告桥 | **已落地** | #103/#104；`selectedPath` / `legalPathSelectable` |
| **本刀** shadow select **诊断**充实 | **下一格（本三件套）** | 同双 opt-in；表面化 select 诊断；仍不执行 |
| 合法轨迹空间扩展（>1）/ 旁路表 | **本刀不做** | Knife1 §9 残差；须另文 |
| P8b 执行面 `executed=true` | **本诊断刀 OUT**；有界三件套另见 `phase_d_p8b_execute_opt_in` | 整段仍 defer；见 `phase-d-p8b-p8c-deferred.md` §4.2 |
| P8c / 热路径 Gate 收紧 | **OUT** | track 与站桩明示不批 |
| Fabric-on / live invoke / enforce 默认开 | **OUT** | 站桩 |
| 无新 scope 重开 #58–#66 | **禁止** | closeout 仍站 |

## 2. 目标（Goal）

在 C **NO-GO** / unique-benefit **FAIL** / **C10 仍不能 pass** / Owner Path-Gate track 已开 / 第一刀报告桥已落地前提下：

1. 书面锁定本刀 IN/OUT 与阶梯位置（承接 #104）。  
2. 授权后续实现 PR：当调用方同时 opt-in shadow **且** legal-path select 时，runtime-facade shadow **可以**把 `selectLegalPath` 的诊断字段表面化到报告结果（不只是 `selectedPath`）。  
3. 任一旗标关 → 诊断字段保持 inert / null / 空等价（与 #60/#104 退回面一致）。  
4. **永不**在本刀设 `executed=true`；**不**扩登记 >1；**不**接线 gateway chat / tool invoke / ACP / AOR；**不** Gate 收紧。  
5. 主张天花板：**`code-present`** only。

## 3. 范围内（IN）

### 3.1 本 scope PR（docs-only）

| 项 | 说明 |
| --- | --- |
| 书面三件套 | 本 scope + acceptance + start-order |
| 阶梯盘点 | §1 表（含 #104 已落地与本刀缺口） |
| 最小 xref | `docs_phase_d_bounded_closeout.md`；第一刀 scope §7 残差行或等价指针；可选 `phase-d-p8b-p8c-deferred.md` |
| track 引用 | 必须引用 `phase_d_meta_schema_path_gate_owner_track_acceptance`；明文承接 #104 |

### 3.2 实现 PR（引用开工令；建议落点；**本 turn 不开**）

| 落点 | 路径（建议） | 约束 |
| --- | --- | --- |
| shadow 诊断充实 | `packages/constitutional-contracts/src/runtime-facade/shadow.ts` | 双 opt-in 时从 `selectLegalPath` 结果映射诊断字段；`executed` 仍恒 false |
| 单测 | `packages/constitutional-contracts/src/runtime-facade/shadow.test.ts` | 双关 inert；仅 shadow 无诊断选中面；双开命中/拒绝/无候选时诊断一致；仍不执行 |
| 包 README 短节 | `packages/constitutional-contracts/README.md` | 明文：诊断充实 ≠ Gate 收紧 ≠ 热路径 ≠ 执行 ≠ 登记扩展 |
| 导出（若需） | `packages/constitutional-contracts/src/index.ts` | 仅当类型面需要；不新增热路径符号 |

建议表面化字段（名称可微调，语义须覆盖）：

| 字段 | 来源（Knife1） | 语义 |
| --- | --- | --- |
| `selectEnabled` | `LegalPathSelectResult.selectEnabled` | 选中桥是否 opt-in |
| `effectiveLegalPathIds` | `effectiveLegalPathIds` | 当前有效登记 id 列表（旗标关 → 空） |
| `candidatePresent` | `candidatePresent` | 是否提供了候选 |
| `candidateAccepted` | `candidateAccepted` | 候选是否命中登记 |
| `selectMessage`（或等价） | `message` | 选中/拒绝/ inert 说明串 |

行为约束：

- 函数**不**读 `process.env`；只接受调用方快照 / 显式 `shadow`/`select`。  
- **复用**既有旗标：`OPENBOT_CONSTITUTIONAL_SHADOW` + `OPENBOT_CONSTITUTIONAL_LEGAL_PATH_SELECT`；**不**发明新 ENV。  
- **不**扩 `DECLARED_LEGAL_PATHS`；**不**升格 P8a 空集。  
- 主张 **`code-present`**；禁止 `runtime-enabled` / `production-proven`。

## 4. 范围外 / 禁止（OUT）

- **C10 pass** / green C10；Decision **C GO**；unique-benefit **PASS**；**整段 D GO**  
- Fabric-on；`ORCHESTRATION_LIVE_INVOKE` / live invoke；enforce 默认开  
- **热路径 Gate / Path 收紧**；P8c；整段 P8b **执行**面（`executed=true`）  
- 本刀交付「登记集 >1」或旁路表闭合  
- 把本刀 import 进 gateway chat / tool invoke / ACP / AOR / dispatch / gateway-hook 热路径  
- 改写 Phase C 冻结正文 / digests / 旧 `final-acceptance.md` 决策位  
- 无新 scope 重开 #58–#66；把第一刀收口重写成「未完成故重开」  
- 本 scope PR 夹带 `src/` / `packages/` 编码  
- 发明 production-proven；Profile B 假闭合；C5 全面 pass

## 5. 主张天花板

- 本 scope PR：docs-only / **`code-present`**（文档事实）  
- 后续实现 PR：默认仍 **`code-present`**  
- **禁止**抬升至 C10 pass / Decision GO / 整段 D GO / `runtime-enabled` / `production-proven` /「Path 已在热路径」/「Gate 已收紧」/「登记空间已闭合」

## 6. 成功标准

| 标准 | 判定 |
| --- | --- |
| 书面三件套 | scope + acceptance + start-order 入库；引用 Owner track acceptance；明文承接 #104 |
| 阶梯诚实 | §1 标明 #104 已落地与本刀诊断缺口；OUT 含执行面/Gate/Fabric/登记扩展 |
| 站桩 | 每文件明文：**C10 仍不能 pass**；C NO-GO；非整段 D GO；非 C GO |
| 无越界 | OUT 未触碰；本 PR 无 `src/` / `packages/` |
| 两段门 | 本 PR 仅 docs；实现须另 PR 引用本开工令 |
| 合入 ≠ PASS/GO | 明文 |

## 7. 残差（本刀不做；须另文）

- P8b 执行边界内 opt-in `executed=true`（有界三件套另见 `phase_d_p8b_execute_opt_in`；#108/#111）  
- 合法轨迹空间扩展（>1）与旁路表闭合  
- **整段** P8c / Gate 收紧 ADR；有界 P8c 对照报告另见 `phase_d_p8c_shadow_legacy_compare`（本刀不授权）  
- C5 全面 pass 所需闭合  
- 热路径接线；Fabric-on；live invoke；enforce

## 8. 验收提示（独立验收 bot；本 PR 不呼叫）

**PASS（本 scope PR）：**

1. 三件套齐全；diff 仅 discovery（+ 可选最小 xref）。  
2. 引用 `phase_d_meta_schema_path_gate_owner_track_acceptance`；明文承接 #104 / 第一刀。  
3. 每文件明文：**C10 仍不能 pass**；C NO-GO；非整段 D GO。  
4. IN = shadow↔Knife1 select **诊断报告**充实；OUT 含执行 / Gate 收紧 / Fabric-on / live invoke / 热路径 / 登记扩展 / `src/`。  
5. 接受宽度含 docs-only 与后续实现-under-start-order；claim ceiling `code-present`。

**FAIL：** 写成 C10 pass / C GO / 整段 D GO / 整段 P8b 执行 GO / Gate 已收紧 / 登记已扩；省略「仍不能 pass」；夹带代码；或改写 Phase C 冻结正文。
