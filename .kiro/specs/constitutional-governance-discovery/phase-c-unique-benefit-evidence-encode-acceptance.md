# Phase C — unique-benefit 实际证据收集（编码）书面范围有界接受记录（docs-only）

> 记录 id：`phase_c_unique_benefit_evidence_encode_acceptance`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-c-unique-benefit-evidence-encode-acceptance.md`。  
> 日期：**2026-09-26**（Asia/Shanghai）  
> 对象：Phase C Doc02 §8.2 首条推翻闸门（unique-benefit）的**实际证据收集（编码）书面范围**落地（docs-only）  
> 对照：`final-acceptance.md`（Decision NO-GO / Independent COMPLETE）；`phase-c-unique-benefit-evidence-scope.md`（#81）；`phase-c-unique-benefit-evidence-encode-scope.md`；`alternatives-matrix.md` / `failure-cases.md`  
> 本页是**工程门接受记录**，宽度 = **accepted-for-scope-docs-only**。授权落地「实际证据收集（编码）」的**范围文档三件套**；合并后 **授权**按本范围编码证据包新文件（残差 / 后续 encode PR）；**本 PR 不**入库证据案正文；**不**授权 GO；**不**授权改写冻结包。

## 1. 接受结论

| 项 | 结论 |
| --- | --- |
| 接受对象 | 立一份可引用的 Phase C unique-benefit **实际证据收集（编码）书面范围**包（scope + acceptance + start-order + 最小 xref） |
| 接受宽度 | **accepted-for-scope-docs-only** — 本 PR 仅授权本 docs 刀入库；合并后本 accept + start-order 授权后续证据包编码（新 discovery 文件） |
| 不接受为 | 本 PR 夹带证据案 / 伪证据；把 FC-01..03 重标为 unique-benefit 胜；Material Owner GO 草稿工程；三方重审执行；新 final-acceptance GO；静默改写五份冻结正文；Decision NO-GO→GO；整段 Phase D GO |
| 站桩仍有效 | Phase C **NO-GO**；unique-benefit **仍 FAIL**；Doc02 整段 D **不批准**；C10 **仍不能 pass**；主张天花板 **`code-present`** |

一句话：**接受本范围作为「先解 Phase C NO-GO」路径上、#81 HOW/what counts 之后的下一残差——实际证据收集（编码）书面范围工程门前置；不等于证据已齐，不等于 unique-benefit PASS，不等于本 PR 已编码证据，不等于宣称 GO。**

## 2. 权威与依据

| 项 | 内容 |
| --- | --- |
| 权威 | Owner（via network-of-network） |
| 用户令 | 2026-09-26 选择路径「先解 Phase C NO-GO，再谈整段 D GO」；PR #81 证据收集书面范围已立后，选择「起草 unique-benefit 实际证据收集（编码）书面范围」 |
| 范围 | 本 PR = 书面编码范围三件套；合并后授权证据包新文件编码（残差）；不覆盖新决策包正文或 Doc02 §9 激活 |
| Doc02 | §8.2 首条：≥3 真实失败 + UNIQUE Meta-Schema 收益（相对仅收敛既有预检/编排）；可度量；非口号；非仅字段填充率 |
| 非权威 | Material Owner / 实现 agent **不得**自行把本接受扩成 unique-benefit PASS、或 GO 宣称；**不得**在本 scope PR 夹带伪证据 |

## 3. 与现行 NO-GO 包 / #81 的关系

| 事件 | 含义 |
| --- | --- |
| 现行 `final-acceptance.md` | Decision **NO-GO** / Independent **COMPLETE**；三方 AGREE_NO_GO；权威历史 |
| 五份冻结正文 + digests | **不得**因本接受而改写 |
| FC-01..03 | 已记真实失败，但 unique-benefit **FAIL**；本接受**不**翻案 |
| PR #81 HOW / what counts | 已立「如何收集 / 何谓合格」；明文未授权编码 |
| **本记录** | 补上实际证据收集（编码）的 **engineering-gate accept**（宽度 = scope-docs-only；合并后授权编码残差） |

未经本记录（或等效记名接受），不得把「unique-benefit 实际证据收集（编码）书面范围」写成已过接受门。  
过本记录仍须另有 **开工令**（见 `phase-c-unique-benefit-evidence-encode-start-order.md`）方可落范围正文；两段门不可合并偷渡。  
范围入库后：**编码书面范围已立；unique-benefit 仍 FAIL；NO-GO 仍 COMPLETE；本 PR 未入库证据案；证据包编码属合并后残差（同 start-order）或同接受下的后续 encode PR。**

## 4. 生效后仍禁止

- 宣称 unique-benefit PASS / Decision GO / 「NO-GO 已推翻」/ 「整段 D 已批准」
- 在本 scope PR 入库证据案正文或伪证据
- 把 FC-01 / FC-02 / FC-03 重标或复述为 unique-benefit 胜例
- 改写 `constitutional-governance-phase-c-decision/` 五份冻结正文或其 digests / SHA-256 表
- 静默编辑 `final-acceptance.md` 决策位为 GO
- 本刀内预写预期 GO 或勾选推翻闸门 / 编码合格标准为已通过
- 把 C10 pass / C11 charter / P8b Knife1 / 有界 D #58–#79 当作推翻捷径
- Meta-Schema / constitutional-contracts / Path / Gate / enforce / live invoke / Fabric-on / soft-observe 工程开席
- 在 `src/` / `packages/` 为「推翻证据」编码
- 借用 REVISE 扩范围；抬升主张至 `runtime-enabled` / `production-proven`

## 5. 指针

| 文件 | 角色 |
| --- | --- |
| `phase-c-unique-benefit-evidence-encode-start-order.md` | 本刀开工令（第二门） |
| `phase-c-unique-benefit-evidence-encode-scope.md` | 编码书面范围正文（本刀产物） |
| `phase-c-unique-benefit-evidence-scope.md` | #81 HOW / what counts；本刀仅加 §10 残差后续注 |
| `phase-c-83-product-confirmation.md` | 产品确认；可选最小后续注；NO-GO 锁不变 |
| `constitutional-governance-phase-c-decision/final-acceptance.md` | 现行外部立场权威（NO-GO COMPLETE） |
| `failure-cases.md` / `alternatives-matrix.md` | 冻结历史：FC-01..03 存在但 unique-benefit FAIL |
| 未来 `phase-c-unique-benefit-evidence-pack.md` | 合并后残差：证据包新文件（本 PR 不创建） |
