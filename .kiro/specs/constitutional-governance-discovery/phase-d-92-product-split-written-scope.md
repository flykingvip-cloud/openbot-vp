# Phase D §9.2 — 产品拆分证明推进（书面范围；**accepted-for-d3-only**；非整段完成 / 非自动发版）

> 书面范围：`phase_d_92_product_split_written_scope`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-d-92-product-split-written-scope.md`。  
> 日期：2026-09-26（Asia/Shanghai）  
> 基线：`main` @ `731aed0cc2db568f0ae04e7e4e8207ad6a957d23`（#70 merge）或其后。  
> 对照：Doc02 §9.2；`phase-d-product-split-proof-plan.md`；`phase-d-product-split-scaffold.md`（#62）；`docs_phase_d_claim_level.md`；`phase-c-83-product-confirmation.md`  
> **状态：`accepted-for-d3-only`**（2026-09-26 Asia/Shanghai）。记名接受记录：`phase-d-92-written-scope-acceptance.md`。  
> 本页入库时为草稿待接受；**记名接受仅覆盖 D3 证据刀工程门**。D3 编码/落证据仅在接受记录 + `phase-d-92-d3-start-order.md` 两段门之后授权。  
> 本页**仍不是**整段 §9.2 完成、不是自动发版、不勾选证明箱、不授权 D1/D2/O*/L*。

## 1. 一句话

#62 脚手架只证明「边界名存在于 monorepo」。`phase-d-product-split-proof-plan.md` 已列出部署 / 所有权 / 生命周期三项检查表且**全部未勾选**（D3 可有证据页，仍 ☐）。本页把「如何收集证据、谁签字、签字后仍不等于发版」写成书面范围。**记名接受（见 acceptance）仅覆盖 D3 证据刀**；接受本页 ≠ 整段 §9.2 完成 ≠ 自动发版。§9.2 **推迟仍有效**，直至三项被证明且经**架构 Owner 签字**——即便如此，也**≠ 自动升格为发布边界 / 独立发版**。

## 2. 前置与依赖（站桩）

| 项 | 状态 |
| --- | --- |
| Phase C Decision | **NO-GO**；整段 D 在独立 C GO 前仍不批准 |
| #62 脚手架 | `code-present`：三包私有 `0.0.0` re-export；无独立部署作业 |
| 证明清单 | 三项 **☐ 未证明**（本刀**不得**勾选） |
| 产品确认 §7 | §9.2 **整段仍推迟**；仅 D3 证据刀经 accept+start-order 窄授权；P8b 仅 Knife1 窄授权；推迟条件仍有效 |
| 主张天花板 | **`code-present`**；禁 `runtime-enabled` / `production-proven` /「产品已拆」 |

## 3. 三项证明：需要什么证据

本范围若被接受，允许**另立证据页**收集下列材料；收集证据 ≠ 勾选完成 ≠ §9.2 已批准。

### 3.1 部署边界（D1–D3）

| # | 需要的证据形态 | 说明 |
| --- | --- | --- |
| D1 | 部署单元图 **或** 否定证明 ADR | 三者各自可指认的进程/作业边界；或书面证明「必须同进程」及不可拆原因 |
| D2 | 回滚/失败域说明 | 产物、镜像或作业名可分开回滚；失败域不强制绑死 contracts 热路径；若仍无热路径引用须显式写明 |
| D3 | 与 gateway / Pi 热路径的耦合图 | 允许「禁止单独部署」的否定证明；禁止把「包在 workspace」写成已解耦 |

### 3.2 所有权（O1–O3）

| # | 需要的证据形态 | 说明 |
| --- | --- | --- |
| O1 | 具名 Owner 表 | 每个提议产品有人/角色 Owner；与源账 Owner 的写权威边界书面切开 |
| O2 | 域边界备忘 | 无「跨域单一写权威」叙事；C11 仍按 Phase C / 域级清单 |
| O3 | README / 边界注抽检 | 安装≠授权、回执≠证明保持；无热路径 import 把包名写成已授权 |

### 3.3 生命周期（L1–L3）

| # | 需要的证据形态 | 说明 |
| --- | --- | --- |
| L1 | 版本节奏 ADR | 独立版本火车 **或** 明确「跟随 monorepo、禁止单独发版」 |
| L2 | 下线/弃用流程 | 谁关旗标、谁删包、谁改 workspace |
| L3 | Manifest 挂钩说明 | 符合性宣称如何引用三包；与 `docs_phase_d_claim_level.md` 标签一致 |

## 4. 架构 Owner 签字门

| 门 | 要求 |
| --- | --- |
| 证据齐 | D1–D3、O1–O3、L1–L3 均有外链或入库证据页（本草稿不发明假勾选） |
| **架构 Owner 签字** | 具名签字记录（人 + 日期 + 基线 SHA）；**无签字不得宣称「已证明」** |
| 勾选权 | 仅签字后可在 `phase-d-product-split-proof-plan.md` 将对应行改为已证明并外链；**本 PR / 本草稿不得勾选** |
| 签字后仍 ≠ 自动发版 | 从脚手架升格为发布边界须**另立书面范围 + 开工令**；本页不授权发版、独立仓库、生产流水线 |

## 5. §9.2 推迟（重申）

Doc02 §9.2 原文：Registry / Conformance / Runtime 拆独立产品 **推迟**，直到部署边界、所有权、生命周期被证明需要分离。

- 证明未勾选 → 推迟有效。  
- 证明已勾选且 Owner 已签 → 仍只允许「讨论升格」；**不**自动批准独立产品交付。  
- 整段 Phase D GO 仍要求独立 C GO；本页不提供该 GO。

## 6. 明确不授权（OUT）

- 勾选证明箱或宣称「产品已拆 / §9.2 已批准」
- 独立仓库、发布流水线、生产部署作业（本草稿阶段）
- 把三包 import 进 gateway chat / tool invoke / ACP / AOR / dispatch / gateway-hook
- P8b / P8c 开工；enforce / Gate / live invoke；Tier H
- 重开 #58–#70；整段 D GO；C NO-GO→GO；改写五份冻结正文
- 新 soft-observe 刀；C10 pass 叙事

## 7. 主张等级

本页：docs-only 草稿。相关代码主张天花板仍为 **`code-present`**（#62）。禁止抬升为 `runtime-enabled` / `production-proven`。

## 8. 范围内文件（本刀 docs-only；D3 有界）

| 项 | 文件 |
| --- | --- |
| 本书面范围 | `phase-d-92-product-split-written-scope.md`（本页；`accepted-for-d3-only`） |
| 有界接受 | `phase-d-92-written-scope-acceptance.md`（仅 D3） |
| D3 开工令 | `phase-d-92-d3-start-order.md` |
| D3 证据页 | `phase-d-92-d3-deploy-coupling-evidence.md` |
| 交叉引用 | `phase-d-product-split-proof-plan.md`：D3 可记部分进度；**检查表勾选仍全部 ☐** |

## 9. 成功标准（对本 docs 刀）

| 标准 | 判定 |
| --- | --- |
| 草稿齐全 | 三项证据形态、Owner 签字门、推迟重申、OUT 写明 |
| 未勾选 | proof-plan 检查表保持 ☐ 未证明 |
| 非发版 | 明确签字后仍 ≠ 自动发版 / 升格发布边界 |
| 站桩 | C NO-GO、整段 D 不批准、C10 不能 pass、无 soft-observe、五冻结未动 |

**PASS：** 上表满足；proof-plan 仅增加「草稿待接受」指针。  
**FAIL：** 任何已勾选却无外链、宣称 §9.2 已批准拆分、或把本页写成发版开工令。

## 10. 验收交接

独立验收 bot：按本页 §9 + proof-plan §6 + 产品确认非授权清单审阅。  
Material Owner 不自合并；**不**直接呼叫验收 bot；**不**在本 PR 内请求架构 Owner 签字（签字另轨）。
