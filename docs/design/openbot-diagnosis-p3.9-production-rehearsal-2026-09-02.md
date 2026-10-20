# OpenBot Diagnosis Platform — P3.9 生产配置注入预演

Date: 2026-09-02

Status: **预演与测试已落地，默认关闭。P3.9 完成 ≠ Phase 3 完成 ≠ 生产部署 ≠ Diagnosis Platform 完成。**

Audience: Platform Architecture、Gateway、Security、SRE、Data Governance、QA

Task: `openbot-diagnosis-platform`

Related:

- [P3.8 生产适配器](/design/openbot-diagnosis-p3.8-production-adapters-2026-09-02)
- [P3.7 生产接入评审](/design/openbot-diagnosis-p3.7-production-integration-review-2026-09-02)

硬门禁：`DIAGNOSIS_REPORT_API_DEPLOYED=false`，`DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED=false`。不注册 live pack，不构建、发布、重启、灰度、切流量或自动修复。配置只用占位符 kind / locator，不写真实凭据、主机名或生产 URL。

---

## 1. 配置字段

`parseDiagnosisProductionAdapterConfig()` 解析诊断生产适配器配置。缺失输入回落到默认关闭对象。

| 字段                         | 默认    | 启用时                                                                        |
| ---------------------------- | ------- | ----------------------------------------------------------------------------- |
| `enabled`                    | `false` | 必须为 `true` 才会接线生产 backend                                            |
| `reportSourceBackend`        | `null`  | `{ kind: "composite_diagnosis_projection_snapshot" }`                         |
| `auditPersistBackend`        | `null`  | `{ kind: "append_only_audit_sink", locator: "$CONFIG_DIR/diagnosis-audit/" }` |
| `quotaBackend`               | `null`  | `{ kind: "windowed_counter" }`                                                |
| `readerMaxAgeMs`             | `null`  | 可选正整数，写入 reader policy                                                |
| `quotaWindow.windowMs`       | `60000` | 正整数                                                                        |
| `quotaWindow.tenantLimit`    | `64`    | 正整数                                                                        |
| `quotaWindow.principalLimit` | `16`    | 正整数                                                                        |
| `quotaWindow.maxConcurrency` | `4`     | 正整数                                                                        |

Fail-closed：

- 输入不是对象、字段类型错误、kind 不匹配
- `enabled=true` 但 report / audit / quota backend 任一缺失
- 出现 `url` / `host` / `password` / `token` 等密钥字段，或值含 `http(s)://`、主机名、`process.env`

`resolveProductionAdapterDepsFromConfig()` 把解析结果交给 `resolveProductionAdapterDeps`：

- `enabled=false`：进程内空 reader + 内存审计 + 同步 `consume()`
- `enabled=true`：必须注入 report / audit / quota 对象；quota 走异步 `consumeWindow` / `releaseWindow`；audit `await persist()`；reader 做 schema / tenant / maxAge / payload 检查

不新增 Report DB、Skill Health DB 或平行事实源。

---

## 2. Gateway 注册预演

`previewDiagnosisLivePackRegistration()` 是纯函数 dry-run，**不修改** `GATEWAY_METHOD_PACKS`、manifest 或 `coreGatewayHandlers`。`wouldRegister` 恒为 `false`。

| 条件                                                                          | 结果                                                  |
| ----------------------------------------------------------------------------- | ----------------------------------------------------- |
| `DIAGNOSIS_REPORT_API_DEPLOYED=false` 且 adapter 未启用或不完整以外的默认路径 | `hold` / `deploy_flag_false`                          |
| adapter 未启用（即使假设 deploy flag 为 true）                                | `hold` / `adapters_disabled`                          |
| adapter 启用但 auth / reader / audit / quota 任一缺失                         | `reject`                                              |
| 上述条件都满足                                                                | `candidate`：只生成可注册候选，不写入 live pack table |

候选清单：`diagnosis-reports`，方法 `diagnosis.reports.query` / `diagnosis.reports.get`，`schemaVersion=1`，cursor prefix `pq1.`，scope `operator.read`。

---

## 3. Readiness predicate 与回滚

`evaluateDiagnosisProductionReadiness()` 输出 candidate manifest / readiness report，并核对：

- `schemaVersion=1`
- cursor prefix `pq1.`
- `DIAGNOSIS_PRODUCTION_AUTH_MATRIX`
- 脱敏 profile：`administrator` / `user` / `system_local`
- API 状态映射：200 / 400 / 401 / 403 / 404 / 429 / 503

机器可检查：`isDiagnosisProductionRehearsalReady(report)`。

当前树满足预演就绪时必须同时成立：

- `readyForProductionCutover === false`
- deploy flag 与 adapter gate 均为 false
- live pack 未注册
- 解析后的配置 `enabled === false`
- rollback 五项均为 true

回滚门禁（禁止执行，只记录）：

- 保持 `DIAGNOSIS_REPORT_API_DEPLOYED=false`
- 禁止注册 live pack
- 禁止重启
- 禁止切流量
- 禁止自动修复

---

## 4. 未做

- 未把 pack 加入 `GATEWAY_METHOD_PACKS` / manifest / `coreGatewayHandlers`
- 未翻转部署开关或 adapter gate
- 未写入真实凭据、生产 URL 或主机名
- 未生产构建、发布、重启、灰度或切流量
