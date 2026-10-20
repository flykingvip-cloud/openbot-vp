# OpenBot Diagnosis Platform — P5 大白投送合同

Date: 2026-09-03

Status: **投送合同已落地，缺授权 fail-closed 待复验。未接入 live Da Bai / 消息主链。P5 完成 ≠ 生产部署 ≠ 真实聊天接入。不得进入 P6。**

Audience: Platform Architecture、Gateway、Security、QA

Task: `openbot-diagnosis-platform`

Related:

- [P4 动态巡检与 DiagnosticSignal](/design/openbot-diagnosis-p4-inspection-signals-2026-09-03)

硬门禁：P4 仍只读、不投送。P5 只定义可注入 transport 的投送合同。默认 transport 返回 `unavailable`。禁止调用 `user.daibai.ask` / `user.daibai.execute`，禁止写 Session / 消息主链 / Skill Invocation / Doctor / Channel。

---

## 1. 路由

`routeDiagnosisDaibaiDelivery(signal, auth)` 返回 `DiagnosisDaibaiRoute | "unauthorized" | "no_recipient"`。普通租户信号必须有显式授权，禁止用 `tenantId` 默认进员工大白。

| 条件                                                                  | 结果           |
| --------------------------------------------------------------------- | -------------- |
| `sessionDomain=platform` 或 `platform-admin` / `platform-super-admin` | `platform`     |
| `tenantId=null`（system tenant）                                      | `platform`     |
| `sessionDomain=enterprise` 或 `diagnosis.report_admin`                | `enterprise`   |
| `sessionDomain=employee`                                              | `employee`     |
| 无 auth / 空 auth                                                     | `no_recipient` |
| 有 auth 但 sessionDomain/sessionKind 不匹配                           | `unauthorized` |

`enqueue()` 在 `no_recipient` / `unauthorized` 时返回 `rejected`，原因分别为 `authorization_required` / `unauthorized`，**不得进入 pending**，也不得调用 transport。

---

## 2. 脱敏

`redactDiagnosisDaibaiDelivery` 按路由投影。所有路由都去掉 `sessionKeyHash`、`authority`、Evidence payload 与禁止字段。

| 路由       | 保留                                               |
| ---------- | -------------------------------------------------- |
| employee   | kind / reasonCode / completion / 计数 / targetType |
| enterprise | 另加 caseId / targetId                             |
| platform   | 另加 findingIds / evidenceIds                      |

---

## 3. 幂等、回执、队列

`deliveryId = dlv:{signalId}:{route}`。同一 id 已 `accepted` / `expired` 时再次 enqueue 返回原回执。

回执状态：`accepted` / `queued` / `retried` / `expired` / `rejected`。

大白不可用：入待投送队列；`flush()` 重试；超过 `maxRetries` → `rejected`；超过 signal/delivery 过期 → `expired`。

默认 transport 为 `createUnavailableDaibaiTransport()`。测试可注入 `createMemoryDaibaiTransport()`。

---

## 4. 未做

- 未调用 live `daibai` method-pack
- 未写入真实聊天或消息主链
- 未把 P4 scheduler 自动接到投送队列
- 未生产部署
