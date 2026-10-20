# Phase C — C11 开工令（倡议章程落地；docs-only）

> 开工令 id：`phase_c_c11_start_order_charter`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-c-c11-start-order.md`。  
> 日期：**2026-09-26**（Asia/Shanghai）  
> 前置接受：`phase-c-c11-written-scope-acceptance.md`（`phase_c_c11_written_scope_acceptance_charter`）  
> 对照：Doc01 §7.1；Doc02 §4 / §8.3；`authority-evidence-baselines.md`  
> 本页是 **C11 倡议章程第二门开工令**。不是 C11 工程实现开工，不是 C11 pass，不是整段 Phase D GO。

## 1. 授权一句话

在 C11 倡议章程已按 **charter-land-only** 记名接受的前提下，授权在 discovery 文档落地：**一份 C11 终结协议倡议章程**（域内权威、显式终态化协议 doc-level 要求、禁跨域单写、与 CTR / ConversationTask / 既有模块关系、非目标）；主张天花板 **`code-present`**；**不**改 `src/` / `packages/`；**不**宣称 C11 pass。

## 2. 基线

| 项 | 值 |
| --- | --- |
| Base branch | `main` |
| Baseline SHA | `8babbd4c90618d6502033f51dace6f32709f812b`（#78 merge；含 D3 accept + start-order + evidence） |
| 实现 PR | https://github.com/upbeyond/openbot/pull/79 |

## 3. 落点（paths）

| 落点 | 路径 |
| --- | --- |
| 接受记录 | `.kiro/specs/constitutional-governance-discovery/phase-c-c11-written-scope-acceptance.md` |
| 本开工令 | `.kiro/specs/constitutional-governance-discovery/phase-c-c11-start-order.md` |
| 倡议章程 | `.kiro/specs/constitutional-governance-discovery/phase-c-c11-finalization-charter.md` |
| stub 指针 | `.kiro/specs/constitutional-governance-discovery/phase-c-83-c11-finalization-initiative.md` |
| 最小 xref | `phase-c-83-product-confirmation.md` §6；`phase-c-83-c10-c11-scope.md`；`phase-c-83-c10-claim-gate-progress.md`；`execution-entry-inventory.md` 文末后记 |

**不**落点：`src/**` / `packages/**` 协议实现；新观察旗标；completion writer；跨账本单点写入；P8b enforce；Meta-Schema 工程包。

## 4. 主张天花板

- 允许：文档章程；引用 Doc01/Doc02 / authority-evidence 的已核定措辞；登记「initiative **chartered**；engineering **not started**」
- 禁止：`runtime-enabled` / `production-proven` / 「C11 pass」/ 「终结协议已实现」/ 「跨域单写权威」/ 「C NO-GO→GO」/ 「D GO」/ 「C10 pass」

## 5. 回滚

docs-only 回滚：

```bash
# from main after merge, or on the PR branch:
git revert <c11-charter-docs-landing-commit-sha(s)>
# alternatively delete:
#   phase-c-c11-written-scope-acceptance.md
#   phase-c-c11-start-order.md
#   phase-c-c11-finalization-charter.md
# and restore stub / product-confirmation §6 / c10-c11-scope / c10-progress / inventory
# to pre-charter (#69 stub) state
```

无运行时残留；无热路径调用可依赖。

## 6. 测试门

本刀 docs-only。可选人工复核：

```bash
# 章程包应存在；不应出现 src 协议实现文件
test -f .kiro/specs/constitutional-governance-discovery/phase-c-c11-finalization-charter.md
test -f .kiro/specs/constitutional-governance-discovery/phase-c-c11-written-scope-acceptance.md
test -f .kiro/specs/constitutional-governance-discovery/phase-c-c11-start-order.md

# 差分应仅限 discovery 文档（本刀）
git diff --name-only origin/main...HEAD | grep -vE '^\.kiro/specs/constitutional-governance-discovery/' && echo FAIL || echo OK
```

## 7. OUT（本开工令不授权）

- C11 工程实现（协议 runtime、消息格式编码、跨域 writer、新包）
- 宣称 C11 pass；勾选任何 C11 完成箱
- Meta-Schema GO；P8b enforce / Gate / live invoke；P8c；Tier H；soft-observe 新刀
- 整段 Phase D GO；C NO-GO 翻盘；C10 pass

## 8. 残差（须另文接受 + 开工令）

- 各域终态写权威的**工程**澄清与测试
- 跨域终态化协议的**可执行**握手 / 咨询形状（超出 doc-level 章程）
- CTR / ConversationTask / ledger 之间的协议接线（若获批）
- 任何把「只读聚合」升格为写者的尝试（默认禁止；须独立书面范围）
