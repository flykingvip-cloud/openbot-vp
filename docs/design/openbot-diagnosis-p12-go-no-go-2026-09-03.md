# OpenBot Diagnosis Platform — P12 Go/No-Go 预检包

Date: 2026-09-03

Status: **No-Go。P5 进程内投送合同已复验签收，但 candidate ≠ origin/main、RELEASE_RECORD 与 LIVE/ledger 不一致、SLO 观测为空、生产依赖未注入。全部 gate 保持 false。P12 ≠ 生产部署 ≠ Diagnosis Platform 完成。**

Audience: Platform Security、Enterprise Admin、SRE、QA

Task: `openbot-diagnosis-platform`

Related:

- [P5 大白投送合同](/design/openbot-diagnosis-p5-daibai-delivery-2026-09-03)
- [P11 受控灰度与回滚演练](/design/openbot-diagnosis-p11-production-cutover-2026-09-03)
- [P3.10 生产接入审批包](/design/openbot-diagnosis-p3.10-production-approval-pack-2026-09-02)
- [开发交付链路标准](/design/openbot-dev-delivery-pipeline-standard-2026-07-20)

硬门禁：即使 `readyForIndependentApproval=true`，也不得打开生产 gate、不得注册 live pack、不得调用真实聊天 / RPC / Doctor / Channel、不得自动修复。Trusted tenant 只来自服务端 membership。禁止新增 Report DB / Skill Health DB / 平行诊断事实源。

机器可读快照：[P12 preflight JSON](/design/openbot-diagnosis-p12-preflight-2026-09-03.json) · [P12 preflight Markdown](/design/openbot-diagnosis-p12-preflight-2026-09-03.md)

复跑命令：

```text
bun src/diagnosis/production-preflight.cli.ts --live-sha <40-hex> \
  --json-out docs/design/openbot-diagnosis-p12-preflight-2026-09-03.json \
  --md-out docs/design/openbot-diagnosis-p12-preflight-2026-09-03.md
```

---

## 1. P5 复验结论

P12 在 P5 队列上复验了缺授权、租户错配、principal 冒用、过期 grant、撤销 grant。上述路径均返回 `rejected` 且不进入 pending。回执、重试耗尽与过期可审计。`delegationGuard` 是生产路径的必需注入；P5 路由本身只做 sessionDomain/kind 判定。

结论：**P5 进程内合同正式签收**。`DIAGNOSIS_DAIBAI_DELIVERY_ENABLED` 仍为 false。未接 live Da Bai，未写消息主链。

---

## 2. 生产依赖清单

| 依赖                      | 权威来源                                                        | Schema                         | 租户边界               | 故障行为                                | Timeout | 降级                   |
| ------------------------- | --------------------------------------------------------------- | ------------------------------ | ---------------------- | --------------------------------------- | ------- | ---------------------- |
| Composite Report reader   | 既有 CompositeDiagnosis 投影 + Session JSONL + Skill Invocation | `diagnosis.reports@1`          | server membership only | fail-closed unavailable                 | 3000ms  | 不得渲染为健康         |
| Audit persist             | `$CONFIG_DIR/diagnosis-audit/`                                  | append_only_audit_v1           | server membership only | fail-closed missing audit               | 2000ms  | 阻断写入、保留历史     |
| Quota store               | 注入的 windowed counter                                         | `windowed_counter/60000ms`     | server membership only | fail-closed 503                         | 1000ms  | 拒绝新查询             |
| Gateway auth / membership | 服务端 membership resolver                                      | trusted tenant from membership | server membership only | fail-closed unauthenticated             | 2000ms  | 拒绝客户端 tenant 声明 |
| Da Bai transport          | 仅 allowlist 注入                                               | `diagnosis.daibai.delivery@1`  | server membership only | reject 不入 pending，再 queue/expire    | 5000ms  | 保留回执               |
| Conversation state store  | 进程内可注入 store                                              | `conversation_diagnosis_run@1` | server membership only | 停在 WAITING_AUTHORIZATION              | 2000ms  | 禁止绑定 live chat     |
| Remediation executor      | 仅 allowlist 注入                                               | `remediation_execution@1`      | server membership only | unavailable 且 `appliedToRuntime=false` | 5000ms  | dry-run only           |

当前生产路径未注入 reader / audit / quota，预检按 unavailable fail-closed。

---

## 3. 可观测契约

每个 gate 必须具备：`success`、`error`、`latency`、`stale`、`authorization_denied`、`quota_exhausted`。

SLO 字段：查询延迟、巡检成功率、投送成功率、授权等待时长、Verification 成功率、误报率。缺失观测时 `completeness=empty`，健康渲染为 `incomplete` / `not_ready`，不得显示「正常」。

当前 P11 SLO `observed=null`、`completeness=empty`，因此 readiness 必须为 false。

---

## 4. Gate 审批矩阵

| Gate                                      | 默认  | 批准人                                          | 前置                                                     | 回滚                        | 审计                   |
| ----------------------------------------- | ----- | ----------------------------------------------- | -------------------------------------------------------- | --------------------------- | ---------------------- |
| `DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED`   | false | platform_security                               | reader/audit/quota 已注入且 SLO 完整                     | 保持 false                  | pending_human_approval |
| `DIAGNOSIS_REPORT_API_DEPLOYED`           | false | platform_security                               | adapters 已批、live pack 不得自注册、SLO 完整            | 保持 false 并撤销 live pack | pending_human_approval |
| `DIAGNOSIS_DAIBAI_DELIVERY_ENABLED`       | false | platform_security + enterprise_admin            | P5 已签、transport allowlist、delegation guard、SLO 完整 | 关 gate、停投送、保留回执   | pending_human_approval |
| `DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED` | false | platform_security + enterprise_admin + employee | executor allowlist、高风险人工批准、SLO 完整             | 关 gate、停新任务、保留审计 | pending_human_approval |

禁止隐式开启，禁止客户端参数开启。

---

## 5. P11 遗留反馈

- 运行容器 LIVE 曾观测为 `6d9ea1f2d5`。`releases.jsonl` 开放行现为 seq 58 / 同一 SHA。
- `RELEASE_RECORD.md` Latest cutover 仍写 seq 54 / `37cc40e51f`。账本与发布记录不一致，预检 fail-closed。
- seq 58 行 `tag=main`，缺少 `provenance/sha-6d9ea1f2d5` 锚点。
- 上述不一致未解决前，不得输出 Ready。

---

## 6. 未做

- 未打开任何生产 gate
- 未注册 `GATEWAY_METHOD_PACKS` / `coreGatewayHandlers` 的 diagnosis live 入口
- 未执行生产构建、发布、重启、灰度或流量切换
- 未把 candidate 快进成 origin/main
- 未改写 `RELEASE_RECORD.md` 或补 provenance tag
- 未接真实聊天、Doctor `--fix`、Channel restart

---

## 7. 仍需人类批准

- 把 diagnosis candidate 收敛到最新 `origin/main`（或把已验收增量合入 trunk）
- 对齐 LIVE / ledger / RELEASE_RECORD / provenance
- 注入并验收生产 reader / audit / quota
- 补齐 SLO 观测
- 之后才进入独立审批；审批通过后仍需另一次明确指令才能开 gate
