# Phase C — 重审 / 推翻包书面范围（docs-only 过程范围）

> 范围 id：`phase_c_reopen_overturn_scope`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-c-reopen-overturn-scope.md`。  
> 日期：**2026-09-26**（Asia/Shanghai）  
> 对照：`constitutional-governance-phase-c-decision/final-acceptance.md`（Decision **NO-GO** / Independent **COMPLETE**）；`phase-c-83-product-confirmation.md`（产品侧锁定）；Doc02 §8.1–§8.5；Architecture / Security / Execution-chain **AGREE_NO_GO**  
> 前置：`phase-c-reopen-overturn-acceptance.md` + `phase-c-reopen-overturn-start-order.md`  
> **状态：本刀 = docs-only 过程书面范围**——定义 Phase C 在 NO-GO COMPLETE 之后如何**合法重开 / 推翻**；**不**翻转 Decision 为 GO；**不**改写五份冻结正文及其 digests。

## 1. 现状（Current state）

| 项 | 状态 |
| --- | --- |
| Decision | **NO-GO**（外部立场；以 `final-acceptance.md` 为准） |
| Independent acceptance | **COMPLETE** |
| Architecture / Security / Execution-chain | 均为 **AGREE_NO_GO** |
| Open conditions | **none**（就现行包而言） |
| `decision.md` 中 REVISE | **冻结历史 only**；不得当作现行「可翻 GO」授权 |
| unique-benefit（Doc02 §8.2） | **FAIL** — 这是现行包 NO-GO 的硬原因之一；本刀**不**声称已补齐 |

Owner 产品确认（`phase-c-83-product-confirmation.md`）已锁定上述立场；运营路径仍为 Doc02 **§8.3**。整段 Phase D 在独立 C GO 之前仍 **当前不批准**。

## 2. 目标（Goal）

定义一条**合法路径**，用以日后产出一份**新的** Phase C 决策包，该包若且仅若通过 Doc02 §8.2 等推翻闸门，才可能把现行 **NO-GO → 独立 GO**。

独立 C GO 是 Doc02 **整段 Phase D** 的前置条件。本刀只立**过程书面范围**；**不**在本 PR 预写或宣称该 GO。

用户路径选择（2026-09-26）：**先解 Phase C NO-GO，再谈整段 D GO** → 本范围对应「起草推翻包书面范围」。

## 3. 范围内（IN）— 本刀落地

| 项 | 说明 |
| --- | --- |
| 本书面范围 | 本页：现状 / 目标 / IN / OUT / 推翻闸门 / 包共存 / 成功标准 / 主张天花板 / 残差 / 验收提示 |
| 本刀接受记录 | `phase-c-reopen-overturn-acceptance.md`（宽度 = accepted-for-scope-docs-only） |
| 本刀开工令 | `phase-c-reopen-overturn-start-order.md` |
| 最小 xref | `phase-c-83-product-confirmation.md` 一短注：重审路径已立书面范围；**NO-GO 仍成立** |

## 4. 范围外 / 禁止（OUT）

| 禁止 | 说明 |
| --- | --- |
| 改写五份冻结正文 / digests | `failure-cases.md` / `alternatives-matrix.md` / `metrics-and-evidence.md` / `security-profile-review.md` / `decision.md` 及其 SHA-256 表 **不得**静默改写 |
| 静默把 `final-acceptance.md` 改成 GO | 现行 NO-GO 包保持权威历史；翻盘须**新包 + 新 final-acceptance** |
| 本 PR 预写预期 GO / 宣称 GO | 本刀只立过程范围，不产出推翻结论 |
| 捷径冒充推翻 | C10 pass、C11 charter、P8b Knife1、有界 D #58–#79 **均不是**推翻 NO-GO 的捷径 |
| Meta-Schema / constitutional-contracts / Path / Gate / enforce / live invoke / Fabric-on / soft-observe | 不借本范围打开 |
| 整段 D GO | 仍不批准，直至独立 C GO |
| `src/` / packages 代码或旗标 | 本刀 docs-only |
| 借用 REVISE 扩范围 | `decision.md` REVISE = 冻结历史 only |

## 5. 推翻闸门（Overturn gates）— 给**未来**新包的清单；本刀**不**宣称已满足

日后新决策包若要推翻 NO-GO → 独立 GO，须**全部**为真（对照 Doc02 §8.2 等）：

| 闸门 | 要求 |
| --- | --- |
| ≥3 真实失败 + UNIQUE Meta-Schema 收益 | 相对路径 A–C，有可指认的独特收益（现行包此处 **FAIL**） |
| 可度量收益 | 收益可测，非叙事口号 |
| 无第 5 套状态机 / 新日志库 | 不得借翻盘引入新状态机或新 log store |
| schema 映射到真实代码 | 映射可审计，非空挂 |
| Profile A/B 测试 | 按规定覆盖 |
| §7.6 阈值或稀有双签例外 | 满足阈值门槛，或经稀有双签例外书面批准 |
| BaselineManifest 再冻结 | 新包基线须再冻结 |
| 新 Material Owner 建议 | 对新包给出明确建议（非沿用旧草稿冒充） |
| 三方对新包 AGREE_GO | Architecture / Security / Execution-chain 对**新包**新鲜 AGREE_GO |
| 新 final-acceptance Decision GO | 含书面有界 D 范围；**不得**改写旧 NO-GO 文件冒充 |

本清单是**未来推翻包**的硬门；本刀入库 **不**勾选任一项为已通过。

## 6. 包共存（Package coexistence）

| 规则 | 说明 |
| --- | --- |
| 新包另立文件 | 例如新子目录 `constitutional-governance-phase-c-reopen/`，或 discovery 下清晰版本化文档；**不得**原地覆盖旧包 |
| 旧 NO-GO 包 digests | 仍为权威历史；`final-acceptance.md` 冻结 SHA-256 表 **不**因本刀或未来新包而静默改写 |
| 叙事 | 可同时存在「历史 NO-GO COMPLETE」与「进行中的重审包」；只有新 final-acceptance Decision GO 才改变对外决策立场 |

## 7. 本刀成功标准

| 标准 | 判定 |
| --- | --- |
| 文档齐全 | 本范围 + acceptance + start-order 入库；product-confirmation 最小 xref |
| NO-GO 仍 COMPLETE | 叙事锁定 Decision NO-GO / Independent COMPLETE；未宣称翻盘 |
| unique-benefit 硬门 | 明文标出 unique-benefit 为推翻硬门；现行仍 FAIL，直至未来证据 |
| 无代码 | diff 仅 discovery 文档（及必要一行交叉引用） |
| 无 GO 宣称 | 未预写预期 GO；未打开整段 D |

## 8. 主张天花板

本刀为 **docs-only**。主张天花板：**`code-present`**（文档事实 only）。  
不抬升 `runtime-enabled` / `production-proven`；不宣称 C GO / 整段 D GO / C10 pass。

## 9. 残差（须另文接受 + 开工令）

- unique-benefit 证据收集（对照 Doc02 §8.2）
  - **后续（2026-09-26）：** unique-benefit 证据收集**书面范围**已另立（`phase-c-unique-benefit-evidence-scope.md` + `phase-c-unique-benefit-evidence-acceptance.md` + `phase-c-unique-benefit-evidence-start-order.md`）。入库仅定义 HOW / what counts；**仍 FAIL** 直至未来证据包；**不**授权实际收集/编码；NO-GO 仍 COMPLETE。
- Material Owner 对新包的 GO 草稿
- 三方对新包的重审（Architecture / Security / Execution-chain）
- 新 `final-acceptance` Decision GO（含书面有界 D 范围）
- Doc02 §9 激活（仅在独立 C GO 之后）

## 10. 验收提示（给独立验收 bot；本 PR 不呼叫）

**PASS（本刀形态）：**

1. acceptance + start-order + 本范围同 PR 入库；product-confirmation 仅最小 xref。  
2. 叙事锁定 NO-GO COMPLETE；未改写五份冻结正文 / digests / 旧 final-acceptance 决策位。  
3. 推翻闸门列为**未来**清单；unique-benefit 标明仍 FAIL；未预写 GO。  
4. OUT 未越界：无 Meta-Schema / Path / Gate / enforce / live invoke / Fabric-on / soft-observe / 整段 D GO / `src/`。  
5. 主张天花板仍为 `code-present`。

**FAIL：** 夹带代码或旗标；把 NO-GO 写成 GO；改写冻结正文；宣称推翻闸门已过；或把 C10/C11/P8b/有界 D 当翻盘捷径。