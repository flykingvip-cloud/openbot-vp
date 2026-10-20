# Phase C — unique-benefit 证据收集开工令（书面范围落地；docs-only）

> 开工令 id：`phase_c_unique_benefit_evidence_start_order_scope`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-c-unique-benefit-evidence-start-order.md`。  
> 日期：**2026-09-26**（Asia/Shanghai）  
> 前置接受：`phase-c-unique-benefit-evidence-acceptance.md`（`phase_c_unique_benefit_evidence_acceptance_scope`）  
> 对照：`final-acceptance.md`；Doc02 §8.2；`phase-c-reopen-overturn-scope.md`；`phase-c-83-product-confirmation.md`  
> 本页是 **unique-benefit 证据收集书面范围第二门开工令**。不是实际证据收集开工，不是 GO，不是改写冻结包，不是整段 Phase D GO。

## 1. 授权一句话

在 unique-benefit 证据收集范围已按 **accepted-for-scope-docs-only** 记名接受的前提下，授权在 discovery 文档落地：**一份 Phase C unique-benefit 证据收集书面范围**（现状、目标、IN/OUT、证据合格标准、与 FC-01..03 关系、包共存、成功标准、残差）；主张天花板 **`code-present`**；**仅**三份本刀文档 + 最小 xref；**不**改 `src/` / `packages/`；**不**授权实际证据收集/编码；**不**宣称 unique-benefit PASS 或 NO-GO→GO。

## 2. 基线

| 项 | 值 |
| --- | --- |
| Base branch | `main` |
| Baseline SHA | `cd24ebfb47e89eb314f87d5e03216b8351d1e333`（#80 merge；Phase C reopen/overturn written scope） |
| 实现 PR | https://github.com/upbeyond/openbot/pull/81 |

## 3. 落点（paths）

| 落点 | 路径 |
| --- | --- |
| 接受记录 | `.kiro/specs/constitutional-governance-discovery/phase-c-unique-benefit-evidence-acceptance.md` |
| 本开工令 | `.kiro/specs/constitutional-governance-discovery/phase-c-unique-benefit-evidence-start-order.md` |
| 书面范围 | `.kiro/specs/constitutional-governance-discovery/phase-c-unique-benefit-evidence-scope.md` |
| 最小 xref | `phase-c-reopen-overturn-scope.md` §9 残差一短注；可选 `phase-c-83-product-confirmation.md` 一短注 |

**不**落点：`constitutional-governance-phase-c-decision/` 五份冻结正文 / digests；实际证据包正文；新 final-acceptance GO；`src/**` / `packages/**`；Meta-Schema / Path / Gate / enforce / live invoke / Fabric-on / soft-observe。

## 4. 主张天花板

- 允许：证据收集范围文档；登记「unique-benefit 证据收集书面范围已立；unique-benefit 仍 FAIL；NO-GO 仍 COMPLETE；实际证据收集未授权」；列出未来证据合格标准（含禁止 FC-01..03 当胜例）
- 禁止：`runtime-enabled` / `production-proven` / 「unique-benefit PASS」/ 「Decision GO」/ 「NO-GO 已推翻」/ 「整段 D GO」/ 「C10 pass」/ 「推翻闸门已满足」/ 入库伪证据

## 5. 回滚

docs-only 回滚：

```bash
# from main after merge, or on the PR branch:
git revert <phase-c-unique-benefit-evidence-docs-landing-commit-sha(s)>
# alternatively delete:
#   phase-c-unique-benefit-evidence-acceptance.md
#   phase-c-unique-benefit-evidence-start-order.md
#   phase-c-unique-benefit-evidence-scope.md
# and restore phase-c-reopen-overturn-scope.md / phase-c-83-product-confirmation.md xref notes
```

无运行时残留；无热路径调用可依赖。

## 6. 测试门

本刀 docs-only。可选人工复核：

```bash
# 范围包应存在；不应出现 src 变更
test -f .kiro/specs/constitutional-governance-discovery/phase-c-unique-benefit-evidence-scope.md
test -f .kiro/specs/constitutional-governance-discovery/phase-c-unique-benefit-evidence-acceptance.md
test -f .kiro/specs/constitutional-governance-discovery/phase-c-unique-benefit-evidence-start-order.md

# 差分应仅限 discovery 文档（本刀）
git diff --name-only origin/main...HEAD | grep -vE '^\.kiro/specs/constitutional-governance-discovery/' && echo FAIL || echo OK

# 不得宣称 PASS / GO（抽样）
! grep -E 'unique-benefit.*PASS|Decision GO|NO-GO 已推翻' \
  .kiro/specs/constitutional-governance-discovery/phase-c-unique-benefit-evidence-*.md
```

## 7. OUT（本开工令不授权）

- 实际证据收集 / 证据包编码 / 把 FC-01..03 重标为 unique-benefit 胜
- 改写五份冻结正文 / digests / 旧 final-acceptance 决策位
- Material Owner GO 草稿工程；三方重审执行
- 预写预期 GO；宣称推翻闸门已过；勾选 unique-benefit FAIL→PASS
- Meta-Schema GO；Path / Gate / enforce / live invoke；Fabric-on；soft-observe 新刀
- 整段 Phase D GO；C10 pass；把 C11 / P8b / 有界 D #58–#79 当翻盘捷径
- 借用 REVISE 扩范围

## 8. 残差（须另文接受 + 开工令）

- **实际** unique-benefit 证据收集与编码（≥3 合格新案；另立证据包文件）
- Material Owner 对新包的 GO 草稿
- Architecture / Security / Execution-chain 对新包的新鲜 AGREE_GO
- 新 final-acceptance Decision GO（含书面有界 D 范围）
- Doc02 §9 激活（仅在独立 C GO 之后）