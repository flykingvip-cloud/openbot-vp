# OpenBot Diagnosis Platform — P26.4 切后正式放行

Date: 2026-09-07

Status: **Delivery 已把 LIVE 切到 `8b5db08ee1`。P26.3 hold 解除。Production Ready 在人审签字后可为 true。不绑 Doctor `--fix`，不部署 live executor，不改账本。**

Task: `openbot-diagnosis-platform`

Related:

- [P26.3 hold](/design/openbot-diagnosis-p26.3-2026-09-06)
- [P26.4 就绪记录](/design/openbot-diagnosis-p26.4-readiness-2026-09-07)
- [P26.4 delivery 行动单](/design/openbot-diagnosis-p26.4-delivery-owner-actions-2026-09-07)

硬门禁：合入本增量 ≠ 再切一次 LIVE ≠ 打开 live executor ≠ 把 P11 live-traffic SLO 填成 complete。

---

## 1. 原先挡住正式放行的四件事

| 原 blocker                                                  | P26.4 处置                                                                                                                                   |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `live_not_equal_candidate`                                  | 已解。candidate = LIVE = `8b5db08ee149db694a47210d4e65bd0958ffdcd3`                                                                          |
| `live_cutover_pending` / `further_diagnosis_resign_blocked` | 已解。delivery 已切，P26.3 停等条件满足                                                                                                      |
| `production_slo_empty`                                      | 重分类。P11 `DIAGNOSIS_PRODUCTION_SLO` 仍 empty（尚无生产诊断 QPS）。入学用隔离闭环 SLO（complete）。残留观察：`live_traffic_slo_unobserved` |
| `live_executor_undeployed`                                  | 重分类为安全约束，不是 No-Go。正式放行仍禁止 live executor / Doctor `--fix` / Channel restart                                                |
| `production_ready_not_separately_approved`                  | 由 `human_production_ready_record` 单独签字解除                                                                                              |

origin/main 之后若只因账本 PR（如 #1026）前移，不撤销这次 LIVE 绑定。

---

## 2. Production Ready 含义

- 现网已经在跑的诊断平台（gates 已开、`diagnosis-reports` pack 已注册、隔离 P25/P26 闭环通过）获得官方入学。
- 不等于全量自动修复，不等于生产诊断流量 SLO 已达标。
- `approvedForProductionCutover` 保持 false：那是 P11 切流开关，切流已由 delivery 做完。

---

## 3. 未做

- 未改 `DIAGNOSIS_PRODUCTION_SLO`
- 未部署 live remediation executor
- 未绑 Doctor `--fix` / Channel restart
- 未写 `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` / `RELEASE_RECORD.md`
- 未要求本增量立刻再切 LIVE（放行记录绑的是已在跑的 SHA）
