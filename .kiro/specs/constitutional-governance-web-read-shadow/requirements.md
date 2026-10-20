# Requirements：宪法治理 web_read 影子切片（Phase B 准入材料）

> 状态：Phase B **准入材料** · Loom Owner：`grok-bot`
> 任务：`constitutional-governance-web-read-shadow`
> **编码仍未批准。** 本目录材料齐备 ≠ 编码批准。
> 上级 Phase A：`.kiro/specs/constitutional-governance-discovery/`

## Introduction

在 Phase A 已批准的 `web_read` 只读影子设计合同之上，本任务只准备编码前准入材料：冻结 BaselineManifest、评估合同、60 条双标注语料、实现范围草案、报告 schema 与回滚说明。不改运行时。

## In scope

1. Loom Owner 声明与 registry **提案**（不直接改 `.loom/registry.yaml`）。
2. 冻结 `baseline-manifest.yaml`（进 B 前再生）。
3. 冻结 `eval-contract.md` 阈值与分母。
4. 产出 `corpus/annotated-cases.jsonl`（恰好 60 行）与 `annotation-meta.md`。
5. `implementation-scope-draft.md`、`report-schema-draft.json`、`rollback.md`。
6. Kiro 三件套（本文件、`design.md`、`tasks.md`）。

## Out of scope

- 任何 `src/**` / `packages/**` / `ui/**` / schema / 依赖 / Feature Flags 行为改动
- 材料 Owner 直接编辑 `.loom/registry.yaml`（lander = kiro-loom；本整改授权代理 land 除外）
- 提交 specs / push / PR / force-push（registry 本地 land 除外）
- 翻转 `ORCHESTRATION_LIVE_INVOKE`；调用 `web_search` / `web_fetch`；写生产 ledger
- Phase C GO / Path / Gate 收紧 / Bridge MVP

## 授权表（继承 Phase A）

| Phase                       | Status                                       |
| --------------------------- | -------------------------------------------- |
| A                           | 已完成（发现文档）                           |
| B 设计                      | 已批准（`web-read-shadow-slice.md`）         |
| **B 编码**                  | **未批准**（本材料为编码前条件，不构成批准） |
| C                           | 保留独立评审；不预提交 GO                    |
| D / contracts / Path / Gate | 当前不批准                                   |

## Requirements

### R1：零运行时

THE 变更集 SHALL 仅落在 `.kiro/specs/constitutional-governance-web-read-shadow/**`。

### R2：Manifest（B1 delivery-evidence）

THE `baseline-manifest.yaml` SHALL 含 assessedAt、productContractRevision、mainSha、registryCommitSha、classifierFrozenSha、holdoutSealSha、b1ImplementationSha、evaluatedTreeAt、productionSeq、productionGatewaySha、productionUiSha、evidenceSource；`evidenceSource` MUST 含 `repo ledger only; production-proven = unknown`。

- `mainSha` MUST = **最新 origin/main**（trunk tip）：`927ecd37b99578deafcb8c52ded6275b3a4e7464`。
- `registryCommitSha` MUST = 本分支上 `.loom/registry.yaml` 的 land commit：`bfb0324397d02e40a810b63cbd6494bcce52c67c`。
- `classifierFrozenSha` MUST = B1 classifier freeze：`533d3263d2de10b7ed0c1c7530b1e0bc774129ad`。
- `holdoutSealSha` MUST = blind holdout 密封 commit：`faca648c7c7ec658d22c67e02369849f4055aa15`。
- `b1ImplementationSha` MUST = 引入 independent-prediction evaluator（`evaluateWebReadShadow` runtime-input-only）的 commit。Requested prefix `0c72bd3d` → pre-rebase `0c72bd3d366bcea0e90598877f1ecef18004f6af`（rebase 后不再是 HEAD 祖先）；**记录 post-rebase 等价** `fd9a87693164fd56960df4814cad64261d87a7f3`。
- `evaluatedTreeAt` MUST = 评估时刻树 SHA（pre-doc-edit tip）：`5ba7b134d1b2635e5a40b786a2809b28379b4a1b`。
- **`mainSha` 不得取功能分支 HEAD 冒充 trunk。**
- **已删除** `taskHeadSha`「必须等于功能分支 HEAD / 最终自指 tip」要求；不再把 tip 自指当作 Manifest 合同字段。

### R3：评估合同

THE `eval-contract.md` SHALL 冻结 false allow ≤5%、completion claim suppression =100%（Option B；取代 false-completion≤5%）、replay=100%、cross-tenant=0、shadow 开/关零差异、p95≤10ms、分歧率>15% 须逐条解释，以及 Phase A §3.2 分母规则（完成部分按 `adr-completion-evaluation.md`）。并冻结 `dispatchPath` 一致性门：`shadow_dispatch` 必须含 `orch_shadow_observe`；`pre_dispatch_rejection` 单独分母、不混入 shadow 覆盖。

### R4：语料

THE 语料 SHALL 恰好 60 行；20/20/20 与 Profile 30/30；每条含 annotationA/annotationB/finalLabel；分歧由架构 Owner（Thomas Joshua）裁决；expectedDecisionClass + expectedReasonCodes（仅 ALL_ORCH_REASON_CODES）+ dispatchPath。来源混合最终为 synthetic 48 / unit-fixture 12。**无真实生产回放证据；原 prod-replay 标签已降级为 synthetic，伪造 restricted evidence 已删除。**

### R5：范围与回滚

THE 实现范围草案 SHALL 声明 invoke=false、enqueue=false、无 web 工具调用、无生产 ledger 写、无新状态机/日志库；回滚仅配置/接线。

### R6：Blind holdout Owner 证据（B1）

THE blind holdout SHALL 保持 **blind holdout / Owner-signed** 身份（不得降级为 post-freeze holdout）。架构 Owner 书面验收：

| Field               | Value                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| owner stable id     | `architecture-owner:thomas-joshua`                                        |
| classifierFrozenSha | `533d3263d2de10b7ed0c1c7530b1e0bc774129ad`                                |
| holdoutCorpusDigest | `sha256:c12eb16b6ee75c5ac0d0399af489af0dd476dc4b68a539075fc3dc1f2729b586` |
| revealedAt          | `2026-09-24T07:06:02+08:00`（Asia/Shanghai）                              |

Acceptance（exact）：

> 本人确认 blind holdout 语料（digest sha256:c12eb16b6ee75c5ac0d0399af489af0dd476dc4b68a539075fc3dc1f2729b586；revealedAt 2026-09-24T07:06:02+08:00；classifierFrozenSha 533d3263d2de10b7ed0c1c7530b1e0bc774129ad）作为 B1 独立 Owner 证据有效。

— Agent: grok-bot
