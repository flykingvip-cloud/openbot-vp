# Requirements：宪法治理 Phase C 独立决策材料

> 状态：Phase C 文档决策 · **未提交** · Loom Owner：`grok-bot`
> 任务：`constitutional-governance-phase-c-decision:grok-bot`
> 分支：`grok-bot/constitutional-governance-phase-c-decision`（自 `origin/main` 新建工作树）
> 上游：Phase A（PR #3）、B1（PR #14）、B2（PR #20）、B2 后合并 Manifest（PR #23）

## Introduction

OpenBot 是企业 Agent OS。Constitutional Meta-Schema 是**治理透镜**，必须挣得席位，不是默认终态。Phase C 只输出 **GO / NO-GO / REVISE**，回答硬问题：

> **如果不建设 Meta-Schema / 统一契约包，仅收敛既有 execution-preflight、ConversationTask、task-orchestration，哪些真实问题仍无法解决？**

本阶段：**无运行时改动、不启 B2 旗、不部署、不建 `constitutional-contracts` 包、不实现 Path、不收紧 Gate、不 commit/push/PR。**

## Glossary

- **GO**：仅允许事后规划**有限** `constitutional-contracts` 包；**不**等于启旗 / 金丝雀 / Path / Gate / Phase D 编码授权。
- **NO-GO**：停止 Meta-Schema 工程化；B1/B2 保持默认关；继续既有治理收敛；Meta-Schema 归档为术语/评审透镜。
- **REVISE**：只列有限缺失证据；禁止借机扩 scope；禁止运行时编码。
- **Owner ≠ Reviewer**：材料 Owner 与 Architecture / Security / Execution-chain 三位 Reviewer 必须分离。

## In scope

1. Loom 草稿登记（未提交）独立任务，路径仅 `.kiro/specs/constitutional-governance-phase-c-decision/**`。
2. 冻结 `baseline-manifest.yaml`（含 PR #23 merge SHA）。
3. 交付九份材料：requirements / design / tasks / baseline-manifest / failure-cases / alternatives-matrix / metrics-and-evidence / security-profile-review / decision。
4. 至少尝试找出 3 个合格失败场景；若不足 3 个合格场景或 D 无独特收益 → 必须 NO-GO 或 REVISE。

## Out of scope

- `src/**` 实现改动；启用 `OPENBOT_CONVERSATION_TASK_ORCH_SHADOW` / `OPENBOT_CONVERSATION_TASK_WEB_READ_SHADOW`。
- `ORCHESTRATION_LIVE_INVOKE=true`；Fabric 默认开；Path 工程；Gate 收紧。
- 新建 npm 包 / Registry 物理合并 / 第五套执行状态机 / 新生产日志库。
- 以 B1/B2 合成语料分类成功冒充生产效果、C5/C10/C11 pass、或 Meta-Schema 必须产品化。

## 角色门禁

| 槽位                              | 稳定 id                                                             | 约束                                 |
| --------------------------------- | ------------------------------------------------------------------- | ------------------------------------ |
| Material Owner                    | `constitutional-governance-phase-c-decision:grok-bot`（`grok-bot`） | 写材料；≠ 任一 Reviewer              |
| Independent Architecture Reviewer | `codex-architecture`                                                | 独立架构槽；≠ Owner                  |
| Security Reviewer                 | `security-reviewer:profile-ab-tenant`                               | Profile A/B + 租户边界；显式命名角色 |
| Execution-chain Reviewer          | `conversation-task-runtime:kiro-conversation-task-runtime`          | 判重相对 preflight / CTR / orch      |

## Requirements

### R1 — 独立主干环境

1. THE 工作树 SHALL 自 `origin/main` 新建，不得在已合并 B2 功能分支 tip 上继续开发。
2. THE `baseline-manifest.yaml` SHALL 记录 `mainSha`、`phaseAMergeSha`、`b1MergeSha`、`b2MergeSha`、`b2ManifestMergeSha`，且确认 PR #23 在 main 上。

### R2 — 核心问题正答

1. THE `failure-cases.md` / `alternatives-matrix.md` / `decision.md` SHALL 正面回答「仅收敛三模块后仍未解的真实问题」。
2. GO SHALL NOT 仅因术语统一、优雅或未来扩展性成立。

### R3 — 三失败门与独特收益门

1. 每个失败场景 SHALL 含规定字段，并可在当前 `origin/main` 复现或有可信生产证据。
2. IF 找不到 3 个合格场景 OR 方案 D 相对 A–C 无清晰可度量且不可廉价替代的优势 THEN Decision MUST 为 NO-GO 或 REVISE。

### R4 — 否决项

任一否决项为真 → 不得 GO（见 `design.md` 否决表）。

### R5 — 零运行时 / 零提交

1. THE 变更集 SHALL 不含行为性 `src/` 改动。
2. THE 本轮 SHALL 保持工作树脏且未 commit/push/PR，供 Codex 审核。
