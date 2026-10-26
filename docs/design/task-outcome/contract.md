# TaskOutcome 统一契约（已冻结 · askOutcome P0）

> **状态：已冻结。** 合法输入有唯一判定；非法组合由类型或结果服务拒绝。  
> 实施基线：`origin/main` @ `39cebb4974a8f290dc4b3cb951d89ec8466cfc38`（登记时 tip；推送前须再 fetch 核验）。  
> 历史草案与旧基线测试数字仅作证据，不以之为开发 tip。

## 1. 分层

- `AttemptResult` → `RunResult` → `TaskOutcomeRecord`
- 入口权威创建/恢复 `taskId`；preflight 只继承/校验
- preflight 前失败可归档，禁止伪造 run/attempt

## 2. 生命周期与唯一判定（冻结）

| lifecycle | taskJudgement（查询） |
|-----------|----------------------|
| 非 `closed` | **必须** `incomplete` |
| `closed` | 仅 `success` \| `failure` \| `cancelled` |

| 场景 | lifecycle | judgement |
|------|-----------|-----------|
| 验收 pending，交付 blocked/pending | `awaiting_acceptance` | incomplete |
| 验收 failed，允许修复 | `recovering` | incomplete |
| 验收 failed，停止修复 | `closed` | **failure** |
| 验收通过，等待交付 | `awaiting_delivery` | incomplete |
| 验收满足且交付 delivered/not_required | `closed` | **success** |
| 用户取消 | `closed` | **cancelled** |
| prepare/preflight 拒绝 | `closed` | **failure**（归因 prepare） |

硬规则：

1. 非终结结果唯一表达：查询投影 `incomplete`（禁止入口自行省略或填值）。
2. `delivery_unknown` **不得**推导为 success；结束处理须用明确未确认关闭原因。
3. fencing token 识别过期执行器；超时通过抬升 `leaseEpoch` 并撤销 token；取消生效后普通写入 `terminal_protected`。
4. 个人域 / 企业域可辨识；个人任务禁止伪造 `tenantId`。
5. `eventId` 固定为 `taskId|outcomeVersion|eventType` 摘要；消费者去重 `consumerId + eventId`。
6. 唯一持久化：`DurableTaskOutcomeStore`（任务文件 + outbox + consumer ack + contribution 投影）。

## 3. 状态转换（原子）

由 `TaskOutcomeResultService.submit` + `applyTransition` 执行；CAS 校验 `expectedVersion`；普通执行器不得改写 `closed`（`correction` 需 `authorizedBy` + `previousOutcomeVersion` + 审计字段）。

## 4. 评价资格

`computeEvaluationEligibility`：取消 / 鉴权拒绝 / 供应商故障 / 交付故障 / 产物失败分归因；取消不计技能成功率与成长负样本。

## 5. 父子任务

`ParentChildContract`：`requiredChildTaskIds` / `optionalChildTaskIds` / `aggregation`，防止父子重复计同一指标（P0 保留字段与类型；聚合计算接口边界，P1 扩消费）。

## 6. 入口适配

同一结果服务：`chat` / `gateway_agent` / `cron` / `cli` / `collab`。  
消息重发复用 taskId；cron 每次触发新任务、同次触发重试复用；会话恢复仅在同一任务时恢复 taskId。
