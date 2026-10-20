# Requirements：宪法治理发现（Phase A）

> 状态：Phase A 文档发现 · Loom Owner：`grok-bot`（显示名 grok bot）
> 任务：`constitutional-governance-discovery:grok-bot`
> 上级文档（已合并）：`docs/design/openbot-constitutional-gap-and-feasibility-2026-09-23.md`、`docs/design/openbot-transformation-execution-plan-2026-09-23.md`、`docs/design/openbot-constitutional-revision-notes-2026-09-23.md`
> 盘点源（未合并，只引用）：PR #1249 `docs/design/openbot-constitutional-meta-schema-gap-assessment-2026-09-23.md`

## Introduction

OpenBot 的正式定位是**企业 Agent OS**。Constitutional Meta-Schema 是治理透镜，不是已批准的四产品终态。Phase A 只做事实收敛：冻结名词、列清有副作用入口、写清域内权威与证据分级、交出可检查的 `web_read` 只读切片合同，并附可再生成的 BaselineManifest。

本阶段不改运行时，不建 schema，不新建包。

## Glossary

- **Workflow**：被命名的流程空间（Lobster、Fabric 图、AOR 图、休眠编排、知识 kind）。不是一次合法轨迹。
- **Path**：一次被选中的合法执行轨迹。代码里尚无此宪法对象（C5 = fail）。
- **receipt**：某事被记录或已应用的回执。
- **proof**：对效果的独立核验。演进域用 `ledgerEventIsReceiptNotProof` 把二者分开。
- **Profile A / B**：`SECURITY.md` 的 `personal_local` 与 `managed_enterprise`，两套互斥合同。
- **BaselineManifest**：某次验收当时的产品合同修订、`mainSha`、生产 seq 与 gateway/UI SHA。不是六周常量。

## In scope

1. Loom 登记唯一 Owner `grok-bot`，路径仅 `.kiro/specs/constitutional-governance-discovery/**`。
2. 标准 Kiro 三件套：本文件、`design.md`、`tasks.md`。
3. 恰好四份正文：
   - `terminology-and-non-equivalence.md`
   - `execution-entry-inventory.md`
   - `authority-evidence-baselines.md`
   - `web-read-shadow-slice.md`
4. 在产出 3 写入 BaselineManifest（评审快照与 Phase A 草案分列）。
5. 授权表如下，写入需求与设计，供架构评审引用。

## Out of scope

- TypeScript 运行时、feature 默认值、`ORCHESTRATION_LIVE_INVOKE`、Fabric 默认开关。
- schema 文件、新 npm 包、Meta-Schema / Registry / Runtime / Conformance 产品骨架。
- 第五份架构长文。
- Phase B 编码、Phase C 裁决、Phase D、真实 Path、Gate 收紧、Bridge MVP。
- 把 Agent 重命名为 Node，或合并各本登记簿。

## 授权表

| Phase                                                    | Status                                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------------------ |
| **A**                                                    | **正式批准启动**                                                         |
| **B 设计**                                               | **批准**（合同在 `web-read-shadow-slice.md`）                            |
| **B 编码**                                               | 目标面、标注语料、阈值、报告落点齐备并签字后才批准。本 PR 不构成编码批准 |
| **C**                                                    | **保留独立评审权**。输出只允许 GO / NO-GO / REVISE。不预提交 GO          |
| **D / constitutional-contracts / 真实 Path / Gate 收紧** | **当前均不批准**                                                         |

## Requirements

### Requirement 1：Loom Owner 门禁

1. THE 任务 SHALL 在 `.loom/registry.yaml` 有且仅有一条 Owner 为 `grok-bot` 的活跃任务，id 为 `constitutional-governance-discovery:grok-bot`。
2. THE 路径声明 SHALL 覆盖且限于 `.kiro/specs/constitutional-governance-discovery/**`。
3. IF 另一任务已声明同一 glob THEN 不得改写他人路径来“解决”冲突；只在注册表内报告并处理。

### Requirement 2：四份正文且仅四份

1. THE 目录 SHALL 包含上文四份正文，外加 Kiro 三件套。
2. 每份正文 SHOULD ≤ 300 行。
3. THE 正文 SHALL 引用已合并的 `docs/design/*-2026-09-23.md` 与可复核的代码锚点，未知项写 `unknown`。

### Requirement 3：三条 ADR 与入口 / 权威 / 切片合同

1. THE 术语文 SHALL 冻结 Workflow ≠ Path、receipt ≠ proof、plugin installed ≠ capability authorized。
2. THE 入口清单 SHALL 对每个入口记录：默认启用、Profile A/B、身份源、授权点、工具过滤点、完成权威、证据/provenance、失败语义、production-proven。
3. THE 权威文 SHALL 把 C11 目标写成 `Domain-local single authority + explicit cross-domain finalization protocol`，并拒绝跨域单一写权威。
4. THE 切片文 SHALL 把 Phase B 首切面锁为 `web_read`，并写死评估合同，使“编码前合同是否齐备”可检查。

### Requirement 4：零运行时

1. THE 变更集 SHALL 不含 `src/`、`packages/`、`ui/`、schema 或依赖清单的行为改动。
2. 注册表除本任务条目外 SHALL 不改他人路径。
