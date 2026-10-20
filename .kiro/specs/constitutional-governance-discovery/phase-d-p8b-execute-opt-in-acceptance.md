# Phase D P8b — 有界执行 opt-in 有界接受记录（**非整段 P8b / 非整段 D GO**）

> 记录 id：`phase_d_p8b_execute_opt_in_acceptance`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-d-p8b-execute-opt-in-acceptance.md`。  
> 日期：**2026-09-26**（Asia/Shanghai）  
> 对象：P8b **有界执行 opt-in** 书面范围与后续实现门 — **不是**整段 P8b 完成、**不是**整段 D GO、**不是** C GO、**不是** C10 pass、**不是** Gate 收紧、**不是** Fabric-on  
> 对照：`phase-d-p8b-execute-opt-in-scope.md`；`phase-d-p8b-written-scope.md`（Doc02 §9.3 P8b）；`phase-d-p8b-knife1-scope.md`；`phase-d-p8b-p8c-deferred.md`；`phase-d-meta-schema-path-gate-owner-track-acceptance.md`（#101）；`final-acceptance.md`（NO-GO COMPLETE）  
> **引用 Owner track：** `phase_d_meta_schema_path_gate_owner_track_acceptance`  
> 本页是**工程门接受记录**。宽度见 §1。**不**翻转 NO-GO；**C10 仍不能 pass**；把本页读成 C10 pass / C GO / 整段 D GO / 整段 P8b GO / Gate 已收紧 = **FAIL**。

## 1. 接受结论

| 项 | 结论 |
| --- | --- |
| 接受对象 | `phase_d_p8b_execute_opt_in`（有界 P8b 执行 opt-in） |
| 接受宽度（本 PR） | **accepted-for-scope-docs-only** — 授权本书面范围三件套 + 最小 xref 入库 |
| 接受宽度（实现） | **accepted-for-execute-opt-in-implement-under-start-order** — 在开工令生效后，授权**仅** scope §3.2 包本地执行 stub/结果（选中 ∧ `OPENBOT_CONSTITUTIONAL_LEGAL_PATH_EXECUTE`）的实现 PR（主张 `code-present`；无热路径；无 Gate 收紧；无登记扩展；非整段 P8b） |
| 正式 C10 pass | **不接受** |
| Decision C GO | **不接受** |
| unique-benefit PASS | **不接受** |
| 整段 Phase D GO | **不接受** |
| 整段 P8b 完成 / C5 全面 pass | **不接受** |
| P8c / Gate 收紧 / Fabric-on / live invoke 默认 / enforce 默认开 | **不接受** |
| 不接受为 | C10 pass；Decision C GO；unique-benefit PASS；整段 D GO；整段 P8b GO；热路径 Gate 收紧；改写 Phase C 冻结正文；本 PR `src/` / `packages/` 编码；EXECUTE 默认开；本刀扩登记集 >1 |
| 站桩仍有效 | Phase C **NO-GO** / Independent **COMPLETE**；unique-benefit **FAIL**；**C10 仍不能 pass**；#58–#66 有界收口仍站；Knife1 / Path-Gate 报告与诊断仍站；deferred「**整段**」P8b/P8c 叙事仍诚实；merge ≠ PASS/GO |

一句话：**接受「Owner track 下有界 P8b 执行 opt-in」为记名 docs 三件套；本 PR 只落范围文档；实现须引用开工令另 PR；merge ≠ 整段 P8b GO ≠ PASS/GO。**

## 2. 权威与依据

| 项 | 内容 |
| --- | --- |
| 权威 | Owner（Thomas35 Joshua）via Grok Bot「network of networks」 |
| 日期 | **2026-09-26**（Asia/Shanghai） |
| 用户令 | 「开 P8b 执行 opt-in 的接受+开工令三件套」；claim ceiling `code-present` planning；未来实现仍须本开工令 + 后续代码 PR 接受 |
| track 前置 | `phase_d_meta_schema_path_gate_owner_track_acceptance`（#101）；后续刀须新两段门 — 本接受即该**有界执行 opt-in**门 |
| Doc02 | §9.3 P8b（真实合法 Path；本刀仅覆盖其中「选中后执行 opt-in」有界切片） |
| deferred 残差 | `phase-d-p8b-p8c-deferred.md` §4.2 曾列「执行 opt-in」仍 defer — 本三件套为**新书面范围**，授权有界刀，**不**把「整段」P8b/P8c 改成 free-for-all |
| 盘点裁定 | 见 scope §0–§1：Knife1+Path-Gate 后真实缺口 = 执行面仍恒 false；下一格 = 默认关 EXECUTE；热路径/Gate/P8c/登记扩展仍 OUT |
| 非权威 | Material Owner / 实现 agent **不得**把本接受扩成 C10 pass、NO-GO→GO、整段 D GO、整段 P8b 完成、Fabric-on、live invoke 默认、Gate 收紧、或登记空间闭合 |

## 3. 两段门

| 门 | 文件 | 作用 |
| --- | --- | --- |
| 接受门（本页） | `phase-d-p8b-execute-opt-in-acceptance.md` | 记名接受本刀；明文非整段 GO / 非 C10 pass / 非 Gate 收紧 / 非整段 P8b |
| 开工令 | `phase-d-p8b-execute-opt-in-start-order.md` | 授权本 docs PR 三件套入库；并授权后续实现 PR 按 scope §3.2 编码 |

两段门不可合并偷渡为「C10 pass」「Decision C GO」「整段 D GO」「整段 P8b 完成」「Gate 已收紧」。本 PR 为 docs-only；实现 PR 必须引用开工令 id。

## 4. 生效后仍禁止

- 宣称 C10 pass / green C10 / Decision C GO / unique-benefit PASS / 整段 D GO / 整段 P8b 完成 / C5 全面 pass  
- 改写 Phase C 冻结正文 / digests / 旧 final-acceptance 决策位  
- Fabric-on；`ORCHESTRATION_LIVE_INVOKE=true` 作生产默认；enforce 默认开；热路径 Gate 收紧；P8c  
- 本 PR 夹带 `src/` / `packages/`  
- 把 EXECUTE 写成默认开；把本接受读成「整段 Path-Gate / D / P8b 工程里程碑已 GO」

## 5. 指针

| 文件 | 角色 |
| --- | --- |
| `phase-d-p8b-execute-opt-in-start-order.md` | 开工令（第二门） |
| `phase-d-p8b-execute-opt-in-scope.md` | 书面范围正文 |
| `phase-d-meta-schema-path-gate-owner-track-acceptance.md` | Owner track 接受（必须引用） |
| `phase-d-p8b-written-scope.md` / acceptance | 父 P8b 书面范围（Doc02 §9.3）；`accepted-for-knife1-only` 仍站 |
| `phase-d-p8b-knife1-scope.md` / start-order | Knife1 选中-only 前置 |
| `phase-d-p8b-p8c-deferred.md` | **整段** P8b/P8c 仍不批准；本刀为有界例外注记 |
| `phase-d-path-gate-shadow-select-diagnostics-scope.md` | Path-Gate 诊断残差指针（执行 opt-in 已另文） |
| `final-acceptance.md` | 现行外部立场（NO-GO COMPLETE） |
