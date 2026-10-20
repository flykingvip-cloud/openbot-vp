# Phase C — unique-benefit 证据收集书面范围（docs-only 证据范围）

> 范围 id：`phase_c_unique_benefit_evidence_scope`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-c-unique-benefit-evidence-scope.md`。  
> 日期：**2026-09-26**（Asia/Shanghai）  
> 对照：`constitutional-governance-phase-c-decision/final-acceptance.md`（Decision **NO-GO** / Independent **COMPLETE**）；`phase-c-reopen-overturn-scope.md`（过程路径已立）；`alternatives-matrix.md` / `failure-cases.md`（FC-01..03 已记失败但 unique-benefit **FAIL**）；Doc02 §8.2 首条推翻闸门  
> 前置：`phase-c-unique-benefit-evidence-acceptance.md` + `phase-c-unique-benefit-evidence-start-order.md`  
> **状态：本刀 = docs-only 证据收集书面范围**——定义**如何**收集与判定 Doc02 §8.2 首条「unique Meta-Schema 收益」证据；**不**授权实际收集/编码证据；**不**翻转 Decision 为 GO；**不**改写五份冻结正文及其 digests。

## 1. 现状（Current state）

| 项 | 状态 |
| --- | --- |
| Decision | **NO-GO**（外部立场；以 `final-acceptance.md` 为准） |
| Independent acceptance | **COMPLETE** |
| Architecture / Security / Execution-chain | 均为 **AGREE_NO_GO** |
| 重审 / 推翻**过程**书面范围 | 已立（PR #80 / `phase-c-reopen-overturn-*`）；过程路径 ≠ 证据齐备 |
| unique-benefit（Doc02 §8.2 首条） | **FAIL** — 现行包硬原因之一；FC-01..03 已记录真实失败，但相对路径 A–C **无**清晰、不可廉价替代的可度量优势 |
| 本刀主张 | **仅**立「如何收集 / 何谓合格」书面范围；现行仍 FAIL |

Owner 产品确认（`phase-c-83-product-confirmation.md`）与重审过程范围（#80）均锁定：**NO-GO 仍 COMPLETE**。整段 Phase D 在独立 C GO 之前仍 **当前不批准**。

## 2. 目标（Goal）

为 Doc02 **§8.2 首条推翻闸门**立一份可引用的**证据收集书面范围**：规定未来须收集 **≥3** 个真实失败场景，证明 Meta-Schema（或统一契约包）相对「仅收敛既有预检 / 编排」路径 **A–C** 有**独特、可度量**帮助；收益须可复核，禁止空口号，禁止仅以字段填充率充当收益。

本刀只定义 **HOW** 与 **what counts**；**不**在本 PR 产出证据正文，**不**勾选该闸门为已通过，**不**预写预期 GO。

用户路径选择（2026-09-26）：**先解 Phase C NO-GO，再谈整段 D GO** → PR #80 已立过程路径 → 本范围对应下一残差「起草 unique-benefit 证据收集书面范围」。

### 路径 A–C（对照基准；非本刀交付）

| 路径 | 含义（对照 `alternatives-matrix.md` / Doc02 §8.2） |
| --- | --- |
| **A** | 接线既有预检（wire existing preflight） |
| **B** | CTR 关闭前咨询交付 hold（CTR close consults delivery） |
| **C** | 逐入口旁路表闭合（per-entry bypass table → 复用预检 / 显式豁免+break-glass / 删除） |

未来证据必须相对上述 A–C 论证：**为何对本案不足或更昂贵（可度量）**，以及 Meta-Schema / 统一契约有何 **A–C 无法廉价替代** 的独特收益。

## 3. 范围内（IN）— 本刀落地

| 项 | 说明 |
| --- | --- |
| 本书面范围 | 本页：现状 / 目标 / IN / OUT / 证据合格标准 / 与 FC-01..03 关系 / 包共存 / 成功标准 / 主张天花板 / 残差 / 验收提示 |
| 本刀接受记录 | `phase-c-unique-benefit-evidence-acceptance.md`（宽度 = **accepted-for-scope-docs-only**） |
| 本刀开工令 | `phase-c-unique-benefit-evidence-start-order.md` |
| 最小 xref | `phase-c-reopen-overturn-scope.md` §9 残差一短注；可选 `phase-c-83-product-confirmation.md` 一短注 |

## 4. 范围外 / 禁止（OUT）

| 禁止 | 说明 |
| --- | --- |
| 实际证据案写 / 证据包编码 | 须未来独立接受 + 开工令；本刀**不**授权收集或入库证据正文 |
| 改写五份冻结正文 / digests | `failure-cases.md` / `alternatives-matrix.md` / `metrics-and-evidence.md` / `security-profile-review.md` / `decision.md` 及其 SHA-256 表 **不得**静默改写 |
| 把 FC-01..03 重标为 unique-benefit 胜例 | 冻结包已判定其对 D **无**独特不可替代优势；复述旧案当 PASS = **FAIL** |
| 宣称 unique-benefit PASS / Decision GO | 本刀只立收集范围；闸门仍 FAIL |
| Material Owner GO 草稿 / 三方 AGREE_GO / 新 final-acceptance GO | 属推翻后续残差，不在本刀 |
| 静默把 `final-acceptance.md` 改成 GO | 现行 NO-GO 包保持权威历史 |
| Meta-Schema / Path / Gate / enforce / live invoke / Fabric-on / soft-observe | 不借本范围打开 |
| 整段 D GO | 仍不批准，直至独立 C GO |
| `src/` / `packages/` 代码或旗标 | 本刀 docs-only |
| 借用 REVISE 扩范围 | `decision.md` REVISE = 冻结历史 only |

## 5. 证据合格标准（Evidence eligibility）— 给**未来**证据刀的清单；本刀**不**宣称已满足

日后证据包若要支撑 Doc02 §8.2 首条闸门，每个合格案例须**全部**为真：

| 标准 | 要求 |
| --- | --- |
| 真实可复现失败 | 非假想；有可复核的复现路径 / 代码指认 / 基线证据 |
| 相对 A–C 不足或更昂贵 | 对本案明示：仅 A（接线预检）/ B（CTR 咨询交付）/ C（旁路表闭合）为何不足，或可度量地更昂贵 |
| 独特 Meta-Schema / 统一契约收益 | 收益须是 A–C **无法廉价替代** 的帮助（非「多一层文档」口号） |
| 可度量结果 | 审查得见的度量；**禁止**空口号；**禁止**仅以字段填充率充当收益 |
| **不得**计 FC-01..03 为 unique-benefit 胜 | 冻结包已 FAIL 该门；新证据须是**新的、合格的**案例 |
| 数量 | 推翻闸门需要 **≥3** 个彼此可区分的合格案例 |

### Doc02 §8.2 首条闸门上下文（摘录对齐；非本刀勾选）

完整推翻包日后还须满足（本刀**不**勾选）：≥3 真实失败 + UNIQUE Meta-Schema 收益；可度量收益；无第 5 套状态机 / 新日志库；schema 映射到真实代码；Profile A/B 测试；§7.6 阈值或稀有双签例外；BaselineManifest 再冻结；新 Material Owner 建议；三方对新包新鲜 AGREE_GO；新 final-acceptance Decision GO。  
本刀**仅**覆盖其中「unique-benefit 证据**如何收集**」的书面范围；其余仍属后续残差。

本清单是**未来证据刀**的硬门；本刀入库 **不**勾选任一项为已通过，**不**把 unique-benefit 从 FAIL 改为 PASS。

## 6. 与 FC-01..03 的关系

| 事实 | 含义 |
| --- | --- |
| FC-01..03 已记入冻结 `failure-cases.md` | 证明「仅收敛三模块仍留下真实问题」——**真实失败存在** |
| `alternatives-matrix.md` 对三例 D 列 | 均判 **无**相对 A–C 的清晰、不可廉价替代的可度量优势 → unique-benefit **FAIL** |
| 本刀 | **禁止**把 FC-01 / FC-02 / FC-03 重新包装为 unique-benefit 胜例 |
| 未来证据 | 须另找 ≥3 个合格新案（或经独立接受批准的全新论证框架）；不得覆盖改写旧 failure-cases 冒充 |

## 7. 包共存（Package coexistence）

| 规则 | 说明 |
| --- | --- |
| 未来证据包另立文件 | 例如 `phase-c-unique-benefit-evidence-pack.md`，或 discovery / 新 reopen 子目录下版本化文档；**不得**原地覆盖冻结 C 决策正文 |
| 旧 NO-GO 包 digests | 仍为权威历史；`final-acceptance.md` 冻结 SHA-256 表 **不**因本刀或未来证据包而静默改写 |
| 叙事 | 可同时存在「历史 NO-GO COMPLETE + unique-benefit FAIL」与「进行中的证据收集书面范围 / 未来证据包」；只有新 final-acceptance Decision GO 才改变对外决策立场 |

## 8. 本刀成功标准

| 标准 | 判定 |
| --- | --- |
| 文档齐全 | 本范围 + acceptance + start-order 入库；reopen-overturn-scope §9 最小 xref（可选 product-confirmation 一短注） |
| NO-GO 仍 COMPLETE | 叙事锁定 Decision NO-GO / Independent COMPLETE；未宣称翻盘 |
| unique-benefit 仍 FAIL | 明文标出仍 FAIL；未把证据合格标准勾为已满足；未把 FC-01..03 当胜例 |
| 无代码 | diff 仅 discovery 文档（及必要交叉引用） |
| 无 GO 宣称 | 未预写预期 GO；未打开整段 D；未授权实际证据收集编码 |

## 9. 主张天花板

本刀为 **docs-only**。主张天花板：**`code-present`**（文档事实 only）。  
不抬升 `runtime-enabled` / `production-proven`；不宣称 C GO / 整段 D GO / unique-benefit PASS / C10 pass。

## 10. 残差（须另文接受 + 开工令）

- **实际** unique-benefit 证据收集与编码（证据包入库；≥3 合格新案）
  >
  > **后续（2026-09-26）：** 实际证据收集（编码）**书面范围**已另立（`phase-c-unique-benefit-evidence-encode-scope.md` + acceptance + start-order）。入库 **不**把 unique-benefit 标为 PASS，**不**在该 scope PR 入库证据案 / 伪证据，**不**翻转 NO-GO。证据包正文（如 `phase-c-unique-benefit-evidence-pack.md`）仍属该 start-order 合并后残差或同接受下的后续 encode PR。
- Material Owner 对新包的 GO 草稿
- Architecture / Security / Execution-chain 对新包的新鲜 AGREE_GO
- 新 `final-acceptance` Decision GO（含书面有界 D 范围）
- Doc02 §9 激活（仅在独立 C GO 之后）

## 11. 验收提示（给独立验收 bot；本 PR 不呼叫）

**PASS（本刀形态）：**

1. acceptance + start-order + 本范围同 PR 入库；xref 仅最小后续注。  
2. 叙事锁定 NO-GO COMPLETE；未改写五份冻结正文 / digests / 旧 final-acceptance 决策位。  
3. 证据合格标准列为**未来**清单；unique-benefit 标明仍 FAIL；未预写 GO；未把 FC-01..03 标为 unique-benefit 胜。  
4. OUT 未越界：无实际证据案正文；无 Meta-Schema / Path / Gate / enforce / live invoke / Fabric-on / soft-observe / 整段 D GO / `src/`。  
5. 主张天花板仍为 `code-present`；宽度仍为 **accepted-for-scope-docs-only**（不授权收集/编码证据本身）。

**FAIL：** 夹带代码或旗标；把 NO-GO 写成 GO；改写冻结正文；宣称 unique-benefit PASS / 推翻闸门已过；入库伪证据或把 FC-01..03 重标为胜例；或把 C10/C11/P8b/有界 D 当翻盘捷径。