# enterprise-commercial-billing-hardening

| Owner            | Task                                      | Role        |
| ---------------- | ----------------------------------------- | ----------- |
| **grok-billing** | `enterprise-commercial-billing-hardening` | implementer |

## Agents

- grok-billing · role: owner · scope: commercial billing hardening (period, settlement, meters, seats, statement) · paths: `src/gateway/billing/**`, `src/gateway/commerce/**`, `src/gateway/server-methods/billing.ts`, `src/gateway/server-methods/seats.ts`, `.kiro/specs/enterprise-commercial-billing-hardening/**`, `docs/design/openbot-enterprise-commercial-billing-hardening-2026-07-18.md` · since: 2026-07-18

## Checklist

### Phase 1 — 账期与结算幂等

- [x] 权威 CycleWindow 解析（合同锚点，月/季/年）— grok-billing
- [x] settlementKey + 确定性 billId — grok-billing
- [x] final 仅账期结束后；preview=estimated — grok-billing
- [x] 重复/并发 settle 幂等 — grok-billing
- [x] 相关单测 — grok-billing
- [x] resolveContainingCycle / resolveLatestCompletedCycle 拆分 — grok-billing
- [x] 边界 = anchor + periodIndex×months（无链式漂移）— grok-billing
- [x] Bill+Snapshot 原子落账；去重返回持久化对 — grok-billing
- [x] 积压账期按序补结：earliest unfinalized completed cycle + NoPendingSettlementError — grok-billing
- [x] contractEnd 钳制 payment_contract / usage_settlement / credits_reset 三类周期 — grok-billing
- [x] MeterDefinition 显式管理入口（Create/Version API + UI + 一致性校验）— grok-billing
- [x] 跨订阅补结：expired/canceled 可结；升级先旧后新 — grok-billing
- [x] 显式历史补结 `subscriptionId`（可与 cycleStart 联用）— grok-billing
- [x] **Phase 1/2a 三条长期阻断关闭**（2026-07-18）— grok-billing
- [ ] 后续：canceled/suspended 的 `endTime` 是否截短合同结算窗口（待产品确认）— deferred

### Phase 2 — Credits 与超额策略

- [x] MeterDefinition + 禁止 usage/extra 双计 — grok-billing
- [x] final 传入 entitlement 配额；缺配置拒绝出账 — grok-billing
- [x] 去掉 monthlyCredits→ai_token 隐式映射 — grok-billing
- [x] MeterDefinition 控制 included 收费/单位/配额/价格 — grok-billing
- [x] 持久化 snapshot.meters；ai_credits 套餐内默认不收费（禁止用 extra 价推断）— grok-billing
- [x] createPlan/createPlanVersion 首版即冻结 meters — grok-billing
- [x] 企业路径禁用自然月：billing handlers + provisioning 走 contract cycle — grok-billing
- [x] 改价新建版本重建 meters（保留策略标志，不盲拷贝）— grok-billing
- [x] 拆分 payment_contract / usage_settlement / credits_reset 三种周期 — grok-billing
- [x] Credits 桶用 monthly credits_reset，禁止绑年付合同窗 — grok-billing
- [x] recordCreditUsage 延迟上报用锁定 subscriptionId/snapshot 推周期 — grok-billing
- [x] block / credits_only / pay_as_you_go 运行时（authorize + constraint-engine）— grok-billing
- [x] Credits 阶段机骨架（ledger→bucket→tenant→usage→event→done）— grok-billing
- [x] PAYG 流水 includedCredits/overageCredits/overageAmountCents + final Bill extra — grok-billing
- [x] 各阶段 taskId 幂等副作用（bucket/tenant/usage/event）— grok-billing
- [x] 并发同 taskId + 分阶段故障注入恢复断言 — grok-billing
- [x] **Phase 2 正式关闭**（2026-09-12 生产验收：workspace-4 受控超额 settle 四方对账 10000 cents）— grok-billing

### Phase 3 — 席位生命周期

- [x] active/inactive/removed + deactivate/remove/reactivate — grok-billing
- [x] 唯一 active 席位（enterpriseId + normalizedUserId）— grok-billing
- [x] 配额校验锁定 subscription.planVersionId（禁止 Plan 当前版本漂移）— grok-billing
- [x] deactivate/remove 关闭 open seat_history；reactivate 重开区间 — grok-billing
- [x] countSeatsByRole / findBillingSeat 仅计 active — grok-billing
- [x] RPC seats.deactivate / seats.remove / seats.reactivate + method-scopes — grok-billing
- [x] 相关单测 phase3-seat-lifecycle — grok-billing
- [x] 锁内原子角色配额：并发 assign/set-role/reactivate 不破 quota — grok-billing
- [x] history 不变量：startTime < endTime；同 seat 半开不重叠 — grok-billing
- [x] Gateway Handler 验证 PlanVersion 锁定 + 并发配额 — grok-billing
- [x] 乱序 effectiveAt 拒绝（不钳制）：deactivate/set-role ≤ open.start；reactivate < latestClosed.end — grok-billing
- [x] 幂等：已 inactive/removed/active(open) 允许重复调用 — grok-billing
- [x] **Phase 3 正式关闭**（2026-07-18）— grok-billing

### Phase 4 — 统一账单与发票

- [x] Statement 聚合 Order 预付（base_prepaid + payment_applied）+ Bill 消费（seat/usage/overage）— grok-billing
- [x] 发票金额 = Statement 可开票余额（invoiceable）；已占用 order/bill 不可再开 — grok-billing
- [x] RPC billing.statement + invoices.request 走可开票语义 — grok-billing
- [x] 相关单测 commercial-statement + invoice-requests — grok-billing
- [x] 总余额申请持久化 allocations；Statement 按 allocation 扣减 — grok-billing
- [x] 计算余额+创建占用同一发票 store 锁（防并发重复）— grok-billing
- [x] Statement 占用列表无 100 条分页上限 — grok-billing
- [x] 回归：连续总额、并发、>100 占用、reject 释放 + handler 测试 — grok-billing
- [x] 裸总额无 allocations 历史脏数据迁移（读路径/开票前自动 + 可重入）— grok-billing
- [x] **Phase 4 正式关闭**（2026-07-18 验收通过）— grok-billing

### Phase 5 — 指标、迁移、E2E

- [x] MRR 合同标准化（锁定 PlanVersion + commercialContract 周期 effectiveMonthly）— grok-billing
- [x] MRR 禁止 Plan 头 live basePrice 漂移 — grok-billing
- [x] commercial-snapshot / plan-commercial-summary 接入锁定价 — grok-billing
- [x] 黄金路径自动化：订阅→席位→用量→settle→statement→发票 + MRR 锁定断言 — grok-billing
- [x] **Phase 5 正式关闭**（2026-07-18 验收通过）— grok-billing

## Closure

- [x] **企业计费闭环正式关闭**（gate **seq84** `786eec763122` / tag `provenance/sha-786eec763122`，2026-09-12 首次生产验收；台账 PR #1104）— grok-billing
- [x] **持续验收（当前 LIVE seq86 `16cea426e711`，2026-09-13/14 复验）** — 生产 `openbot-gateway-rc` build-info.commit=`16cea426e711516629e52c0522c39a7a77628655`；租户 001 企业管理员 `billing.attribution-by-position` OK（112 rows）；隔离租户 workspace-4 受控超额样例 Bill/席位/岗位/Statement 均为 **10000 cents**（`fourWayAligned: true`；settle 幂等返回「已结算」属预期）；证据 `/root/billing-closure-probe-001-20260913T183502Z.log`、`/root/billing-settle-final-workspace4-20260913T183521Z.log` — cursor-composer

> **Note:** `origin/main` trunk tip（如 `36c8a3df7f9b…`）可领先于 LIVE SHA；验收以 ledger open LIVE row + 生产容器 build-info 为准，非 trunk tip。
