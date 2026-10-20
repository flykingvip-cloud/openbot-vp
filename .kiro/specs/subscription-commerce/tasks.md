# Implementation Plan

> 关联：`requirements.md`、`design.md`
>
> **2026-06-19 评审结论**：方向正确；Phase 2/3 UI 前必须先完成 **Phase 1.5 底座硬化**（版本锁价、合同周期、租户隔离、销售驱动入口、履约对账）。

## Overview

| 阶段          | 目标                                        |
| ------------- | ------------------------------------------- |
| **Phase 1**   | 订单 + 手工核销（已完成）                   |
| **Phase 1.5** | 底座硬化 ✅                                 |
| **Phase 2A**  | 平台核销 + 线索转单 + billingStatus 投影 ✅ |
| **Phase 2B**  | 企业端结账 UI ✅（最小）                    |
| **Phase 3**   | 发票（企业 + 平台审核）✅                   |
| **Phase 4**   | 续费 & 内部容量包 ✅                        |
| **Phase 5**   | 在线支付 ✅                                 |
| **Phase 6**   | 联调回归 ✅                                 |

## Agents

- cursor-agent · role: owner · scope: subscription-commerce · paths: `src/gateway/commerce/**`, … · since: 2026-06-19

## Tasks

### Phase 1：Commercial 内核 + 手工核销 ✅

（见 git 历史 / 已完成项 1–7）

### Phase 1.5：底座硬化（阻塞 Phase 2 UI）✅

（见 git 历史 1.5.1–1.5.8）

### Phase 2A：B2B 销售驱动 ✅

- [x] 17. 销售线索转订单 — cursor-agent
- [x] 18. 平台最小核销工作台 UI — cursor-agent
- [x] 18.1 billingStatus 投影 — cursor-agent
  - `tenant-billing-projection.ts`；订单创建/履约/取消后 sync → platform-auth `billingStatus`

### Phase 2B：企业端结账 UI ✅（最小）

- [x] 8. RPC 客户端扩展（`commercial-orders.*` + `checkout-info`）— cursor-agent
- [x] 9. 「订单与支付」子页 + 对公指引 — cursor-agent
- [x] 10. 订阅页待支付 → 跳转结账 — cursor-agent
- [x] 11. i18n（zh-CN / en）— cursor-agent

### Phase 3：发票（企业 + 平台审核）✅

- [x] 12. `billing-profile-store.ts` + RPC `billing-profile.get/set` — cursor-agent
- [x] 13. `invoice-requests-store.ts` + `invoice-request-service.ts` — cursor-agent
- [x] 14. RPC `invoices.*`（企业申请/列表 + 平台审核）— cursor-agent
- [x] 15. 企业「发票与开票」子页 + 平台核销 Tab 发票队列 — cursor-agent
- [x] 15.1 `subscriptions.get` 增加 `billingProfile` 摘要 — cursor-agent
- [x] 测试：金额快照、租户隔离、重复申请 — cursor-agent

### Phase 4：续费 & 内部容量包（非前台 Credits 叙事）✅

- [x] 19. `createRenewCommercialOrder` + 履约延长 `commercialContract` — cursor-agent
- [x] 16. `credit-packs-store` + `recharge_credits` 订单/履约 + `appendRechargeCredits` — cursor-agent
- [x] RPC：`credit-packs.list` / `credit-packs.upsert`；`commercial-orders.create` 支持 `renew` / `recharge_credits` — cursor-agent
- [x] 企业订阅页：续费按钮 + 容量包购买（弱化 Credits 叙事）— cursor-agent
- [x] 测试：`renew-order.test.ts` — cursor-agent

### Phase 5：在线支付 ✅

- [x] 20. `payment-providers/` adapter 缝（stripe / alipay，sandbox + live 配置）— cursor-agent
- [x] 21. `payment-checkout-service` + HTTP webhooks `/commerce/webhooks/*` — cursor-agent
- [x] 22. `payments.create` 支持 stripe/alipay；企业订单页在线支付 UI — cursor-agent
- [x] 测试：`online-payment.test.ts`（checkout + webhook 幂等 + 签名校验）— cursor-agent

### Phase 6：联调回归 ✅

- [x] 23. 端到端：下单 → sandbox webhook → 履约 → billingStatus 投影 — cursor-agent
- [x] 24. 企业 UI browser test（订单空态/待支付/发票资料校验）— cursor-agent

## Notes

- **CreditPack**：与 `docs/design/platform-pricing-tiers-2026-06-16.md` 一致，弱化前台 Credits 叙事。
- **Legacy bypass**：`OPENBOT_COMMERCE_LEGACY_BYPASS=1` 仅测试/迁移。
