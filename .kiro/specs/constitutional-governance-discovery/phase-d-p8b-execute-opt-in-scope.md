# Phase D P8b — 有界执行 opt-in（书面范围；**非整段 P8b / 非整段 D GO**）

> 范围 id：`phase_d_p8b_execute_opt_in`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-d-p8b-execute-opt-in-scope.md`。  
> 日期：**2026-09-26**（Asia/Shanghai）  
> 对照：Doc02 §9.3 P8b；`phase-d-p8b-written-scope.md`；`phase-d-p8b-knife1-scope.md`；`phase-d-p8b-p8c-deferred.md`；`phase-d-meta-schema-path-gate-owner-track-scope.md`；`phase-d-path-gate-shadow-select-diagnostics-scope.md`  
> 前置：`phase-d-p8b-execute-opt-in-acceptance.md` + `phase-d-p8b-execute-opt-in-start-order.md`  
> **引用 Owner track：** `phase_d_meta_schema_path_gate_owner_track_acceptance`（#101；`c9fdc09a`）— 本三件套为 track 下**有界 P8b 执行 opt-in** 书面授权（非整段阶梯 free-for-all）。  
> **前置刀（已落地）：** Knife1 选中-only（#74 系）；Path-Gate 报告桥 #103/#104；诊断充实 #106/#107；main tip ~`1ce3d77e`。  
> **本 PR = docs-only 书面范围 / 接受 / 开工令**。编码实现须引用本开工令另开实现 PR；**不**在本 PR 改 `src/` / `packages/`。  
> **基线 tip：** `1ce3d77e655cd96f1dca87540fd3441e2a45d58d`（#107 merge 或其后）。**合入 ≠ PASS/GO。**  
> **站桩（全文有效）：Phase C NO-GO COMPLETE；unique-benefit FAIL；C10 仍不能 pass。** 把本包读成 C10 pass / Decision C GO / 整段 D GO / 整段 P8b 完成 / unique-benefit PASS = **FAIL**。

## 0. 为何开本刀（Owner 令：执行 opt-in 接受+开工令三件套）

| 现象 | 证据 |
| --- | --- |
| Owner track 已合入 | #101 `c9fdc09a`；后续刀须**新** accept+start-order |
| Path-Gate knives 已落地 | #103/#104 报告桥；#106/#107 诊断；main tip ~`1ce3d77e` |
| Knife1 `executed` 仍恒 false | `selectLegalPath` / shadow 桥均不执行；deferred §4.2 残差「执行 opt-in」仍开 |
| Owner 令 | 2026-09-26（Asia/Shanghai）：「开 P8b 执行 opt-in 的接受+开工令三件套」 |
| 站桩 | C **NO-GO**；unique-benefit **FAIL**；**C10 仍不能 pass**；整段 P8b/P8c / Gate 收紧仍 defer |

本三件套把 deferred 残差「**执行 opt-in**」收成**新的有界书面范围**：授权**日后**实现 PR，在合法 Path **已选中**之后，仅当显式**默认关**的独立执行旗标打开时，允许包内 `executed=true`（包本地 stub / 结果面；**不**接 gateway chat / tool invoke 热路径）。**不是**整段 P8b 完成；**不是** P8c；**不是** Gate 收紧。**合入本 docs PR ≠ PASS/GO；合入后续实现 PR 亦 ≠ 整段 D GO / C GO / C10 pass。**

## 1. 阶梯盘点（主 tip @ #107；诚实）

| 阶 | tip 状态 | 说明 |
| --- | --- | --- |
| Doc02 §9.3 P8a 缺口命名 | **已落地** | `path-gap/report.ts` |
| P8b Knife1 选中-only | **已落地** | `legal-path/{registry,select}.ts`；`executed` 恒 false |
| Path-Gate shadow↔select 报告桥 | **已落地** | #103/#104 |
| Path-Gate shadow select 诊断 | **已落地** | #106/#107 |
| **本刀** 有界执行 opt-in | **下一格（本三件套）** | 选中后 + 独立 EXECUTE 旗标 → 可 `executed=true`（包本地） |
| 合法轨迹空间扩展（>1）/ 旁路表 | **本刀不做** | 保持 Knife1 单登记；>1 须另刀 |
| 整段 P8b 完成 / C5 全面 pass | **OUT** | 本刀至多 path-present 向 C5 的局部进度 |
| P8c / 热路径 Gate 收紧 | **OUT** | track 与站桩明示不批 |
| Fabric-on / live invoke / enforce 默认开 | **OUT** | 站桩 |

## 2. 目标（Goal）

在 C **NO-GO** / unique-benefit **FAIL** / **C10 仍不能 pass** / Owner Path-Gate track 已开 / Knife1+Path-Gate 报告面已落地前提下：

1. 书面锁定本刀 IN/OUT、`executed` 语义、旗标名、回滚、Profile 与 C5 关系。  
2. 授权后续实现 PR：在 `selectedPath` 非空（选中已发生）**且**新默认关执行旗标 opt-in 时，包内可设 `executed=true`（见 §3.2）。  
3. 旗标关 → `executed` 回 false；行为面回到「仅选中 / 不执行」。  
4. **不**接线 gateway chat / tool invoke / ACP / AOR 热路径；**不** Gate 收紧；**不** Fabric-on；**不**扩登记 >1。  
5. 主张天花板：**`code-present`** only。

## 3. 范围内（IN）

### 3.1 本 scope PR（docs-only）

| 项 | 说明 |
| --- | --- |
| 书面三件套 | 本 scope + acceptance + start-order |
| 阶梯盘点 | §1 表（含已落地与本刀缺口） |
| 最小 xref | `phase-d-p8b-p8c-deferred.md` §4.2；Path-Gate diagnostics 残差指针；可选 closeout 一行 |
| track 引用 | 必须引用 `phase_d_meta_schema_path_gate_owner_track_acceptance`；明文引用 Doc02 §9.3 P8b |

### 3.2 实现 PR（引用开工令；**本 turn 不开**）

| 落点 | 路径（建议） | 约束 |
| --- | --- | --- |
| 执行 opt-in API / stub | `packages/constitutional-contracts/src/legal-path/`（新建 `execute.ts` 或等价；或扩展 select 结果面） | **仅**在「选中已成立 ∧ EXECUTE 旗标开」时 `executed=true`；包本地 stub/结果；无 IO 副作用到网关 |
| 旗标常量 | 同包 `flags` / `legal-path` | 见 §4；模块**不**读 `process.env` |
| 单测 | 对应 `*.test.ts` | 默认关 inert；仅 SELECT 无执行；SELECT∧EXECUTE + 选中 → `executed=true`；关 EXECUTE → 回 false；涂装候选仍拒绝 |
| 包 README 短节 | `packages/constitutional-contracts/README.md` | 明文：执行 opt-in ≠ Gate 收紧 ≠ 热路径 ≠ 整段 P8b 完成 ≠ C5/C10 pass |
| 导出（若需） | `packages/constitutional-contracts/src/index.ts` | 不新增热路径符号 |

**优先包本地：** 第一实现以 package-local execute stub / result 为界（例如记录「边界内执行被允许」的结果字段与空副作用列表，或仅翻转 `executed` 布尔并附审计说明串）。**除非**开工令显式命名极小消费者，否则**不**接线 gateway chat / tool invoke / ACP / AOR / dispatch / gateway-hook。

行为约束：

- 前置：`OPENBOT_CONSTITUTIONAL_LEGAL_PATH_SELECT`（或 `select: true`）已使 `selectedPath` 非空；否则**不得** `executed=true`。  
- 执行旗标：`OPENBOT_CONSTITUTIONAL_LEGAL_PATH_EXECUTE`（或显式 `execute: true`）；默认关。  
- 函数**不**读 `process.env`；只接受调用方快照 / 显式选项。  
- **不**扩 `DECLARED_LEGAL_PATHS`；可选注记：登记 >1 须另刀。  
- 主张 **`code-present`**；禁止 `runtime-enabled` / `production-proven`。

### 3.3 `executed` 语义（本刀）

| 项 | 定义 |
| --- | --- |
| `executed=true` | 在本范围**包本地边界**内，选中轨迹的「执行被允许」结果面已发生（stub/结果字段）；**不是**生产聊天 enforce、**不是** Gate 收紧、**不是** live invoke 默认开 |
| `executed=false` | 默认；SELECT 关、未选中、或 EXECUTE 关 → 恒 false |
| `sideEffects` | 第一实现宜保持空或仅包内可审计标记；**禁止**默默写网关/租户数据 |
| 与 C5 | 可主张「path-present / 可执行边界内 opt-in」**局部进度**；**禁止** C5 pass / C10 pass |
| 与整段 P8b | 本刀 ≠ 整段 P8b 完成；轨迹空间 / 旁路表 / 热路径仍 OUT |

### 3.4 回滚

- 秒级：不要传入 EXECUTE 快照 / `execute: true`，或保持 `OPENBOT_CONSTITUTIONAL_LEGAL_PATH_EXECUTE` unset → `executed=false`。  
- SELECT 关仍回到 P8a 有效集空面（继承 Knife1）。  
- 实现 PR 可 `git revert`；docs-only 可 revert 本三件套合入提交。

### 3.5 Profile A / B 冲击注（本刀）

| Profile | 本刀结论 |
| --- | --- |
| A | `executed=true` **仍 ≠** session 路由授权；不得把执行 stub 写成逐用户授权替代品；`sessionKey` 仍非 Path |
| B | 包本地 stub **不得**借 Path 打开插件对全部租户数据的无限制进程内访问；禁止合并 A/B |
| 继承 | Knife1 `phase-d-p8b-knife1-profile-impact.md` 仍有效；本刀若引入任何跨包消费者，须在实现 PR 附修订冲击段 |

### 3.6 与 C5 / C10

- 可写：向 C5「存在可被选中且（opt-in 下）可标记执行」的 **path-present 进度**。  
- **不可写：** C5 pass；C10 pass；Decision C GO；unique-benefit PASS。  
- **C10 仍不能 pass**（全文站桩）。

## 4. 旗标命名（对齐既有风格）

| 旗标 | 角色 | 默认 |
| --- | --- | --- |
| `OPENBOT_CONSTITUTIONAL_LEGAL_PATH_SELECT` | 选中（已有；Knife1） | 关 |
| `OPENBOT_CONSTITUTIONAL_SHADOW` | shadow 报告（已有） | 关 |
| **`OPENBOT_CONSTITUTIONAL_LEGAL_PATH_EXECUTE`** | **本刀新建；执行 opt-in** | **关** |

命名对齐既有 `OPENBOT_CONSTITUTIONAL_LEGAL_PATH_SELECT` / `OPENBOT_CONSTITUTIONAL_SHADOW` / `OPENBOT_CONSTITUTIONAL_PATH_GAP_REPORT`：前缀 `OPENBOT_CONSTITUTIONAL_` + 能力词；模块不读 `process.env`。

## 5. 范围外 / 禁止（OUT）

- **C10 pass** / green C10；Decision **C GO**；unique-benefit **PASS**；**整段 D GO**  
- 宣称 **整段 P8b 完成** / C5 全面 pass  
- Fabric-on；`ORCHESTRATION_LIVE_INVOKE=true` 作生产默认；enforce 默认开  
- **热路径 Gate / Path 收紧**；**P8c**  
- 本刀交付登记集 >1（除非另开刀）；把 Workflow / sessionKey / Lobster / AOR / Fabric 涂装为 Path  
- 把本刀 import 进 gateway chat / tool invoke / ACP / AOR / dispatch / gateway-hook 热路径（第一实现）  
- 改写 Phase C 冻结正文 / digests / 旧 `final-acceptance.md` 决策位  
- 无新 scope 重开 #58–#66；把 Path-Gate 诊断收口重写成「未完成故重开」  
- 本 scope PR 夹带 `src/` / `packages/` 编码  
- 发明 production-proven；Profile B 假闭合

## 6. 主张天花板

- 本 scope PR：docs-only / **`code-present`**（文档事实）  
- 后续实现 PR：默认仍 **`code-present`**  
- **禁止**抬升至 C10 pass / Decision GO / 整段 D GO / 整段 P8b 完成 / `runtime-enabled` / `production-proven` /「Path 已在热路径」/「Gate 已收紧」

## 7. 成功标准

| 标准 | 判定 |
| --- | --- |
| 书面三件套 | scope + acceptance + start-order 入库；引用 Owner track；引用 Doc02 §9.3 P8b；引用 deferred 执行 opt-in 残差 |
| 旗标具名 | `OPENBOT_CONSTITUTIONAL_LEGAL_PATH_EXECUTE` 写明；默认关；独立于 SELECT |
| 站桩 | 每文件明文：**C10 仍不能 pass**；C NO-GO；非整段 D GO；非 C GO；非整段 P8b 完成 |
| 无越界 | OUT 未触碰；本 PR 无 `src/` / `packages/` |
| 两段门 | 本 PR 仅 docs；实现须另 PR 引用本开工令 |
| 合入 ≠ PASS/GO | 明文 |

## 8. 残差（本刀不做；须另文）

- 登记集 >1 / 旁路表闭合  
- 热路径消费者接线；Gate 收紧 ADR  
- **整段** P8c / Gate 收紧仍 OUT；有界 P8c 对照报告另见 `phase_d_p8c_shadow_legacy_compare`（本刀不授权）  
- Fabric-on；live invoke 生产默认；enforce  
- C5 全面 pass / C10 pass / Decision GO 所需闭合  

## 9. 验收提示（独立验收 bot；本 PR 不呼叫）

**PASS（本 scope PR）：**

1. 三件套齐全；diff 仅 discovery（+ 最小 xref）。  
2. 引用 `phase_d_meta_schema_path_gate_owner_track_acceptance`；引用 Doc02 §9.3 P8b；deferred §4.2 已注有界执行 opt-in。  
3. 每文件明文：**C10 仍不能 pass**；C NO-GO；非整段 D GO。  
4. IN = 有界执行 opt-in（选中后 + EXECUTE 旗标）；OUT 含 Gate 收紧 / Fabric-on / live invoke 默认 / P8c / 热路径 / 整段 P8b 完成 / `src/`。  
5. 接受宽度含 docs-only 与后续实现-under-start-order；claim ceiling `code-present`。

**FAIL：** 写成 C10 pass / C GO / 整段 D GO / 整段 P8b GO / Gate 已收紧 / EXECUTE 默认开；省略「仍不能 pass」；夹带代码；或改写 Phase C 冻结正文。
