# P17 SLO 预生产观测快照

Date: 2026-09-04

Status: **completeness=`empty`。缺失观测不得渲染为健康。`readyForIndependentApproval=false`。**

Machine: [SLO JSON](/design/openbot-diagnosis-p17-slo-2026-09-04.json)

---

## 来源与范围

| 项       | 值                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------- |
| 观测来源 | 无 live diagnosis 查询路径（四门 gate 均为 false，live pack 未注册）                                  |
| 时间窗口 | `2026-09-04T05:55:49Z`（seq 60 `liveFrom`）→ `2026-09-04T06:25:28.750Z`（P17 preflight `recordedAt`） |
| 采样范围 | none；无生产诊断流量                                                                                  |
| 租户范围 | 无观测租户。Trusted tenant 只来自 membership；url/query/body/header/sessionTenantId 均非权威          |

P15 convergence 内嵌的 rehearsal 注入数字**不是**本快照，不得当作生产健康。

## 必采指标

| 指标                 | observed |
| -------------------- | -------- |
| success              | `null`   |
| error                | `null`   |
| latency              | `null`   |
| stale                | `null`   |
| authorization_denied | `null`   |
| quota_exhausted      | `null`   |

## SLO

| 项                      | target   | observed      |
| ----------------------- | -------- | ------------- |
| queryLatencyMs          | 300      | `null`        |
| inspectionSuccessRate   | 0.99     | `null`        |
| deliverySuccessRate     | 0.99     | `null`        |
| authorizationWaitMs     | 300000   | `null`        |
| verificationSuccessRate | 0.95     | `null`        |
| falsePositiveRate       | 0.05     | `null`        |
| completeness            | complete | **empty**     |
| sloHealthy              | —        | **false**     |
| rendered health         | —        | **not_ready** |
