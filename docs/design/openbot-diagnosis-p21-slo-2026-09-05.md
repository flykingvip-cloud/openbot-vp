# P21 SLO 预生产观测快照

Date: 2026-09-05

Status: **completeness=`complete`。rendered health=`healthy`。readyForIndependentApproval=true。**

本快照来自隔离预生产排练，不是 live diagnosis 流量。standalone production-preflight 仍为空 SLO。

## 来源与范围

| 项       | 值                                                            |
| -------- | ------------------------------------------------------------- |
| 观测来源 | isolated preprod rehearsal（isolated_preprod_rehearsal_only） |
| 时间窗口 | `2026-09-05T04:20:00.000Z` → `2026-09-05T04:30:19.085Z`       |
| 采样范围 | isolated_preprod_rehearsal_only                               |
| 租户范围 | trusted `tenant-fixture-a`；membership only                   |

## 必采指标

| 指标                 | source                                                | window                                                  | sample                          | tenant                                    | observed |
| -------------------- | ----------------------------------------------------- | ------------------------------------------------------- | ------------------------------- | ----------------------------------------- | -------- |
| success              | isolated_preprod_rehearsal.dispatchDiagnosisReportApi | `2026-09-05T04:20:00.000Z` → `2026-09-05T04:30:19.085Z` | isolated_preprod_rehearsal_only | trusted:tenant-fixture-a; membership_only | 12       |
| error                | isolated_preprod_rehearsal.dispatchDiagnosisReportApi | `2026-09-05T04:20:00.000Z` → `2026-09-05T04:30:19.085Z` | isolated_preprod_rehearsal_only | trusted:tenant-fixture-a; membership_only | 2        |
| latency              | isolated_preprod_rehearsal.dispatchDiagnosisReportApi | `2026-09-05T04:20:00.000Z` → `2026-09-05T04:30:19.085Z` | isolated_preprod_rehearsal_only | trusted:tenant-fixture-a; membership_only | 12       |
| stale                | isolated_preprod_rehearsal.dispatchDiagnosisReportApi | `2026-09-05T04:20:00.000Z` → `2026-09-05T04:30:19.085Z` | isolated_preprod_rehearsal_only | trusted:tenant-fixture-a; membership_only | 1        |
| authorization_denied | isolated_preprod_rehearsal.dispatchDiagnosisReportApi | `2026-09-05T04:20:00.000Z` → `2026-09-05T04:30:19.085Z` | isolated_preprod_rehearsal_only | trusted:tenant-fixture-a; membership_only | 4        |
| quota_exhausted      | isolated_preprod_rehearsal.dispatchDiagnosisReportApi | `2026-09-05T04:20:00.000Z` → `2026-09-05T04:30:19.085Z` | isolated_preprod_rehearsal_only | trusted:tenant-fixture-a; membership_only | 3        |

## SLO

| 项                      | target   | observed     |
| ----------------------- | -------- | ------------ |
| queryLatencyMs          | 300      | 12           |
| inspectionSuccessRate   | 0.99     | 1            |
| deliverySuccessRate     | 0.99     | 1            |
| authorizationWaitMs     | 300000   | 0            |
| verificationSuccessRate | 0.95     | 1            |
| falsePositiveRate       | 0.05     | 0            |
| completeness            | complete | **complete** |
| rendered health         | —        | **healthy**  |
