# OpenBot Diagnosis Platform — P3.8 生产适配器

Date: 2026-09-02

Status: **适配器已实现，默认关闭。P3.8 完成 ≠ Phase 3 完成 ≠ 生产部署 ≠ Diagnosis Platform 完成。**

Audience: Platform Architecture、Gateway、Security、SRE、Data Governance、QA

Task: `openbot-diagnosis-platform`

Related:

- [P3.7 生产接入评审](/design/openbot-diagnosis-p3.7-production-integration-review-2026-09-02)
- [Authority of Record](/design/openbot-diagnosis-authority-of-record-2026-09-02)

硬门禁：`DIAGNOSIS_REPORT_API_DEPLOYED=false`，`DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED=false`。不注册 live pack，不构建、发布、重启、灰度或切流量。文档只用占位符，不写真实凭据、主机名或生产配置值。

---

## 1. Feature gate

`resolveProductionAdapterDeps()`：

| 开关                   | 依赖                           | 结果                                |
| ---------------------- | ------------------------------ | ----------------------------------- |
| 默认 / `enabled=false` | 无                             | 进程内空 reader + 内存审计/配额     |
| `enabled=true`         | 缺 report/audit backend        | 拒绝 `production_adapters_required` |
| `enabled=true`         | 注入 projection + audit append | 生产适配器                          |

开启适配器不等于上线。live 注册仍只看 `DIAGNOSIS_REPORT_API_DEPLOYED`。

回滚：保持两个 flag 为 false；不要重启或切流量。

---

## 2. Reader

权威：已有 Composite Diagnosis 投影。`createProjectionAuthoritySource` 只包装注入快照，不是新库。

| 项       | 值                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------- |
| 存储类型 | `composite_diagnosis_projection_snapshot`                                                             |
| 连接     | host 注入 `ProductionReportAuthoritySource`                                                           |
| 密钥     | 无；禁止从 `process.env` 读生产 URI                                                                   |
| 校验     | schemaVersion=1、tenantId、generatedAt/maxAge、禁止 payload                                           |
| 故障     | missing / stale / tenant_mismatch / schema_incompatible → 丢弃或隐藏；存储故障 → `reader_unavailable` |
| 禁止     | Report DB、Skill Health DB、新诊断事实源                                                              |

---

## 3. Audit persist

| 项           | 值                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------- |
| 存储类型     | append-only sink                                                                                  |
| 预留 locator | `$CONFIG_DIR/diagnosis-audit/`                                                                    |
| 密钥来源     | 仅 host 注入 backend                                                                              |
| 保留         | 跟随平台审计保留策略（`platform-audit-retention`）                                                |
| 写入字段     | principal / tenant / mode / targetDigest / resultCount / decision / denyReason / redactionProfile |
| 失败关闭     | payload 拒绝抛错；`unavailable` 或 append reject → `persist()="unavailable"`，不记成功            |

查询链路继续 `await persist()`。无 `persistSync` 旁路。

---

## 4. Quota store

| 项       | 值                                                                                   |
| -------- | ------------------------------------------------------------------------------------ |
| 存储类型 | windowed counter                                                                     |
| 窗口     | `floor(now / windowMs)`                                                              |
| 默认     | 60s / tenant 64 / principal 16 / 并发 4                                              |
| 超限     | 先比较再提交计数；不把失败请求记入窗口                                               |
| 查询链路 | 有 `consumeWindow`/`releaseWindow` 时走异步窗口；默认内存 quota 仍用同步 `consume()` |
| 并发     | `consumeWindow` 持有 slot，查询结束或异常后 `releaseWindow`                          |
| 不可用   | 查询返回 `unavailable` / 503，不读 reader，不当无限配额                              |

---

## 5. 未做

- 未把 pack 加入 `GATEWAY_METHOD_PACKS` / manifest / `coreGatewayHandlers`
- 未实现真实 JSONL/DB 连接
- 未翻转部署开关
- 未生产构建、发布、重启、切流量
