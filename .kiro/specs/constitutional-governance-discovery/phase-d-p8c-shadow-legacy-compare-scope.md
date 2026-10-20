# Phase D P8c — 有界影子↔legacy 对照报告（书面范围；**非整段 P8c / 非整段 D GO**）

> 范围 id：`phase_d_p8c_shadow_legacy_compare`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-d-p8c-shadow-legacy-compare-scope.md`。  
> 日期：**2026-09-27**（Asia/Shanghai）  
> 对照：Doc02 §9.3 P8c；`phase-d-p8b-p8c-deferred.md`；`phase-d-p8b-execute-opt-in-scope.md`；`phase-d-meta-schema-path-gate-owner-track-scope.md`；`phase-d-path-gate-shadow-select-diagnostics-scope.md`；`docs_phase_d_bounded_closeout.md`  
> 前置：`phase-d-p8c-shadow-legacy-compare-acceptance.md` + `phase-d-p8c-shadow-legacy-compare-start-order.md`  
> **引用 Owner track：** `phase_d_meta_schema_path_gate_owner_track_acceptance`（#101；`c9fdc09a`）— 本三件套为 track 下**有界 P8c 影子↔legacy 对照报告**书面授权（非整段阶梯 free-for-all；**不** Gate 收紧）。  
> **前置刀（已落地）：** Knife1 选中-only（#74 系）；Path-Gate 报告桥 #103/#104；诊断充实 #106/#107；P8b 有界执行 opt-in docs #108 + impl #111（`phase_d_p8b_execute_opt_in_start_order`）；main tip ~`0335ae8b`。  
> **本 PR = docs-only 书面范围 / 接受 / 开工令**。编码实现须引用本开工令另开实现 PR；**不**在本 PR 改 `src/` / `packages/`。  
> **基线 tip：** `0335ae8b78ddf08f1fa6d083c62208152ac44b9d`（#111 merge 或其后）。**合入 ≠ PASS/GO。**  
> **站桩（全文有效）：Phase C NO-GO COMPLETE；unique-benefit FAIL；C10 仍不能 pass。** 把本包读成 C10 pass / Decision C GO / 整段 D GO / 整段 P8c 完成 / unique-benefit PASS /「Gate 已收紧」= **FAIL**。

## 0. 为何开本刀（Owner 令：执行下一步 → 有界 P8c 对照）

| 现象 | 证据 |
| --- | --- |
| Owner track 已合入 | #101 `c9fdc09a`；后续刀须**新** accept+start-order |
| Path-Gate knives 已落地 | #103/#104 报告桥；#106/#107 诊断 |
| P8b 有界执行 opt-in 已落地 | docs #108 + impl #111；EXECUTE 默认关；包本地；`readyToTighten` 仍恒 false |
| shadow 面现状 | `shadowCompared` **恒 false**；无 legacy 对照字段；deferred 整段 P8c 仍标不批准 |
| Owner 令 | 2026-09-27（Asia/Shanghai）：P8b 落地后「执行下一步」→ Doc02 §9.3 阶梯下一命名格 = **P8c**（影子决策 vs legacy 对照） |
| 站桩 | C **NO-GO**；unique-benefit **FAIL**；**C10 仍不能 pass**；**整段** P8c / Gate 收紧 ADR 仍 defer（本刀仅为有界报告对照例外） |

本三件套把 deferred 残差「**P8c 影子决策 vs legacy 对照**」收成**新的有界书面范围**：授权**日后**实现 PR，在 shadow 报告面已 opt-in 且调用方提供 **legacy 决策快照**时，仅当显式**默认关**的独立对照旗标打开时，允许包内设 `shadowCompared=true` 并表面化对照报告字段（`compareMatch` 等）——**仅报告**；**不** Gate 收紧；**不**把 `readyToTighten` 翻 true；**不**扩 EXECUTE；**不**接 gateway 热路径。**不是**整段 P8c 完成；**不是**「指标达标且旁路表闭合后收紧另立 ADR」那一格。**合入本 docs PR ≠ PASS/GO；合入后续实现 PR 亦 ≠ 整段 D GO / C GO / C10 pass / Gate 已收紧。**

## 1. 阶梯盘点（主 tip @ #111+；诚实）

| 阶 | tip 状态 | 说明 |
| --- | --- | --- |
| Doc02 §9.3 P8a 缺口命名 | **已落地** | `path-gap/report.ts` |
| P8b Knife1 选中-only | **已落地** | `legal-path/{registry,select}.ts` |
| Path-Gate shadow↔select 报告桥 | **已落地** | #103/#104 |
| Path-Gate shadow select 诊断 | **已落地** | #106/#107 |
| P8b 有界执行 opt-in | **已落地**（#108/#111） | EXECUTE 默认关；包本地；非整段 P8b |
| **本刀** 有界 P8c 影子↔legacy 对照报告 | **下一格（本三件套）** | COMPARE 默认关；报告-only；`readyToTighten` 仍恒 false |
| 登记集 >1 / 旁路表闭合 | **本刀不做** | Doc02：收紧前须旁路表闭合；须另刀 |
| 热路径 Gate 收紧 ADR | **OUT** | Doc02：收紧另立 ADR after metrics+bypass；**不是**本刀 |
| Fabric-on / live invoke / enforce 默认开 | **OUT** | 站桩 |

## 2. 目标（Goal）

在 C **NO-GO** / unique-benefit **FAIL** / **C10 仍不能 pass** / Owner Path-Gate track 已开 / Knife1+Path-Gate+有界 EXECUTE 已落地前提下：

1. 书面锁定本刀 IN/OUT、对照语义、旗标名、回滚、与 Doc02「收紧另立 ADR」的边界。  
2. 授权后续实现 PR：当 shadow 已 opt-in **且** COMPARE 旗标开 **且** 调用方提供足够的 legacy 决策快照时，包内可设 `shadowCompared=true` 并表面化对照报告字段（见 §3.2）。  
3. COMPARE 关或不充分输入 → `shadowCompared` 保持 **false**（今日面）。  
4. **`readyToTighten` 本刀永远保持 false**；对照 ≠ Gate 许可。  
5. **不**接线 gateway chat / tool invoke / ACP / AOR 热路径；**不** Gate 收紧 ADR；**不** Fabric-on；**不**扩登记 >1；**不**靠本刀扩 `executed`。  
6. 主张天花板：**`code-present`** only。

## 3. 范围内（IN）

### 3.1 本 scope PR（docs-only）

| 项 | 说明 |
| --- | --- |
| 书面三件套 | 本 scope + acceptance + start-order |
| 阶梯盘点 | §1 表（含已落地与本刀缺口） |
| 最小 xref | `phase-d-p8b-p8c-deferred.md` §4.2；`docs_phase_d_bounded_closeout.md` 新 §（同 §10 模式）；可选 Path-Gate / execute scope 残差一行 |
| track 引用 | 必须引用 `phase_d_meta_schema_path_gate_owner_track_acceptance`；明文引用 Doc02 §9.3 P8c |

### 3.2 实现 PR（引用开工令；**本 turn 不开**）

| 落点 | 路径（建议） | 约束 |
| --- | --- | --- |
| 对照报告 API | `packages/constitutional-contracts/src/runtime-facade/shadow.ts` 及/或新建 `compare.ts`（runtime-facade 或 legal-path 下极小模块） | **仅**在「SHADOW 开 ∧ COMPARE 开 ∧ 两侧足够可对照」时 `shadowCompared=true`；包本地报告面；无 IO 副作用到网关 |
| 旗标常量 | 同包 `flags` / runtime-facade | 见 §4；模块**不**读 `process.env` |
| 输入 | 调用方提供 **legacy 决策快照**（如 `legacyDecision` / `legacyPathRef` **字符串**） | **不得**把该串当 Path；涂装别名仍非 Path |
| 报告字段（建议） | 同结果面 | `shadowCompared`；`compareMatch`（bool\|null）；`legacyDecisionPresent`；`constitutionalDecisionPresent` / 复用 `selectedPath`；`compareMessage` |
| 单测 | 对应 `*.test.ts` | 默认关 inert；仅 SHADOW 无对照；COMPARE∧SHADOW + 两侧足够 → `shadowCompared=true`；关 COMPARE → 回 false；`readyToTighten` 恒 false；模块不读 `process.env` |
| 包 README 短节 | `packages/constitutional-contracts/README.md` | 明文：对照报告 ≠ Gate 收紧 ≠ 热路径 ≠ 整段 P8c 完成 ≠ C5/C10 pass；`readyToTighten` 仍 false |
| 导出（若需） | `packages/constitutional-contracts/src/index.ts` | 不新增热路径符号 |

**优先包本地：** 第一实现以 package-local / constitutional-contracts 为界。**除非**开工令显式命名极小消费者，否则**不**接线 gateway chat / tool invoke / ACP / AOR / dispatch / gateway-hook。

行为约束：

- 前置：shadow 报告面已 opt-in（`OPENBOT_CONSTITUTIONAL_SHADOW` / `shadow: true`）；否则**不得** `shadowCompared=true`。  
- 对照旗标：`OPENBOT_CONSTITUTIONAL_SHADOW_COMPARE`（或显式 `compare: true`）；默认关。  
- 调用方须供应 legacy 决策快照；两侧不足 → `shadowCompared` 保持 false（可表面化 `legacyDecisionPresent=false` 等诊断）。  
- 函数**不**读 `process.env`；只接受调用方快照 / 显式选项。  
- **`readyToTighten` 本刀永远 false**；禁止用 COMPARE 翻 true。  
- **`executed` 不**由本刀扩展；EXECUTE 仍独立于 `phase_d_p8b_execute_opt_in`。  
- 主张 **`code-present`**；禁止 `runtime-enabled` / `production-proven` /「Gate 已收紧」。

### 3.3 `shadowCompared` / 对照语义（本刀）

| 项 | 定义 |
| --- | --- |
| `shadowCompared=true` | 在本范围**包本地边界**内，shadow 决策面与调用方提供的 legacy 快照已做**报告对照**；**不是**生产 enforce、**不是** Gate 收紧、**不是** live invoke 默认开 |
| `shadowCompared=false` | 默认；SHADOW 关、COMPARE 关、或不充分输入 → 恒 false（今日面） |
| `compareMatch` | bool\|null：两侧可比较时为匹配布尔；不可比较时 null |
| `readyToTighten` | **本刀永远 false**；对照报告 ≠ Gate 许可 |
| 与 Doc02 §9.3 | 本刀覆盖 P8c「影子决策 vs legacy 对照」的**有界报告切片**；「指标达标且旁路表闭合后，收紧另立 ADR」仍 OUT |
| 与整段 P8c | 本刀 ≠ 整段 P8c 完成；旁路表 / 度量达标 / 收紧 ADR / 热路径仍 OUT |

### 3.4 回滚

- 秒级：不要传入 COMPARE 快照 / `compare: true`，或保持 `OPENBOT_CONSTITUTIONAL_SHADOW_COMPARE` unset → `shadowCompared=false`。  
- SHADOW 关回到 #60 基座面。  
- 实现 PR 可 `git revert`；docs-only 可 revert 本三件套合入提交。

### 3.5 Profile A / B 冲击注（本刀）

| Profile | 本刀结论 |
| --- | --- |
| A | 对照报告 **仍 ≠** session 路由授权；`legacyPathRef` / `sessionKey` 字符串 **不是** Path |
| B | 包本地对照 **不得**借报告打开插件对全部租户数据的无限制进程内访问；禁止合并 A/B |
| 继承 | Knife1 / Path-Gate / EXECUTE 冲击注仍有效；本刀若引入任何跨包消费者，须在实现 PR 附修订冲击段 |

### 3.6 与 C5 / C10

- 可写：向观察面「影子 vs legacy 可对照」的 **report-present 进度**。  
- **不可写：** C5 pass；C10 pass；Decision C GO；unique-benefit PASS；「Gate 已收紧」。  
- **C10 仍不能 pass**（全文站桩）。

## 4. 旗标命名（对齐既有风格）

| 旗标 | 角色 | 默认 |
| --- | --- | --- |
| `OPENBOT_CONSTITUTIONAL_SHADOW` | shadow 报告（已有） | 关 |
| `OPENBOT_CONSTITUTIONAL_LEGAL_PATH_SELECT` | 选中（已有；Knife1） | 关 |
| `OPENBOT_CONSTITUTIONAL_LEGAL_PATH_EXECUTE` | 执行 opt-in（已有；#111） | 关 |
| **`OPENBOT_CONSTITUTIONAL_SHADOW_COMPARE`** | **本刀新建；影子↔legacy 对照报告** | **关** |

命名对齐既有 `OPENBOT_CONSTITUTIONAL_SHADOW` / `OPENBOT_CONSTITUTIONAL_LEGAL_PATH_*` / `OPENBOT_CONSTITUTIONAL_PATH_GAP_REPORT`：前缀 `OPENBOT_CONSTITUTIONAL_` + 能力词；模块不读 `process.env`。

## 5. 范围外 / 禁止（OUT）

- **C10 pass** / green C10；Decision **C GO**；unique-benefit **PASS**；**整段 D GO**  
- 宣称 **整段 P8c 完成** / C5 全面 pass  
- Fabric-on；`ORCHESTRATION_LIVE_INVOKE=true` 作生产默认；enforce 默认开  
- **热路径 Gate / Path 收紧**；**发明 Gate 收紧 ADR 作为本刀**；用 COMPARE 翻 `readyToTighten=true`  
- 本刀交付登记集 >1；把 Workflow / sessionKey / Lobster / AOR / Fabric 涂装为 Path  
- 把本刀 import 进 gateway chat / tool invoke / ACP / AOR / dispatch / gateway-hook 热路径（第一实现）  
- 改写 Phase C 冻结正文 / digests / 旧 `final-acceptance.md` 决策位  
- 无新 scope 重开 #58–#66；把 Path-Gate / EXECUTE 收口重写成「未完成故重开」  
- 本 scope PR 夹带 `src/` / `packages/` 编码  
- 发明 production-proven；Profile B 假闭合；宣称 `runtime-enabled`

## 6. 主张天花板

- 本 scope PR：docs-only / **`code-present`**（文档事实）  
- 后续实现 PR：默认仍 **`code-present`**  
- **禁止**抬升至 C10 pass / Decision GO / 整段 D GO / 整段 P8c 完成 / `runtime-enabled` / `production-proven` /「Path 已在热路径」/「Gate 已收紧」

## 7. 成功标准

| 标准 | 判定 |
| --- | --- |
| 书面三件套 | scope + acceptance + start-order 入库；引用 Owner track；引用 Doc02 §9.3 P8c；引用 deferred 整段 P8c 仍不批准 + 有界例外 |
| 旗标具名 | `OPENBOT_CONSTITUTIONAL_SHADOW_COMPARE` 写明；默认关；独立于 SHADOW / EXECUTE |
| 站桩 | 每文件明文：**C10 仍不能 pass**；C NO-GO；非整段 D GO；非 C GO；非整段 P8c 完成；**不** Gate 收紧 |
| 无越界 | OUT 未触碰；本 PR 无 `src/` / `packages/` |
| 两段门 | 本 PR 仅 docs；实现须另 PR 引用本开工令 |
| 合入 ≠ PASS/GO | 明文 |

## 8. 残差（本刀不做；须另文）

- 登记集 >1 / 旁路表闭合  
- 热路径消费者接线；**Gate 收紧 ADR**（Doc02：收紧另立）  
- Fabric-on；live invoke 生产默认；enforce  
- C5 全面 pass / C10 pass / Decision GO 所需闭合  
- 用对照指标自动翻 `readyToTighten`

## 9. 验收提示（独立验收 bot；本 PR 不呼叫）

**PASS（本 scope PR）：**

1. 三件套齐全；diff 仅 discovery（+ 最小 xref）。  
2. 引用 `phase_d_meta_schema_path_gate_owner_track_acceptance`；引用 Doc02 §9.3 P8c；deferred §4.2 已注有界 P8c 对照例外（整段仍 defer）。  
3. 每文件明文：**C10 仍不能 pass**；C NO-GO；非整段 D GO；非整段 P8c 完成；不 Gate 收紧。  
4. IN = 有界影子↔legacy 对照报告（SHADOW ∧ COMPARE ∧ legacy 快照）；OUT 含 Gate 收紧 ADR / Fabric-on / live invoke 默认 / 热路径 / 整段 P8c 完成 / `readyToTighten=true` / `src/`。  
5. 接受宽度含 docs-only 与后续实现-under-start-order；claim ceiling `code-present`。

**FAIL：** 写成 C10 pass / C GO / 整段 D GO / 整段 P8c GO / Gate 已收紧 / COMPARE 默认开 / `readyToTighten` 可翻 true；省略「仍不能 pass」；夹带代码；或改写 Phase C 冻结正文。
