# Phase C — 重审 / 推翻包开工令（书面范围落地；docs-only）

> 开工令 id：`phase_c_reopen_overturn_start_order_scope`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-c-reopen-overturn-start-order.md`。  
> 日期：**2026-09-26**（Asia/Shanghai）  
> 前置接受：`phase-c-reopen-overturn-acceptance.md`（`phase_c_reopen_overturn_acceptance_scope`）  
> 对照：`final-acceptance.md`；Doc02 §8.1–§8.5；`phase-c-83-product-confirmation.md`  
> 本页是 **重审 / 推翻过程书面范围第二门开工令**。不是证据收集开工，不是 GO，不是改写冻结包，不是整段 Phase D GO。

## 1. 授权一句话

在重审 / 推翻过程范围已按 **accepted-for-scope-docs-only** 记名接受的前提下，授权在 discovery 文档落地：**一份 Phase C 重审 / 推翻过程书面范围**（现状、目标、IN/OUT、推翻闸门清单、包共存、成功标准、残差）；主张天花板 **`code-present`**；**仅**三份本刀文档 + product-confirmation 最小 xref；**不**改 `src/` / `packages/`；**不**宣称 NO-GO→GO。

## 2. 基线

| 项 | 值 |
| --- | --- |
| Base branch | `main` |
| Baseline SHA | `55c08622ad139a4f43ea4ca7b6b779fb82ac9910`（#79 merge；C11 finalization charter） |
| 实现 PR | https://github.com/upbeyond/openbot/pull/80 |

## 3. 落点（paths）

| 落点 | 路径 |
| --- | --- |
| 接受记录 | `.kiro/specs/constitutional-governance-discovery/phase-c-reopen-overturn-acceptance.md` |
| 本开工令 | `.kiro/specs/constitutional-governance-discovery/phase-c-reopen-overturn-start-order.md` |
| 书面范围 | `.kiro/specs/constitutional-governance-discovery/phase-c-reopen-overturn-scope.md` |
| 最小 xref | `phase-c-83-product-confirmation.md`（一短注：重审路径已立范围；NO-GO 仍成立） |

**不**落点：`constitutional-governance-phase-c-decision/` 五份冻结正文 / digests；新 final-acceptance GO；`src/**` / `packages/**`；Meta-Schema / Path / Gate / enforce / live invoke / Fabric-on / soft-observe。

## 4. 主张天花板

- 允许：过程范围文档；登记「重审路径书面范围已立；NO-GO 仍 COMPLETE；推翻未发生」；列出未来推翻闸门（含 unique-benefit 仍 FAIL）
- 禁止：`runtime-enabled` / `production-proven` / 「Decision GO」/ 「NO-GO 已推翻」/ 「整段 D GO」/ 「C10 pass」/ 「推翻闸门已满足」

## 5. 回滚

docs-only 回滚：

```bash
# from main after merge, or on the PR branch:
git revert <phase-c-reopen-overturn-docs-landing-commit-sha(s)>
# alternatively delete:
#   phase-c-reopen-overturn-acceptance.md
#   phase-c-reopen-overturn-start-order.md
#   phase-c-reopen-overturn-scope.md
# and restore phase-c-83-product-confirmation.md xref note
```

无运行时残留；无热路径调用可依赖。

## 6. 测试门

本刀 docs-only。可选人工复核：

```bash
# 范围包应存在；不应出现 src 变更
test -f .kiro/specs/constitutional-governance-discovery/phase-c-reopen-overturn-scope.md
test -f .kiro/specs/constitutional-governance-discovery/phase-c-reopen-overturn-acceptance.md
test -f .kiro/specs/constitutional-governance-discovery/phase-c-reopen-overturn-start-order.md

# 差分应仅限 discovery 文档（本刀）
git diff --name-only origin/main...HEAD | grep -vE '^\.kiro/specs/constitutional-governance-discovery/' && echo FAIL || echo OK
```

## 7. OUT（本开工令不授权）

- 改写五份冻结正文 / digests / 旧 final-acceptance 决策位
- 证据收集编码；Material Owner GO 草稿工程；三方重审执行
- 预写预期 GO；宣称推翻闸门已过；勾选 unique-benefit 已 FAIL→PASS
- Meta-Schema GO；Path / Gate / enforce / live invoke；Fabric-on；soft-observe 新刀
- 整段 Phase D GO；C10 pass；把 C11 / P8b / 有界 D #58–#79 当翻盘捷径
- 借用 REVISE 扩范围

## 8. 残差（须另文接受 + 开工令）

- unique-benefit 证据收集（Doc02 §8.2）
- Material Owner 对新包的 GO 草稿
- Architecture / Security / Execution-chain 对新包的新鲜 AGREE_GO
- 新 final-acceptance Decision GO（含书面有界 D 范围）
- Doc02 §9 激活（仅在独立 C GO 之后）
