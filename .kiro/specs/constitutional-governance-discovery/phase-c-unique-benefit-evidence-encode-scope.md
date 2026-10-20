# Phase C — unique-benefit 实际证据收集（编码）书面范围（docs-only 编码范围）

> 范围 id：`phase_c_unique_benefit_evidence_encode_scope`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-c-unique-benefit-evidence-encode-scope.md`。  
> 日期：**2026-09-26**（Asia/Shanghai）  
> 对照：`constitutional-governance-phase-c-decision/final-acceptance.md`（Decision **NO-GO** / Independent **COMPLETE**）；`phase-c-unique-benefit-evidence-scope.md`（#81 HOW / what counts 已立；unique-benefit **仍 FAIL**）；`alternatives-matrix.md` / `failure-cases.md`（FC-01..03 已记失败但 unique gate **FAIL**）；Doc02 §8.2 首条推翻闸门  
> 前置：`phase-c-unique-benefit-evidence-encode-acceptance.md` + `phase-c-unique-benefit-evidence-encode-start-order.md`  
> **状态：本刀 = docs-only 实际证据收集（编码）书面范围**——定义并授权日后在 discovery 下**新立**证据包 markdown（≥3 合格新案）；**本 PR 不入库任何证据案正文**；**不**宣称 unique-benefit PASS / Decision GO；**不**改写五份冻结正文及其 digests。

## 1. 现状（Current state）

| 项 | 状态 |
| --- | --- |
| Decision | **NO-GO**（外部立场；以 `final-acceptance.md` 为准） |
| Independent acceptance | **COMPLETE** |
| Architecture / Security / Execution-chain | 均为 **AGREE_NO_GO** |
| #81 unique-benefit 证据收集书面范围 | 已立（`phase-c-unique-benefit-evidence-*`）；定义 **HOW / what counts**；**仍未**授权编码证据包 |
| unique-benefit（Doc02 §8.2 首条） | **FAIL** — 现行包硬原因之一；FC-01..03 已记录真实失败，但相对路径 A–C **无**清晰、不可廉价替代的可度量优势 |
| 本刀主张 | **仅**立「实际证据收集（编码）」书面范围 + accept + start-order；现行仍 FAIL；本 PR **不含**伪/实证据案 |

Owner 产品确认（`phase-c-83-product-confirmation.md`）、重审过程范围（#80）与 #81 证据收集范围均锁定：**NO-GO 仍 COMPLETE**；**unique-benefit 仍 FAIL**。整段 Phase D 在独立 C GO 之前仍 **当前不批准**。

## 2. 目标（Goal）

为 Doc02 **§8.2 首条推翻闸门**立一份可引用的**实际证据收集（编码）书面范围**：在 #81 已立的合格标准之上，授权日后在 discovery 下**另立新文件**写入证据包（例如 `phase-c-unique-benefit-evidence-pack.md`），收录 **≥3** 个彼此可区分的**新**案例，证明 Meta-Schema（或统一契约包）相对路径 **A–C** 有**独特、可度量**帮助；收益须可复核，禁止空口号，禁止仅以字段填充率充当收益。

本刀只定义 **编码授权边界** 与 **未来证据包落点**；**不**在本 PR 产出证据正文，**不**勾选该闸门为已通过，**不**预写预期 GO。

用户路径选择（2026-09-26）：**先解 Phase C NO-GO，再谈整段 D GO** → PR #80 过程路径 → PR #81 HOW/what counts → 本范围对应下一残差「起草 unique-benefit 实际证据收集（编码）书面范围」。

### 路径 A–C（对照基准；非本刀交付）

| 路径 | 含义（对照 `alternatives-matrix.md` / Doc02 §8.2 / #81） |
| --- | --- |
| **A** | 接线既有预检（wire existing preflight） |
| **B** | CTR 关闭前咨询交付 hold（CTR close consults delivery） |
| **C** | 逐入口旁路表闭合（per-entry bypass table → 复用预检 / 显式豁免+break-glass / 删除） |

未来证据包中每个合格案例必须相对上述 A–C 论证：**为何对本案不足或更昂贵（可度量）**，以及 Meta-Schema / 统一契约有何 **A–C 无法廉价替代** 的独特收益。

### 与 #81 的区分（硬）

| 刀 | 角色 |
| --- | --- |
| #81 `phase-c-unique-benefit-evidence-*` | **HOW / what counts**（过程与合格标准）；明文 **不**授权实际收集/编码 |
| **本刀** `phase-c-unique-benefit-evidence-encode-*` | **编码授权书面范围**：接受 + 开工令授权日后按本范围编码证据包新文件；本 PR 仍只落三份范围文档 + 最小 xref |

## 3. 范围内（IN）— 本刀落地

| 项 | 说明 |
| --- | --- |
| 本书面范围 | 本页：现状 / 目标 / IN / OUT / 编码合格标准 / 未来证据包落点 / 与 FC-01..03 关系 / 包共存 / 成功标准 / 主张天花板 / 残差 / 验收提示 |
| 本刀接受记录 | `phase-c-unique-benefit-evidence-encode-acceptance.md`（宽度 = **accepted-for-scope-docs-only**） |
| 本刀开工令 | `phase-c-unique-benefit-evidence-encode-start-order.md` |
| 最小 xref | `phase-c-unique-benefit-evidence-scope.md` §10 残差一短注；可选 `phase-c-83-product-confirmation.md` §1 一短注 |
| **授权（合并后残差）** | 本 accept + start-order **授权**后续在 discovery 下编码证据包新文件（见 §5 / §7 / §10）；**不**要求本 PR 同批入库证据案 |

## 4. 范围外 / 禁止（OUT）

| 禁止 | 说明 |
| --- | --- |
| 本 PR 入库证据案正文 / 伪证据 | 本刀**仅**三份范围文档 + xref；证据案属合并后残差或后续 encode PR |
| 宣称 unique-benefit PASS / Decision GO / C GO | 本刀只立编码范围；闸门仍 FAIL；NO-GO 仍 COMPLETE |
| 改写五份冻结正文 / digests | `failure-cases.md` / `alternatives-matrix.md` / `metrics-and-evidence.md` / `security-profile-review.md` / `decision.md` 及其 SHA-256 表 **不得**静默改写 |
| 把 FC-01..03 重标为 unique-benefit 胜例 | 冻结包已判定其对 D **无**独特不可替代优势；复述旧案当 PASS = **FAIL** |
| Material Owner GO 草稿 / 三方 AGREE_GO / 新 final-acceptance GO | 属推翻后续残差，不在本刀 |
| 静默把 `final-acceptance.md` 改成 GO | 现行 NO-GO 包保持权威历史 |
| Meta-Schema / Path / Gate / enforce / live invoke / Fabric-on / soft-observe | 不借本范围打开 |
| 整段 D GO | 仍不批准，直至独立 C GO |
| `src/` / `packages/` 代码或旗标 | 本刀 docs-only |
| 借用 REVISE 扩范围 | `decision.md` REVISE = 冻结历史 only |

## 5. 编码合格标准（Encode eligibility）— 给**未来**证据包的清单；本刀**不**宣称已满足

日后证据包若要支撑 Doc02 §8.2 首条闸门，每个合格案例须**全部**为真（与 #81 §5 对齐并作为编码硬门）：

| 标准 | 要求 |
| --- | --- |
| 真实可复现失败 | 非假想；有可复核的复现路径 / 代码指认 / 基线证据 |
| 相对 A–C 不足或更昂贵 | 对本案明示：仅 A（接线预检）/ B（CTR 咨询交付）/ C（旁路表闭合）为何不足，或可度量地更昂贵 |
| 独特 Meta-Schema / 统一契约收益 | 收益须是 A–C **无法廉价替代** 的帮助（非「多一层文档」口号） |
| 可度量结果 | 审查得见的度量；**禁止**空口号；**禁止**仅以字段填充率充当收益 |
| **不得**计 FC-01..03 为 unique-benefit 胜 | 冻结包已 FAIL 该门；新证据须是**新的、合格的**案例 |
| 数量 | 推翻闸门需要 **≥3** 个彼此可区分的合格案例 |

### 未来证据包落点（本刀定义；本 PR 不创建）

| 落点（示例） | 说明 |
| --- | --- |
| `.kiro/specs/constitutional-governance-discovery/phase-c-unique-benefit-evidence-pack.md` | 首选：单文件证据包（或同目录版本化变体） |
| 可选：discovery 下子目录 / 另立版本化文档 | **不得**原地覆盖冻结 C 决策正文 |

证据包编码须在本刀 **accept + start-order** 合并生效后执行（同 start-order 残差执行，或同接受宽度下的后续 encode PR）。**本 PR 禁止**夹带任何案例正文或伪证据。

### Doc02 §8.2 首条闸门上下文（摘录对齐；非本刀勾选）

完整推翻包日后还须满足（本刀**不**勾选）：≥3 真实失败 + UNIQUE Meta-Schema 收益；可度量收益；无第 5 套状态机 / 新日志库；schema 映射到真实代码；Profile A/B 测试；§7.6 阈值或稀有双签例外；BaselineManifest 再冻结；新 Material Owner 建议；三方对新包新鲜 AGREE_GO；新 final-acceptance Decision GO。  
本刀**仅**覆盖其中「unique-benefit 证据**如何编码入库**」的书面范围与授权门；证据正文与其余推翻残差仍属后续。

本清单是**未来证据包编码**的硬门；本刀入库 **不**勾选任一项为已通过，**不**把 unique-benefit 从 FAIL 改为 PASS。

## 6. 与 FC-01..03 的关系

| 事实 | 含义 |
| --- | --- |
| FC-01..03 已记入冻结 `failure-cases.md` | 证明「仅收敛三模块仍留下真实问题」——**真实失败存在** |
| `alternatives-matrix.md` 对三例 D 列 | 均判 **无**相对 A–C 的清晰、不可廉价替代的可度量优势 → unique-benefit **FAIL** |
| #81 | 已禁止把 FC-01..03 重标为 unique-benefit 胜例 |
| 本刀 | **再次禁止**把 FC-01 / FC-02 / FC-03 重新包装为 unique-benefit 胜例写入证据包 |
| 未来证据包 | 须另找 ≥3 个合格新案（或经独立接受批准的全新论证框架）；不得覆盖改写旧 failure-cases 冒充 |

## 7. 包共存（Package coexistence）

| 规则 | 说明 |
| --- | --- |
| 证据包另立文件 | 例如 `phase-c-unique-benefit-evidence-pack.md`；**不得**原地覆盖冻结 C 决策正文 |
| 旧 NO-GO 包 digests | 仍为权威历史；`final-acceptance.md` 冻结 SHA-256 表 **不**因本刀或未来证据包而静默改写 |
| #81 范围包 | 继续有效（HOW / what counts）；本刀叠加编码授权，不替代 #81 |
| 叙事 | 可同时存在「历史 NO-GO COMPLETE + unique-benefit FAIL」与「进行中的编码书面范围 / 未来证据包」；只有新 final-acceptance Decision GO 才改变对外决策立场 |

## 8. 本刀成功标准

| 标准 | 判定 |
| --- | --- |
| 文档齐全 | 本范围 + acceptance + start-order 入库；unique-benefit-evidence-scope §10 最小 xref（可选 product-confirmation 一短注） |
| NO-GO 仍 COMPLETE | 叙事锁定 Decision NO-GO / Independent COMPLETE；未宣称翻盘 |
| unique-benefit 仍 FAIL | 明文标出仍 FAIL；未把编码合格标准勾为已满足；未把 FC-01..03 当胜例；**本 PR 无证据案正文** |
| 无代码 | diff 仅 discovery 文档（及必要交叉引用） |
| 无 GO 宣称 | 未预写预期 GO；未打开整段 D；未在本 PR 伪造成功证据 |

## 9. 主张天花板

本刀为 **docs-only**。主张天花板：**`code-present`**（文档事实 only）。  
不抬升 `runtime-enabled` / `production-proven`；不宣称 C GO / 整段 D GO / unique-benefit PASS / C10 pass。

## 10. 残差（证据包编码在本 start-order 下执行；其余须另文）

- **证据包 encode**（在本刀 accept + start-order 合并后）：于 discovery 下新立 `phase-c-unique-benefit-evidence-pack.md`（或等效），写入 ≥3 合格新案；可作为同 start-order 残差执行，或同接受宽度下的后续 encode PR——**禁止**本范围 PR 夹带伪证据
  >
  > **后续（2026-09-26）：** 证据包已另立编码（`phase-c-unique-benefit-evidence-pack.md`）。候选清单：**UNIQUE=0 / WEAK=3 / NON-UNIQUE=1**；**unique-benefit 仍 FAIL**；**不**宣称 PASS / Decision GO / C GO；NO-GO COMPLETE 仍站桩；未改写冻结 C 正文。
- Material Owner 对新包的 GO 草稿
- Architecture / Security / Execution-chain 对新包的新鲜 AGREE_GO
- 新 `final-acceptance` Decision GO（含书面有界 D 范围）
- Doc02 §9 激活（仅在独立 C GO 之后）

## 11. 验收提示（给独立验收 bot；本 PR 不呼叫）

**PASS（本刀形态）：**

1. acceptance + start-order + 本范围同 PR 入库；xref 仅最小后续注。  
2. 叙事锁定 NO-GO COMPLETE；未改写五份冻结正文 / digests / 旧 final-acceptance 决策位。  
3. 编码合格标准列为**未来**清单；unique-benefit 标明仍 FAIL；未预写 GO；未把 FC-01..03 标为 unique-benefit 胜；**本 PR 无证据案 / 伪证据正文**。  
4. OUT 未越界：无 Meta-Schema / Path / Gate / enforce / live invoke / Fabric-on / soft-observe / 整段 D GO / `src/`。  
5. 主张天花板仍为 `code-present`；宽度仍为 **accepted-for-scope-docs-only**（本 PR 只落范围三件套；编码授权指向合并后残差 / 后续 encode PR）。

**FAIL：** 夹带代码或旗标；把 NO-GO 写成 GO；改写冻结正文；宣称 unique-benefit PASS / 推翻闸门已过；本 PR 入库伪证据或把 FC-01..03 重标为胜例；或把 C10/C11/P8b/有界 D 当翻盘捷径。
