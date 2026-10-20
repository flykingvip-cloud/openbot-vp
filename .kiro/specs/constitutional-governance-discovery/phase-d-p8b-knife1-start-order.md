# Phase D P8b Knife1 — 开工令

> 开工令 id：`phase_d_p8b_knife1_start_order`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-d-p8b-knife1-start-order.md`。  
> 日期：**2026-09-26**（Asia/Shanghai）  
> 前置接受：`phase-d-p8b-written-scope-acceptance.md`（`phase_d_p8b_written_scope_acceptance_knife1`）  
> 有界范围：`phase-d-p8b-knife1-scope.md`（`phase_d_p8b_knife1_select_only`）  
> 本页是 **Knife1 第二门开工令**。不是整段 P8b 开工，不是整段 Phase D GO。

## 1. 授权一句话

在父书面范围已按 **Knife1-only** 记名接受的前提下，授权在 `@openbot/constitutional-contracts` 落地：**1 条可版本化合法 Path 登记 + 默认关选中 API**；主张 **`code-present`**；**`executed` 恒为 false**；无热路径接线。

## 2. 基线

| 项 | 值 |
| --- | --- |
| Base branch | `main` |
| Baseline SHA | `524f31e4238d50e8c68b892fca0388b5e7f69de5`（PR #74 base；含 #71 `ad05d733` 及 #72/#73） |
| 实现 PR | https://github.com/upbeyond/openbot/pull/74 （`feat/phase-d-p8b-knife1-legal-path`） |

## 3. 落点（packages / paths）

| 落点 | 路径 |
| --- | --- |
| 合法 Path 登记 | `packages/constitutional-contracts/src/legal-path/registry.ts` |
| 选中 API | `packages/constitutional-contracts/src/legal-path/select.ts` |
| 单测 | `packages/constitutional-contracts/src/legal-path/select.test.ts` |
| 导出 | `packages/constitutional-contracts/src/index.ts` |
| 包说明 | `packages/constitutional-contracts/README.md` |
| 发现注 | `phase-d-p8b-knife1-scope.md`；`phase-d-p8b-knife1-profile-impact.md` |

**不**落点：gateway chat / tool invoke / ACP / AOR / dispatch / gateway-hook；不改 P8a `path-gap/report.ts` 空集语义。

## 4. 旗标

| 项 | 值 |
| --- | --- |
| 名 | `OPENBOT_CONSTITUTIONAL_LEGAL_PATH_SELECT` |
| 默认 | **关**（unset / 非 truthy） |
| 读法 | 仅调用方传入的 env 快照或显式 `select: true`；模块**不**读 `process.env` |
| 打开时 | 允许从登记集选中 `constitutional.declared.v1`；**仍不**执行 |
| 关闭时 | 有效合法集空；`selectedPath=null`；`executed=false`（P8a 行为面） |

## 5. `executed` 与主张

- `executed`：**恒 false**（本开工令禁止副作用执行面）
- `sideEffects`：恒空
- 主张天花板：**`code-present`**
- 禁止：`runtime-enabled` / `production-proven` / C5 全面 pass /「Path 已在热路径」

## 6. 回滚

秒级行为回滚（无需删库）：

1. 不要调用 `selectLegalPath`，或不要传入 `select: true` / 打开的旗标快照；**或**
2. 确保 `OPENBOT_CONSTITUTIONAL_LEGAL_PATH_SELECT` 未设为 truthy。

完整代码回滚（若需撤掉 Knife1 表面）：

```bash
# from main after merge, or on the PR branch:
git revert <knife1-landing-commit-sha(s)>
# alternatively delete packages/constitutional-contracts/src/legal-path/
# and drop related discovery notes / exports / README section
```

无热路径残留调用可依赖；包未被 gateway/ACP/AOR 热路径 import。

## 7. 测试门

```bash
pnpm --dir packages/constitutional-contracts test
pnpm --dir packages/constitutional-contracts typecheck
pnpm --dir packages/constitutional-contracts build
```

须覆盖：默认关 inert、命中登记则选中且不执行、涂装候选拒绝、旗标关有效集空。

## 8. OUT（本开工令不授权）

- enforce / Gate 收紧 / live invoke / Fabric-on
- `executed=true`；P8c；Tier H
- 整段 P8b 其余刀；整段 Phase D GO；C NO-GO 翻盘
- soft-observe（stdio / AOR / Cron）；重开 #58–#71 为刀清单

## 9. 残差（须另文开工令）

- 执行边界内 opt-in `executed=true`
- 合法轨迹空间扩展（>1）与旁路表闭合
- P8c；Gate 收紧 ADR；C5 全面 pass 所需闭合
