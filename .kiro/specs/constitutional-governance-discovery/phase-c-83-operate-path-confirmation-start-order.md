# Phase C — Doc02 §8.3 运营路径确认纪要开工令（书面范围落地；docs-only）

> 开工令 id：`phase_c_83_operate_path_confirmation_start_order_scope`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-c-83-operate-path-confirmation-start-order.md`。  
> 日期：**2026-09-26**（Asia/Shanghai）  
> 前置接受：`phase-c-83-operate-path-confirmation-acceptance.md`（`phase_c_83_operate_path_confirmation_acceptance_scope`）  
> 对照：`final-acceptance.md`；Doc02 §8.1–§8.5；`phase-c-83-product-confirmation.md`；`phase-c-unique-benefit-evidence-pack.md`（#83/#84；UNIQUE=0）  
> 本页是 **§8.3 运营路径确认纪要第二门开工令**。不是 Meta-Schema 工程开工，不是 dig 重开，不是 GO，不是改写冻结包，不是整段 Phase D GO。

## 1. 授权一句话

在 §8.3 运营路径确认纪要范围已按 **accepted-for-scope-docs-only** 记名接受的前提下，授权在 discovery 文档落地：**一份确认纪要**（现状、目标、IN/OUT、§8.3 做与不做、与 #80–#84 关系、包共存、成功标准、残差）；主张天花板 **`code-present`**；**仅**三份本刀文档 + product-confirmation 最小 xref（可选 pack §7 一行）；**不**改 `src/` / `packages/`；**不**宣称 unique-benefit PASS / NO-GO→GO / C GO / 整段 D GO；**不**授权 Meta-Schema 工程化。

## 2. 基线

| 项 | 值 |
| --- | --- |
| Base branch | `main` |
| Baseline SHA | `09bb286e2eae0b7ef84ca54f0d2c17e89da9aed7`（#84 merge；unique-benefit dig §9 still FAIL；UNIQUE=0） |
| 实现 PR | https://github.com/upbeyond/openbot/pull/85 |

## 3. 落点（paths）

| 落点 | 路径 |
| --- | --- |
| 接受记录 | `.kiro/specs/constitutional-governance-discovery/phase-c-83-operate-path-confirmation-acceptance.md` |
| 本开工令 | `.kiro/specs/constitutional-governance-discovery/phase-c-83-operate-path-confirmation-start-order.md` |
| 书面范围 | `.kiro/specs/constitutional-governance-discovery/phase-c-83-operate-path-confirmation-scope.md` |
| 最小 xref | `phase-c-83-product-confirmation.md`（§1 一短注：#84 dig 链后接受 §8.3 / 停 Meta-Schema 工程化；NO-GO 仍 COMPLETE；unique-benefit 仍 FAIL） |
| 可选残差注 | `phase-c-unique-benefit-evidence-pack.md` §7 一行：停止重复 dig；§8.3 路径已选 |

**不**落点：`constitutional-governance-phase-c-decision/` 五份冻结正文 / digests；新 final-acceptance GO；`src/**` / `packages/**`；Meta-Schema / Path / Gate / enforce / live invoke / Fabric-on / soft-observe 工程；unique-benefit dig 重开；A/B/C 工程实现（须另文）。

## 4. 主张天花板

- 允许：确认纪要文档；登记「Owner 已选 §8.3 运营路径；停 Meta-Schema 工程化；NO-GO 仍 COMPLETE；unique-benefit 仍 FAIL；本合入 ≠ PASS/GO」
- 禁止：`runtime-enabled` / `production-proven` / 「Decision GO」/ 「unique-benefit PASS」/ 「C GO」/ 「整段 D GO」/ 「C10 pass」/ 「UNIQUE≥1」/ Meta-Schema 工程开席宣称

## 5. 回滚

docs-only 回滚：

```bash
# from main after merge, or on the PR branch:
git revert <phase-c-83-operate-path-confirmation-docs-landing-commit-sha(s)>
# alternatively delete:
#   phase-c-83-operate-path-confirmation-acceptance.md
#   phase-c-83-operate-path-confirmation-start-order.md
#   phase-c-83-operate-path-confirmation-scope.md
# and restore phase-c-83-product-confirmation.md xref note
# (and optional pack §7 one-liner)
```

无运行时残留；无热路径调用可依赖。

## 6. 测试门

本刀 docs-only。可选人工复核：

```bash
# 范围包应存在；不应出现 src 变更
test -f .kiro/specs/constitutional-governance-discovery/phase-c-83-operate-path-confirmation-scope.md
test -f .kiro/specs/constitutional-governance-discovery/phase-c-83-operate-path-confirmation-acceptance.md
test -f .kiro/specs/constitutional-governance-discovery/phase-c-83-operate-path-confirmation-start-order.md

# 差分应仅限 discovery 文档（本刀）
git diff --name-only origin/main...HEAD | grep -vE '^\.kiro/specs/constitutional-governance-discovery/' && echo FAIL || echo OK
```

## 7. OUT（本开工令不授权）

- 改写五份冻结正文 / digests / 旧 final-acceptance 决策位
- Meta-Schema / constitutional-contracts / 四产品 **工程**开席
- unique-benefit dig 重开；宣称 unique-benefit PASS / 伪造 UNIQUE
- Path / Gate / enforce / live invoke；Fabric-on；soft-observe 新刀
- C GO；整段 Phase D GO；C10 pass
- A/B/C 工程实现编码（须另文接受 + 开工令）
- 启动 #80 推翻包编码 / 三方重审 / 新 final-acceptance GO
- 借用 REVISE 扩范围；把已闭合刀 #58–#84 重列为下一刀

## 8. 残差（须另文接受 + 开工令）

- A = wire existing preflight（另开）
- B = CTR close consults delivery（另开）
- C = per-entry bypass table closure（另开）
- 未来若 ≥3 真 UNIQUE：走 #80 合法推翻路径（新包）；本开工令**不**启动
- Doc02 §9 激活（仅在独立 C GO 之后）
