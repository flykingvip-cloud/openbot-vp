# Phase D Path-Gate — shadow Path-select report-only bridge（书面范围；**非整段 D GO**）

> 范围 id：`phase_d_path_gate_shadow_select_report`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-d-path-gate-shadow-select-report-scope.md`。  
> 日期：**2026-09-26**（Asia/Shanghai）  
> 对照：Doc02 §9.3；`phase-d-meta-schema-path-gate-owner-track-scope.md`；`phase-d-p8b-knife1-scope.md`；`phase-d-runtime-facade-shadow.md`；`phase-d-p8b-p8c-deferred.md`；`docs_phase_d_bounded_closeout.md`  
> 前置：`phase-d-path-gate-shadow-select-report-acceptance.md` + `phase-d-path-gate-shadow-select-report-start-order.md`  
> **引用 Owner track：** `phase_d_meta_schema_path_gate_owner_track_acceptance`（#101；`c9fdc09a`）— 本刀为 track 下**第一把**有界 Path-Gate 刀，另开两段门。  
> **本 PR = docs-only 书面范围 / 接受 / 开工令**。编码实现须引用本开工令另开实现 PR；**不**在本 PR 改 `src/` / `packages/`。  
> **基线 tip：** `c9fdc09a3b1752186ae5aab79cef428eb25b6b8e`（#101 merge 或其后）。**合入 ≠ PASS/GO。**  
> **站桩（全文有效）：Phase C NO-GO COMPLETE；unique-benefit FAIL；C10 仍不能 pass。** 把本包读成 C10 pass / Decision C GO / 整段 D GO / unique-benefit PASS = **FAIL**。

## 0. 为何开本刀（Owner track 开刀后的自然下一格）

| 现象 | 证据 |
| --- | --- |
| Owner track 已合入 | #101 `c9fdc09a`；`phase_d_meta_schema_path_gate_owner_track_*`；后续刀须**新** accept+start-order |
| Owner 开刀令 | 2026-09-26（Asia/Shanghai）：track 合入后「开刀」 |
| P8a 已落地 | #59 `phase_d_p8a_report_only` — `no_valid_path` 仅报告 |
| P8b Knife1 已落地 | #74 `phase_d_p8b_knife1_select_only` — 登记+默认关选中；`executed` 恒 false |
| Runtime 门面 shadow 已落地 | #60 `phase_d_runtime_facade_shadow_only` — 仍硬编码 `selectedPath: null` / `legalPathSelectable: false`；丢弃 `candidatePath` |
| 真实缺口 | Knife1 select 与 shadow 报告**未桥接**；Path-Gate 进度停在「可选中」但观察面仍假装无可选 Path |
| 站桩 | C **NO-GO**；unique-benefit **FAIL**；**C10 仍不能 pass**；整段 P8b 执行面 / P8c / Gate 收紧仍 defer |

本刀把该缺口收成独立书面三件套：授权**日后**在 `@openbot/constitutional-contracts` runtime-facade shadow 上做 **dual-opt-in 仅报告**桥接（SHADOW ∧ LEGAL_PATH_SELECT）——可表面化 Knife1 `selectedPath`；**仍** `executed=false`；**不**热路径 Gate 收紧；**不** Fabric-on；**不**整段 P8b 执行。**合入本 docs PR ≠ PASS/GO；合入后续实现 PR 亦 ≠ 整段 D GO。**

## 1. Path-Gate 阶梯盘点（主 tip；诚实）

| 阶 | tip 状态 | 说明 |
| --- | --- | --- |
| Doc02 §9.3 P8a 缺口命名 | **已落地** | `packages/constitutional-contracts/src/path-gap/report.ts` |
| P8b Knife1 选中-only | **已落地** | `src/legal-path/{registry,select}.ts`；旗标默认关 |
| Runtime façade shadow | **已落地但未桥接 Path** | `src/runtime-facade/shadow.ts` 硬 null / 硬 false |
| **本刀** shadow↔select 仅报告桥 | **下一格（本三件套）** | 双 opt-in；仍不执行 |
| P8b 执行面 `executed=true` | **OUT / 仍 defer** | 见 `phase-d-p8b-p8c-deferred.md` |
| P8c / 热路径 Gate 收紧 | **OUT** | track 与站桩明示不批 |
| Fabric-on / live invoke / enforce 默认开 | **OUT** | 站桩 |
| 无新 scope 重开 #58–#66 | **禁止** | closeout 仍站 |

## 2. 目标（Goal）

在 C **NO-GO** / unique-benefit **FAIL** / **C10 仍不能 pass** / Owner Path-Gate track 已开前提下：

1. 书面锁定本刀 IN/OUT 与阶梯位置。  
2. 授权后续实现 PR：当调用方同时 opt-in shadow **且** legal-path select 时，runtime-facade shadow **可以**调用 `selectLegalPath` 并在报告结果中表面化 `selectedPath` / `legalPathSelectable`（不再恒 null/false）。  
3. 任一旗标关 → 行为面退回今日 #60（不选中 / 不执行 / 可仍丢弃候选，或等价 inert）。  
4. **永不**在本刀设 `executed=true`；**不**接线 gateway chat / tool invoke / ACP / AOR；**不** Gate 收紧。  
5. 主张天花板：**`code-present`** only。

## 3. 范围内（IN）

### 3.1 本 scope PR（docs-only）

| 项 | 说明 |
| --- | --- |
| 书面三件套 | 本 scope + acceptance + start-order |
| 阶梯盘点 | §1 表（P8a / Knife1 / shadow / 本刀 / OUT） |
| 最小 xref | `docs_phase_d_bounded_closeout.md`；`phase-d-p8b-knife1-scope.md` §9 残差行；可选 `phase-d-p8b-p8c-deferred.md` 一行指针 |
| track 引用 | 必须引用 `phase_d_meta_schema_path_gate_owner_track_acceptance` |

### 3.2 实现 PR（引用开工令；建议落点；**本 turn 不开**）

| 落点 | 路径（建议） | 约束 |
| --- | --- | --- |
| shadow 报告桥 | `packages/constitutional-contracts/src/runtime-facade/shadow.ts` | 仅当 shadow opt-in **且** select opt-in 时调用 `selectLegalPath`；可非空 `selectedPath`；`executed` 仍恒 false |
| 单测 | `packages/constitutional-contracts/src/runtime-facade/shadow.test.ts` | 双关 inert；仅 shadow 仍不选中；双开命中登记则报告选中且不执行；涂装候选拒绝 |
| 包 README 短节 | `packages/constitutional-contracts/README.md` | 明文：报告桥 ≠ Gate 收紧 ≠ 热路径 ≠ 执行 |
| 导出（若需） | `packages/constitutional-contracts/src/index.ts` | 仅当类型面需要；不新增热路径符号 |

行为约束：

- 函数**不**读 `process.env`；只接受调用方快照 / 显式 `shadow`/`select`。  
- 优先复用既有旗标名：`OPENBOT_CONSTITUTIONAL_SHADOW` + `OPENBOT_CONSTITUTIONAL_LEGAL_PATH_SELECT`。  
- **不**发明 enforce / live-invoke / Fabric 旗标。  
- P8a `LEGAL_CONSTITUTIONAL_PATHS = []` 与 `reportPathGap` **保持不动**（本刀不升格 P8a 空集）。  
- 主张 **`code-present`**；禁止 `runtime-enabled` / `production-proven`。

## 4. 范围外 / 禁止（OUT）

- **C10 pass** / green C10；Decision **C GO**；unique-benefit **PASS**；**整段 D GO**  
- Fabric-on；`ORCHESTRATION_LIVE_INVOKE` / live invoke；enforce 默认开  
- **热路径 Gate / Path 收紧**；P8c；整段 P8b **执行**面（`executed=true`）  
- 把本刀 import 进 gateway chat / tool invoke / ACP / AOR / dispatch / gateway-hook 热路径  
- 改写 Phase C 冻结正文 / digests / 旧 `final-acceptance.md` 决策位  
- 无新 scope 重开 #58–#66；把 Knife1 收口重写成「未完成故重开」  
- 本 scope PR 夹带 `src/` / `packages/` 编码  
- 发明 production-proven；Profile B 假闭合；C5 全面 pass

## 5. 主张天花板

- 本 scope PR：docs-only / **`code-present`**（文档事实）  
- 后续实现 PR：默认仍 **`code-present`**  
- **禁止**抬升至 C10 pass / Decision GO / 整段 D GO / `runtime-enabled` / `production-proven` /「Path 已在热路径」/「Gate 已收紧」

## 6. 成功标准

| 标准 | 判定 |
| --- | --- |
| 书面三件套 | scope + acceptance + start-order 入库；引用 Owner track acceptance |
| 阶梯诚实 | §1 标明 Knife1/shadow 已落地与本刀缺口；OUT 含执行面/Gate/Fabric |
| 站桩 | 每文件明文：**C10 仍不能 pass**；C NO-GO；非整段 D GO；非 C GO |
| 无越界 | OUT 未触碰；本 PR 无 `src/` / `packages/` |
| 两段门 | 本 PR 仅 docs；实现须另 PR 引用本开工令 |
| 合入 ≠ PASS/GO | 明文 |

## 7. 残差（本刀不做；须另文）

- P8b 执行边界内 opt-in `executed=true`  
- 合法轨迹空间扩展（>1）与旁路表闭合  
- P8c；Gate 收紧 ADR；C5 全面 pass 所需闭合  
- 热路径接线；Fabric-on；live invoke；enforce
- **诊断报告充实（另文；Owner Path-Gate track 下第二刀）：** `phase_d_path_gate_shadow_select_diagnostics` — shadow↔Knife1 select 诊断字段表面化；**仍不**执行 / Gate 收紧 / 登记扩展（见 `phase-d-path-gate-shadow-select-diagnostics-scope.md`）

## 8. 验收提示（独立验收 bot；本 PR 不呼叫）

**PASS（本 scope PR）：**

1. 三件套齐全；diff 仅 discovery（+ 可选最小 xref）。  
2. 引用 `phase_d_meta_schema_path_gate_owner_track_acceptance`。  
3. 每文件明文：**C10 仍不能 pass**；C NO-GO；非整段 D GO。  
4. IN = shadow↔Knife1 **仅报告**桥；OUT 含执行 / Gate 收紧 / Fabric-on / live invoke / 热路径 / `src/`。  
5. 接受宽度含 docs-only 与后续实现-under-start-order；claim ceiling `code-present`。

**FAIL：** 写成 C10 pass / C GO / 整段 D GO / 整段 P8b 执行 GO / Gate 已收紧；省略「仍不能 pass」；夹带代码；或改写 Phase C 冻结正文。
