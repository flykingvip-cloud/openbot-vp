# WP-01 最小结果与证据合同草案

状态：DRAFT（设计 only，未改运行代码）  
HEAD：`c0c0ba52b0b2460a1e3e2fa9bbf7b889355dd07d`  
作者：grokbot-verifiable-delivery

## 目的

先明确**任务、交接事实、恢复结果、完成状态**的关系，再动 WP-02 恢复接线。复用 turn-completion、task-surface、preflight、正式交付目录、handoff 事实；不新建平行完成账本。

## 实体关系（最小）

```
Task (业务任务身份)
  └─ Responsibility / Owner (交接合同可变更；未 apply 前旧 owner 有效)
  └─ LogicalAction* (幂等键绑定的业务动作；≠ attempt)
       └─ Attempt* (执行尝试；可失败/未知)
  └─ HandoffFact* (propose→accept→approve→apply；持久化于 handoffsDir log/txn)
  └─ Deliverable* (产物 ID + 内容哈希；工作台交付)
  └─ VerificationReceipt* (独立验证器签发；不可由模型自报)
  └─ TaskResultEnvelope (唯一结果信封 → 指标/完成投影)
```

## 状态区分

| 状态 | 含义 | 计入成功分母？ |
| --- | --- | --- |
| succeeded | 业务验收通过且证据有效 | 是（成功） |
| rejected | 明确拒绝 | 分母保留，非成功 |
| cancelled | 取消 | 分母规则冻结后单列 |
| failed | 已知失败 | 分母保留 |
| unknown_outcome | 外部效果不明 | **不得**计成功；进入核对 |
| awaiting_acceptance | 待人工验收 | 未完成 |
| human_takeover | 人工接管后的辅助成功须单独标记 | 辅助成功 ≠ 自主成功 |

## 结果信封最小字段

tenant/operator、taskId、logicalActionId、runId/attemptId、deliverableId+contentHash、verifierId+ruleVersion、externalReceiptRef、acceptor+role、model/config fingerprint、experienceAssetVersions[]、timestamps、failureReason、cost、terminalStatus、handoffId?、recoveryRolledForward?

## 与交接 / 恢复的边界

- **交接事实持久化**（log/txn 已写）≠ **任务投影已更新**（owner 已 apply）。
- **恢复**（`recoverPendingHandoffTxns` → `rollForwardTask`）只把已持久事实滚到一致投影；不创造新业务动作。
- 恢复成功 ≠ 任务业务成功；恢复重复执行必须无第二次业务副作用。
- completion-hold / in-memory receipt **不能**单独证明跨重启完成。

## 证据合格性

合格证据须可核验：签发者、租户、对象/版本、有效期。字符串形态合法不足。跨租户、过期、篡改内容、未授权验收 → 不得计成功。

## 本轮非目标

不改 attempt.ts；不实施字段迁移；不接指标生产者。下一步：对照 `turn-completion/contract.ts` 与 handoff 类型做字段映射表（仍属设计）。

## 验收指向（G1，未宣称达到）

无文件/空文件/内容变化/过期回执/跨租户/未授权验收/重复结果事件均不能误计成功；未知保持未知。
