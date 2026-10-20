# OpenBot Diagnosis Platform — P3.7 生产接入评审

Date: 2026-09-02

Status: **契约冻结与发布候选设计，不是生产部署批准。P3.7 完成 ≠ Phase 3 完成 ≠ 生产部署 ≠ Diagnosis Platform 完成。**

Audience: Platform Architecture、Gateway、Security、SRE、Data Governance、QA

Task: `openbot-diagnosis-platform`

Related:

- [Authority of Record](/design/openbot-diagnosis-authority-of-record-2026-09-02)
- [Adapter 矩阵](/design/openbot-diagnosis-adapter-matrix-2026-09-02)
- [一期垂直切片](/design/openbot-diagnosis-phase1-vertical-slice-2026-09-02)

硬门禁：本阶段不得执行生产构建、发布、重启或流量切换。`DIAGNOSIS_REPORT_API_DEPLOYED` 保持 `false`。

---

## 1. Auth contract

权威函数：`evaluateDiagnosisProductionAuth`。`resolveDiagnosisProductionAuth` 只负责取 membership，再交给该函数。

### 1.1 输入

| 字段                                        | 来源                             | 是否权威                                         |
| ------------------------------------------- | -------------------------------- | ------------------------------------------------ |
| `client.user` / `client.platformUserId`     | 已认证 gateway client            | 仅证明有身份；不能提供 tenant                    |
| `client.sessionDomain`                      | 服务端 session                   | 只决定是否给 `diagnosis.local_read`              |
| `client.sessionKind`                        | 服务端 session                   | 只识别 `platform-admin` / `platform-super-admin` |
| `membership.tenantId` / `membership.userId` | `resolveAuthoritativeMembership` | **唯一租户权威**                                 |
| `membership === "unavailable"`              | 认证存储失败                     | 失败关闭                                         |

下列来源 **禁止** 成为 `trusted.tenantId`：URL、query、body、header、`sessionTenantId`、`connect.tenantId`、`claimedTenantId`。它们最多作为伪造检测输入；与 membership 不一致则拒绝。

### 1.2 输出

成功时返回 `ProductionAuthContext`：

- `trusted.tenantId` = `membership.tenantId`
- `principal.tenantId` 必须与 trusted 一致
- `capabilities` 仅在需要时出现：`diagnosis.local_read`、`diagnosis.report_admin`

失败时返回 `null`。网关映射为 401，不授予隐式 `local_read`。

### 1.3 授权矩阵

| 身份                                      | membership tenant | 结果                                          |
| ----------------------------------------- | ----------------- | --------------------------------------------- |
| 无 client / 无身份                        | 任意              | `null`                                        |
| enterprise / employee member              | `tenant-a`        | tenant 用户，无 local_read                    |
| 未声明 `sessionDomain`                    | `null`            | `null`（失败关闭）                            |
| employee + tenant `null`                  | `null`            | 认证对象可建立，但查询层无 `local_read` → 403 |
| `sessionDomain=platform`                  | `null`            | `diagnosis.local_read`                        |
| `platform-admin` / `platform-super-admin` | `null`            | admin + local_read                            |
| 任意身份，含 platform-admin               | 认证存储不可用    | `null`                                        |

认证存储不可用时，不相信客户端自报的 `sessionKind`。必须先能读到 membership。

### 1.4 审计

认证失败记 `denyReason=unauthenticated` 或 `auth_store_unavailable` 语义（表现为 401）。审计行只有 principal/tenant/mode/目标摘要，不含 Evidence payload。

---

## 2. Reader contract

Composite Report **不是**新的事实库。权威仍是既有 PARTIAL 源上的只读投影。

| 来源                                | 状态                  | Diagnosis MAY                   | Diagnosis MUST NOT            |
| ----------------------------------- | --------------------- | ------------------------------- | ----------------------------- |
| 已构建的 `CompositeDiagnosisReport` | PARTIAL               | 经 `CompositeReportReader` 注入 | 新建 Report DB                |
| Session JSONL                       | PARTIAL               | 复用一期 metadata reader        | 复制消息正文                  |
| Skill invocation `events.jsonl`     | PARTIAL               | 只读                            | 新建 Skill Health DB / append |
| Agent/Tool observation JSONL        | PARTIAL               | 只读                            | 虚构 `type=agent_runner`      |
| Doctor / Channel                    | PARTIAL，4.1/4.2 未签 | 只读合同                        | `--fix` / channel restart     |

生产接口仍是 `ProductionQueryAdapterDeps.reader: CompositeReportReader`。P3.7 包装器 `wrapProductionCompositeReportReader` 只做分类，不改权威。

| 故障          | 处理                                            |
| ------------- | ----------------------------------------------- |
| 数据不存在    | 列表跳过；定向 query/get 与越权同一 `forbidden` |
| 数据过期      | `generatedAt` 超过 `maxAgeMs` 则丢弃 / 隐藏     |
| 租户不一致    | 丢弃或隐藏为 `forbidden`，不泄露存在性          |
| schema 不兼容 | 未知 `schemaVersion` 拒绝，不降级，定向隐藏     |
| reader 不可用 | 失败关闭，`unavailable` → 503，不编造报告       |

禁止新增并行 Report DB、Skill Health DB 或诊断事实源。

---

## 3. Audit contract

生产接口：`ProductionAuditPersistSink.persist(): Promise<...>`。`ProductionQueryAuditSink.record` 可为异步；查询 / get / API dispatch 必须 `await persist()` 完成后再返回响应。禁止同步 `persistSync` 回退把纯异步实现当成不可用。

允许字段：`principalId` / `principalKind` / `tenantId` / `mode` / `targetDigest` / `resultCount` / `decision` / `denyReason` / `redactionProfile`。

禁止字段：Evidence payload、消息正文、工具输出、模型摘要，以及 `FORBIDDEN_REPORT_PAYLOAD_KEYS` / `prompt` / `toolOutput` / `modelSummary`。

| 写入结果                | 策略                                                      |
| ----------------------- | --------------------------------------------------------- |
| allow 路径 persist 失败 | **失败关闭**：不返回 items，公开原因 `unavailable`（503） |
| deny 路径 persist 失败  | 仍向客户端 deny，不升级为 500                             |

---

## 4. Quota contract

生产接口：`ProductionQuotaStore`。

| 项            | 值                                      |
| ------------- | --------------------------------------- |
| 窗口          | 60s（`PRODUCTION_QUOTA_WINDOW_MS`）     |
| per-tenant    | 64（沿用 5.4）                          |
| per-principal | 16（沿用 5.4）                          |
| 并发          | 4（`PRODUCTION_QUOTA_MAX_CONCURRENCY`） |
| 超限          | `rate_limited` → 429                    |
| 存储不可用    | **失败关闭** → `unavailable`（503）     |

配额在授权之后、读报告之前消耗。超限与存储故障都不返回报告正文。

---

## 5. Deployment gates

发布候选（**未批准上线**）：

| 项        | 值                                                       |
| --------- | -------------------------------------------------------- |
| pack      | `diagnosis-reports`                                      |
| methods   | `diagnosis.reports.query` / `diagnosis.reports.get`      |
| scope     | `operator.read`                                          |
| 开关      | `DIAGNOSIS_REPORT_API_DEPLOYED=false`                    |
| live 注册 | 否                                                       |
| 灰度      | `not_authorized`                                         |
| 回滚      | 保持 flag=false；不得发布、重启、切流量                  |
| 兼容      | schemaVersion=1；cursor `pq1.`；tenant 只来自 membership |

配置开关本阶段只有代码常量，不读 `process.env`。把 flag 改为 `true` 需要单独的上线批准，且必须先通过本评审复验。

兼容性检查项：未知 schema 400；越权与不存在同为 403；配额 429；审计/配额/reader 不可用 503；认证失败 401。

---

## 6. 明确未做

- 未把 pack 注册进 live `GATEWAY_METHOD_PACKS`
- 未实现真实审计库 / 配额库 / 报告库
- 未实现 `diagnose()`
- 未勾选 4.1 / 4.2
- 未生产构建、发布、重启、切流量
