# ADR：Phase B 完成（completion）评估方案

> Status: Accepted · Phase B web_read shadow · Agent: grok-bot
> Date: 2026-09-24

## Context

语料 `completionLabel` 分布为：`must_not_complete` ×40 + `not_applicable` ×20，**零** `should_complete`。
本切片契约为 `invoke=false`、`enqueue=false`、无工具调用、无交付语义；影子路径不产生「任务完成」事件。

若坚持 Option A（false-completion ≤5%，分母 = should_complete ∪ must_not_complete），则：

1. 分母几乎全是单边 `must_not_complete`，无法识别「该完成却未完成」类错误；
2. 为凑正例而虚构 `should_complete` 会对影子-no-invoke 切片作假，属于不诚实门禁。

## Decision

**采用 Option B。**

## Rationale

Phase B `web_read` 影子切片：`invoke=false`、`enqueue=false`、无工具调用、无 completion/delivery 语义；语料缺少 `should_complete` 正例；在单边 `must_not_complete` 标签下，false-completion 率不可辨识。

## Gate change

- **移除** Phase B 门：`false-completion ≤ 5%`
- **替换为**：`completion claim suppression = 100%`
  - 影子报告对本切片**不得**声称任务完成 / 交付（`completionClaim.claimedComplete` 必须为 `false`；`claimKind` ∈ {`none`,`suppressed`}；出现 `claimed` 即门失败）

## 何时重开 Option A

未来相同时刻具备下列条件时可重开 Option A 并恢复 false-completion 比率门：

1. 切片具备真实 completion / delivery 语义（非纯 shadow observe）；
2. 语料含平衡的 `should_complete` 与 `must_not_complete` 标签，且分母规则可辨识；
3. 架构 Owner 书面批准恢复比率门。

## Consequences

- `eval-contract.md` 阈值表与分母规则按 Option B 更新
- `report-schema-draft.json` 增加 `completionClaim`；`falseCompletionCandidate` 改为 `completionClaimViolation`
- 编码实现必须保证影子路径永不写出完成/交付声明

— Agent: grok-bot
