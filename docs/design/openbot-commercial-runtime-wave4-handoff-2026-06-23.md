# OpenBot Commercial Runtime Wave 4 — 归属链 + No-bypass 扩展 Handoff

Date: 2026-06-23

Status: **Delivered**

Prerequisite: Wave 3+（`openbot-commercial-runtime-wave3-handoff-2026-06-23.md`）

---

## 交付摘要

| 轨道          | 交付                                                                                 |
| ------------- | ------------------------------------------------------------------------------------ |
| **归属链**    | `updateBotGovernance` + `ownerSeatId` 优先解析 + 交接后 `authorizeCommercialRun` E2E |
| **No-bypass** | 注册表扩展 Chat / Gateway agent / governance hub                                     |
| **治理 UI**   | 待审批 > 0 时链到企业数据治理中心                                                    |
| **前台**      | 预算设置「限制 AI 员工创建」口径                                                     |

---

## 归属链（Seat → Bot → Run）

- `bot-resources-store.ts` — `updateBotGovernance({ ownerSeatId, visibility })`
- `resolve-billing-seat-for-commercial-run.ts` — `bot.ownerSeatId` 优先于 `ownerUserId`
- `commercial-runtime-wave4.integration.test.ts` — 交接 seatB 后新 run 可走 seatB 并发槽

---

## No-bypass 扩展

新增登记：

- `agent_run_governance_hub` — `agent-run-governance.ts`
- `chat_reply_pipeline` — `get-reply-run.ts` / `agent-runner.ts`
- `gateway_agent_api` — `server-methods/agent.ts` → `agentCommandFromIngress`

---

## 验收命令

```bash
OPENBOT_TEST_PROFILE=low pnpm test \
  src/gateway/billing/bot-resources-store.test.ts \
  src/gateway/billing/resolve-billing-seat-for-commercial-run.test.ts \
  src/gateway/billing/commercial-runtime-wave4.integration.test.ts \
  src/gateway/billing/commercial-run-entrypoints-audit.test.ts \
  ui/src/ui/views/cost-budget-v2/pages/overview-governance.browser.test.ts

bun scripts/audit-commercial-run-entrypoints.ts
pnpm build
```

---

## 后续

- Workflow / Batch / Supervisor worker 入口登记与 authorize 接线
- CLI `agent.ts` 全量 `authorizeCommercialRun`
- 充值 / 升降级 / burst 组合场景 E2E 回归套件
- 治理审批中心内嵌快捷操作（当前为外链 CTA）
