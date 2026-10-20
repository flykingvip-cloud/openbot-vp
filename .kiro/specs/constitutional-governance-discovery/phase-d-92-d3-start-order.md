# Phase D §9.2 D3 — 开工令（部署耦合证据刀）

> 开工令 id：`phase_d_92_d3_start_order`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-d-92-d3-start-order.md`。  
> 日期：**2026-09-26**（Asia/Shanghai）  
> 前置接受：`phase-d-92-written-scope-acceptance.md`（`phase_d_92_written_scope_acceptance_d3`）  
> 父范围：`phase-d-92-product-split-written-scope.md`（`accepted-for-d3-only`）  
> 本页是 **D3 第二门开工令**。不是整段 §9.2 开工，不是整段 Phase D GO，不是自动发版。

## 1. 授权一句话

在父书面范围已按 **D3-only** 记名接受的前提下，授权在 discovery 文档落地：**一份 D3 部署耦合证据页**（允许「禁止单独部署 / 无热路径耦合」的否定证明）；主张天花板 **`code-present`**；**不**勾选 proof-plan 证明箱；**不**改代码、旗标或热路径。

## 2. 基线

| 项 | 值 |
| --- | --- |
| Base branch | `main` |
| Baseline SHA | `7adf7999d3b63df43bf96f104a0d08437651b895`（#77 merge；含 P8b Knife1 gates） |
| 实现 PR | https://github.com/upbeyond/openbot/pull/78 |

## 3. 落点（paths）

| 落点 | 路径 |
| --- | --- |
| 接受记录 | `.kiro/specs/constitutional-governance-discovery/phase-d-92-written-scope-acceptance.md` |
| 本开工令 | `.kiro/specs/constitutional-governance-discovery/phase-d-92-d3-start-order.md` |
| 证据页 | `.kiro/specs/constitutional-governance-discovery/phase-d-92-d3-deploy-coupling-evidence.md` |
| 父范围状态 | `.kiro/specs/constitutional-governance-discovery/phase-d-92-product-split-written-scope.md`（`accepted-for-d3-only`） |
| 清单指针 | `.kiro/specs/constitutional-governance-discovery/phase-d-product-split-proof-plan.md`（D3 部分进度注；**☐ 仍开**） |

**不**落点：`packages/**` 代码改动；gateway / Pi / ACP / AOR / dispatch / gateway-hook；CI / 部署作业；P8b enforce。

## 4. 主张天花板

- 允许：文档事实；基于仓库现存包元数据 / 边界常量 / 导入扫描的 **否定证明**（无热路径 import；无独立部署作业；当前形状禁止单独部署叙事）
- 禁止：`runtime-enabled` / `production-proven` / 「产品已拆」/ 「§9.2 已批准」/ 「D GO」/ 「D3 已证明（已勾选）」
- `*SCAFFOLD_BOUNDARY.deployBoundaryProven` 保持 **`false`**（本刀不改代码常量）

## 5. 回滚

docs-only 回滚：

```bash
# from main after merge, or on the PR branch:
git revert <d3-docs-landing-commit-sha(s)>
# alternatively delete:
#   phase-d-92-written-scope-acceptance.md
#   phase-d-92-d3-start-order.md
#   phase-d-92-d3-deploy-coupling-evidence.md
# and restore written-scope / proof-plan headers to pre-D3 draft state
```

无运行时残留；无热路径调用可依赖。

## 6. 测试门

本刀 docs-only。可选人工复核：

```bash
# 应无包外消费者（discovery 叙述除外）
grep -RIn --exclude-dir=node_modules --exclude-dir=dist \
  -e '@openbot/constitutional-registry' \
  -e '@openbot/constitutional-conformance' \
  -e '@openbot/constitutional-runtime' . \
  | grep -vE '/packages/constitutional-(registry|conformance|runtime)/' \
  | grep -vE 'phase-d-product-split|phase-d-92'

# 热路径目录应无命中（注意排除同名本地 façade 文件名噪声）
grep -RIn --exclude-dir=node_modules \
  -e 'constitutional-registry' -e 'constitutional-conformance' \
  -e '@openbot/constitutional-runtime' \
  src/gateway src/agents src/task-orchestration 2>/dev/null || true
```

## 7. OUT（本开工令不授权）

- 勾选 D1–D3 / O1–O3 / L1–L3；架构 Owner 签字代签
- 独立发版 / 仓库 / 生产流水线；改 `independentlyDeployable` / `deployBoundaryProven` 为 true
- P8b enforce / Gate / live invoke；P8c；Tier H；soft-observe
- 整段 §9.2 完成叙事；整段 Phase D GO；C NO-GO 翻盘；C10 pass

## 8. 残差（须另文接受 + 开工令）

- D1（部署单元图或「必须同进程」ADR 的完整签字勾选）
- D2（分开回滚 / 失败域）
- O1–O3；L1–L3
- 架构 Owner 签字后将 D3 ☐→☑
- 从脚手架升格为发布边界（另立书面范围 + 开工令）
