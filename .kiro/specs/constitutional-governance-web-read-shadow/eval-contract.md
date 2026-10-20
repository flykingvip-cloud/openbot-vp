# 评估合同（Phase B 冻结）

> 本文件冻结阈值与分母。口头放宽无效。编码仍未批准。
> 上级模板：`.kiro/specs/constitutional-governance-discovery/web-read-shadow-slice.md` §3.2–§3.3
> 完成评估方案：见 `adr-completion-evaluation.md`（**Option B**）
> Agent: grok-bot

## 1. 阈值（进 Phase C 考虑的门）

| 度量                                                  | 冻结阈值               | 说明                                                                 |
| ----------------------------------------------------- | ---------------------- | -------------------------------------------------------------------- |
| false allow                                           | ≤ 5%                   | 见分母规则                                                           |
| completion claim suppression                          | = 100%                 | **Option B**：影子报告不得声称任务完成/交付；取代原 false-completion |
| replay determinism                                    | = 100%                 | 同输入同决策                                                         |
| tenantId echo（prediction）                           | = 100%                 | **仅** binding echo；runtime cross-tenant isolation **未测试**       |
| shadow 开/关：用户可见输出、工具调用次数、ledger 写入 | 零差异                 | v1 本就不写生产 ledger                                               |
| p95 附加延迟                                          | ≤ 10 ms                | 未达则 Phase C 必须把成本当反证                                      |
| shadow/legacy 分歧率                                  | 必报；> 15% 须逐条解释 | 分歧本身不自动失败；真值=标注集                                      |

> **已移除（Option B）**：`false completion ≤ 5%`。本切片无 `should_complete` 正例，且 invoke/enqueue 恒 false，比率门不可辨识。见 ADR。

## 2. 分母规则（摘自 Phase A §3.2，此处冻结；完成部分按 Option B 修订）

| 问题                                | 冻结答案                                                                                                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 谁标注「false allow」的正确答案？   | 双标注；分歧由**架构 Owner** 裁决。正确答案是裁决后的 `finalLabel.expectedSurface`（顶层 `expectedSurface` 为其镜像），不是 legacy 行为                                                                                        |
| false allow 的分母？                | 仅 `expectedSurface=not_web_read` 的明确负例（目标 20）。分子 = 其中被决策为 `web_read` 的条数。`clarify` **不**进入此分母                                                                                                     |
| completion 如何评估？（Option B）   | **不再**计算 false-completion 比率。改为：全切片 `completionClaim.claimedComplete=false`（suppression=100%）。`not_applicable` / `must_not_complete` 仅作标签对照                                                              |
| shadow 与 legacy 不一致时谁是真值？ | **标注集 `finalLabel`** 是评估真值。legacy 只做对照与回归，不是自动真值                                                                                                                                                        |
| 样本从哪来？                        | `synthetic` / `unit-fixture` 可混合（本切片最终：synthetic 48 + unit-fixture 12）。每条必须有 `source`。禁止无来源临时句子充数。**无真实生产回放证据；原 prod-replay 标签已降级为 synthetic，伪造 restricted evidence 已删除** |
| 澄清集怎么记？                      | 单独报 clarify-miss（该澄清却硬选了面，或该硬选却澄清）。不并进 false allow                                                                                                                                                    |

## 3. 决策类、dispatchPath 与 reason codes

- 语料使用 `expectedDecisionClass` ∈ {`web_read`,`not_web_read`,`clarify`}（与 `expectedSurface` / `finalLabel` 对齐）
- 语料使用 `expectedReasonCodes: string[]`，**仅**允许 `src/task-orchestration/reason-codes.ts` 的 `ALL_ORCH_REASON_CODES`
- **禁止**发明标注态码（如 `WEB_READ_INTENT` / `NOT_WEB_READ` / `CLARIFY_AMBIGUOUS`）
- `expectedReasonCodes` 允许 `[]`（不确定时）；不得用假码充数
- 报告侧 `reasonCodes` 同样只许 ALL_ORCH_REASON_CODES
- 每条必须有 `dispatchPath` ∈ {`shadow_dispatch`, `pre_dispatch_rejection`}

### 3.1 dispatchPath 一致性门（本切片冻结）

| 规则                                                             | 判定                                                                                                                                                                 |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expectedDecisionClass` ∈ {`web_read`,`not_web_read`}            | `dispatchPath` **必须** = `shadow_dispatch`；`expectedReasonCodes` **必须**含 `orch_shadow_observe`                                                                  |
| `expectedDecisionClass` = `clarify`                              | `dispatchPath` **必须** = `pre_dispatch_rejection`（人闸澄清在 shadow dispatch 之前/之外）；**不要求** `orch_shadow_observe`                                         |
| 任一 `dispatchPath=shadow_dispatch` 行缺少 `orch_shadow_observe` | **FAIL**                                                                                                                                                             |
| reason-code 覆盖分母                                             | **仅** `dispatchPath=shadow_dispatch`（目标 40 = 20 web_read + 20 not_web_read）。`pre_dispatch_rejection` 单独成 cohort/分母，**永不**混入 shadow_dispatch 覆盖分母 |

映射指引（非绑定，逐条核验）：

- `web_read` → 常含 `orch_ladder_web_read`；本切片观察路径叠加 `orch_shadow_observe`
- `not_web_read` → 可用真实 ladder/prefer/human_gate 码；本切片同样叠加 `orch_shadow_observe`（进入 shadow observe 分支）
- `clarify` / `humanGate=yes` → 常含 `orch_human_gate`（或更具体的 `*_human_gate`）；属 `pre_dispatch_rejection`

## 4. 语料门

- 恰好 60 条：`web_read` 20 / `not_web_read` 20 / `clarify` 20
- Profile A 30 / Profile B 30
- 每条必须有 `annotationA` / `annotationB` / `finalLabel`；分歧可见于 A≠B 的 `expectedSurface`
- 分歧由架构 Owner（Thomas Joshua）裁决；Loom Owner `grok-bot` **不是**裁决人
- 模型输出不得充当地面真值
- 来源：`synthetic` 48 / `unit-fixture` 12；**零** `prod-replay`；**零** `sourceDigest` / `sourceEvidenceId` / `redactionMethod`；**无** `.restricted-evidence/`
- `dispatchPath=shadow_dispatch` 且含 `orch_shadow_observe`：**40/40**；`pre_dispatch_rejection`：20

## 5. 确定性与安全

- 同输入重跑，决策相同（replay determinism = 100%）
- **tenant binding echo property PASS；runtime cross-tenant isolation 未测试。**
- 观察关闭时，用户可见结果、工具次数、ledger 与基线一致
- 报告不得声称 C5 / C10 / C11 转为 pass
- `wroteLedger=false`；`invokedTool=false`（Phase B 禁止工具调用；布尔恒 false）

## 6. Prediction vs scored split（B1 独立预测整改）

| 产物                      | 谁产出                                            | 含金标？                                    | Schema                            |
| ------------------------- | ------------------------------------------------- | ------------------------------------------- | --------------------------------- |
| `WebReadShadowPrediction` | 生产 `evaluateWebReadShadow(runtimeInput)`        | **否**（禁止 expected\*/annotationCompare） | `prediction-schema-draft.json`    |
| `ScoredWebReadReport`     | **仅测试** `scoreReport(prediction, frozenLabel)` | 是（对照 JSONL）                            | `scored-report-schema-draft.json` |

- Runtime input：`{ caseId, profile, tenantId, utterance, availableSurfaces? }` — 不得读金标
- 独立预测：通用意图族 + 可选 `qualifyTurn` + `routeStep(shadowOrchestrationFlags)`；禁止 caseId→答案表
- `shadowVsLegacy`：`legacyCompared=false`，`legacySurface=null`，`agree=null`（禁止硬编码 `true`），`explanation` 说明 B1 未对照 legacy
- 澄清且未调用 `routeStep`：`reasonCodes` **不得**含 `orch_shadow_observe`
- 诚实优先：允许 ≤5% false-allow；不以特判语料冲 match

## 7. Calibration vs blind holdout（B1 泛化整改）

| 语料                                  | 路径                                                             | 用途                                                              |
| ------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Calibration corpus**（原 60 JSONL） | `corpus/annotated-cases.jsonl`                                   | **仅**开发/校准；match / false-allow 报为 **calibration metrics** |
| Blind holdout                         | `corpus/blind-holdout-cases.jsonl`（classifier freeze 之后密封） | Phase B 泛化观察；**不得**回写正则后再自称 blind                  |

- Calibration metrics（`calibrationMatchRate` / `calibrationFalseAllowRate` 等）**不是** independent acceptance，也**不是** Phase C generalization evidence。
- 不得把校准集 100% match 表述为独立验收。
- Blind holdout 身份 = **blind holdout / Owner-signed**（architecture-owner:thomas-joshua）；digest `sha256:c12eb16b6ee75c5ac0d0399af489af0dd476dc4b68a539075fc3dc1f2729b586`；revealedAt `2026-09-24T07:06:02+08:00`；classifierFrozenSha `533d3263d2de10b7ed0c1c7530b1e0bc774129ad`。Owner 书面验收见 `corpus/blind-holdout-meta.md` 与 BaselineManifest notes。**不**降级为 post-freeze holdout。

## 8. availableSurfaces 语义（冻结）

| 输入        | 行为                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| `undefined` | 使用 `DEFAULT_WEB_READ_SHADOW_SURFACES = ["web_read","not_web_read","clarify"]`                        |
| `[]`        | **fail-closed**：clarify + `policyGap=true`；不得作为成功 surface select；**无** `orch_shadow_observe` |
| 非空        | 预测面必须 ∈ 列表，否则 clarify + `policyGap=true`                                                     |

## 9. Tenant 结论（诚实表述）

**tenant binding echo property PASS；runtime cross-tenant isolation 未测试。**

本切片仅验证预测对象上的 `tenantId` 原样回显与交错调用无串号；**不**声称已证明运行时跨租户隔离。

— Agent: grok-bot
