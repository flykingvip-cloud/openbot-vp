# Agent Growth 云端多租户架构专家评审与实施路线 v2

Revision: **v2**

Updated: 2026-07-30

Status: **Draft v2 - 已吸收有条件批准意见 - Pending re-review**

Review disposition: **架构方向有条件批准；不批准按 v1 直接实施**

Implementation gate: **BLOCKED**。在本文复审通过、三个后续实施规格分别获批且对应阶段门禁满足前，不得开始编码、创建生产数据库 schema、提交云资源、启用云端写入、配置双写或扩展 Gateway 写实例。

Audience: Platform Architecture、Enterprise Identity、Agent Runtime、Growth、Security、Data Governance、SRE、QA、Product

Task: `agent-growth-lifecycle`

Related:

- [OpenBot Commercial Runtime 套餐计费落地方案](/design/openbot-commercial-runtime-billing-plan-2026-06-23)
- [平台端统一 UI 规范](/design/platform-ui-spec)
- `.kiro/specs/agent-growth-lifecycle/`
- `.kiro/specs/operational-identity-governance/`
- `src/gateway/agent-growth/**`
- `src/gateway/platform-auth/**`
- `src/gateway/enterprise-seat-assets-store.ts`
- `src/gateway/model-entitlement/resolve-agent-run-scope.ts`

---

## 0. 执行摘要

专家结论是：**有条件批准总体架构方向，但不批准按 v1 直接实施；实施状态继续保持 `BLOCKED`。**

代码核验支持这一结论。当前本地单 Gateway 已具备运营指标累计、Growth 投影、Badge、Prelude 和 Report 等成长闭环能力，但它仍依赖本地 JSON、进程内锁、全局 Agent roster、非权威 tenant hint 和单进程广播。云端多租户所需的 active membership、canonical Agent Registry、统一 ACL、共享事实源、事务幂等、耐久失败缓冲、RLS、outbox、迁移和多实例事件扇出尚未形成完整生产能力。

v2 对 v1 作出以下实质修订：

1. 不再把 `AgentInstance` 直接定义为 canonical 数字资产。先通过 ADR 冻结 `AgentDefinition`、`AgentAsset`、`AgentDeployment` 和 `AgentSnapshot`/`AgentRevision` 的语义；v2 暂用 `AgentAsset` 表示稳定业务资产身份。
2. 一期 owner 只允许 `membership-owned` 和 `seat-owned`；`team-owned`、`enterprise-owned` 延后。
3. active membership 选择成为平台安全前置：session/token 必须保存并验证权威 `membershipId + enterpriseId`，禁止由用户的第一条 membership 推导当前企业。
4. Growth PostgreSQL 不能单独上线。共享 Identity、Agent Registry 和 ACL 控制面必须先成为跨实例权威事实源，或与 Growth 数据面处于同一发布门禁且先于 Growth 写入启用。
5. 不再直接把现有 `runId` 当成最终幂等键。事件契约明确区分 `logicalRunId`、`attemptId` 和 `completionEventId`。
6. 回复链保持 fail-open，但 observation 不得 fail-silent。引入 `CompletionJournal` 耐久接口、后台重放、quarantine、积压指标和告警。
7. 旧数据只导入 baseline 与 snapshot，不伪造不存在的逐次 observation。
8. Growth 明确是 Agent 能力与运行质量指标，不是员工绩效评分。
9. 实施路线改为 Phase -1 至 Phase 4，并在复审后拆成三个独立实施规格。

本稿仍是**复审输入**，不是实施授权。

## 1. 本轮评审目标与边界

### 1.1 评审目标

本轮请求专家确认：

- v2 是否准确吸收有条件批准意见。
- Agent 术语、active membership 和共享控制面是否构成正确的安全前置。
- Growth Application Boundary、事件身份和故障策略是否足以进入独立规格设计。
- PostgreSQL、RLS、outbox、baseline migration 和多实例门禁是否顺序正确。
- 产品治理、基础安全与商业能力的边界是否合理。
- 三个后续实施规格的责任边界是否清晰。

### 1.2 本轮只做什么

本轮只修订架构评审与实施路线：

```text
Agent run 完成
  -> Terminal Completion Event
  -> Growth Application Service
  -> Growth Observation
  -> Operational Metrics
  -> Growth Status
  -> Transactional Outbox
  -> 授权查询、实时通知与受治理聚合
```

### 1.3 本轮不做什么

在专家复审前，本轮不：

- 修改生产代码或测试。
- 创建三个实施规格目录或实施 tasks。
- 创建或迁移生产数据库表。
- 创建、变更或提交云资源。
- 启用本地与云端双写。
- 扩展 Gateway 写实例。
- 新建独立 Growth 微服务。
- 开放跨企业共享同一 Agent 资产。
- 开放企业级或跨企业 Growth 聚合。
- 将原始 prompt、回复正文、工具输入或工具输出写入 Growth。
- 宣称当前 UI 或云化测试全绿。

## 2. 专家审核结论与裁决矩阵

### 2.1 可以批准的架构方向

| 决策                                                | v2 处理                                                  |
| --------------------------------------------------- | -------------------------------------------------------- |
| Growth 跟随稳定 Agent 资产                          | 保留；暂称 `AgentAsset`，等待 ADR 冻结术语               |
| enterprise 与 canonical Agent 共同构成数据边界      | 保留；所有业务读取和写入都必须携带二者                   |
| 用户、membership、employee、seat 不进入 Growth 主键 | 保留；它们只进入所有权、访问控制和审计事实               |
| 身份与权限由服务端解析                              | 保留；客户端 tenant/owner 只可表达意图，不可成为授权事实 |
| canonical ID 与企业内 alias 分离                    | 保留；legacy `agentId` 通过企业内 resolver 映射          |
| 云端只有一个 authoritative repository               | 保留；禁止长期双主                                       |
| PostgreSQL 事务、RLS、版本投影和 outbox             | 保留为目标方向，不视为已批准 schema                      |
| Growth Application Service 初期与 Gateway 同进程    | 保留；暂不拆微服务                                       |
| tenant-by-tenant cutover、quarantine 和 canary      | 保留；先单企业、单 Agent                                 |
| 状态外置前禁止多 Gateway 写实例                     | 保留为硬门禁                                             |

### 2.2 有条件批准

| 决策                              | 批准条件                                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 共享 PostgreSQL schema + RLS      | Identity、Agent Registry、ACL 已成为共享权威控制面，且 RLS 上下文只来自已验证 session/service principal          |
| canonical Agent 身份              | 先通过术语 ADR；v2 推荐使用 `AgentAsset`，避免复用已有 `AgentInstance` 运行挂载语义                              |
| owner 模型                        | 一期仅 `membership-owned`、`seat-owned`；其他 owner 等对应 Registry 与治理规则成立后再评审                       |
| 扩展现有 `EnterpriseAccessPolicy` | 必须决定 extension 或 replacement，并补齐 membership、service principal、deny、细粒度 permission、审计和迁移语义 |
| run 幂等                          | 必须先冻结 logical run、attempt、terminal completion 和 correction 契约                                          |
| fail-open                         | 必须有耐久 journal、重放、积压告警和明确 RPO；禁止空 catch 静默丢 observation                                    |
| 企业聚合                          | 必须完成可见性、最小 cohort、保留、纠错、删除和反向识别风险评审                                                  |

### 2.3 当前不批准

以下方案明确不进入实施：

- 按 v1 直接开始 Phase 0 编码。
- 一期同时支持 membership、seat、team、enterprise 四类 owner。
- 把 `AgentInstance` 未经 ADR 直接定义成 canonical Agent 身份。
- 仅将 Growth 上 PostgreSQL，而 membership、Registry、owner binding 和 ACL 仍由各 Gateway 本地文件提供。
- 直接把现有 `runId` 当作最终幂等键。
- 把 attempt failure 当作逻辑任务最终失败累计。
- 数据库异常时以 `.catch(() => {})` 静默丢弃 observation。
- 通过用户的第一条 membership 选择当前企业。
- 信任客户端提交的 tenant、owner 或授权主体。
- 当前阶段扩展多实例、开放企业聚合或跨企业聚合。
- 新建独立 Growth 微服务。
- 长期保留本地与 PostgreSQL 双主。
- 用旧累计 metrics 伪造逐次历史 observation。

## 3. 当前代码证据与成熟度

### 3.1 已核验事实

| 事实                                                                       | 代码证据                                                                                                                                                                                   | 审核含义                                                          |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| runner 已生成 `runId`，但未传给 Growth                                     | `src/auto-reply/reply/agent-runner-execution.ts:131-167`                                                                                                                                   | 现有 run 身份不能直接证明 Growth 幂等                             |
| Growth 调用只传 success 和工具计数，失败被空 catch 吞掉                    | `src/auto-reply/reply/agent-runner-execution.ts:144-167`                                                                                                                                   | 当前是 reply fail-open 且 data fail-silent                        |
| 运营指标使用本地 JSON 与模块级进程锁                                       | `src/gateway/agent-growth/operational-metrics-store.ts:17-18`、`src/gateway/agent-growth/operational-metrics-store.ts:77-95`                                                               | 只适合当前单进程写模型                                            |
| Growth 状态使用独立本地 JSON 与进程锁                                      | `src/gateway/agent-growth/store.ts:17-58`                                                                                                                                                  | metrics/status 尚无事务边界                                       |
| `agents.get-growth-status` 在 GET 中执行同步投影写入                       | `src/gateway/server-methods/agent-growth.ts:191-207`                                                                                                                                       | 读取不是纯读，审计与失败语义混杂                                  |
| Working DNA 查询遍历全局 Agent roster                                      | `src/gateway/server-methods/agent-growth.ts:272-309`                                                                                                                                       | 尚无企业边界和统一访问上下文                                      |
| 既有 `AgentInstance` 是 Definition 挂载到 seat/space/tenant 的运行实例     | `docs/design/openbot-enterprise-agent-asset-binding-and-handover-plan-2026-04-14.md:252-255`、`docs/design/openbot-enterprise-agent-asset-binding-and-handover-plan-2026-04-14.md:319-338` | 与 v1 canonical 资产定义冲突                                      |
| `findMembershipByUserId` 返回第一条 membership                             | `src/gateway/platform-auth/memberships.ts:85-90`                                                                                                                                           | 多企业用户可能被错误选择企业上下文                                |
| Billing scope 使用该 first-membership 路径                                 | `src/gateway/billing/scope.ts:99-128`                                                                                                                                                      | 问题不是 Growth 私有问题，必须平台级修复                          |
| Gateway client 无权威 membership binding                                   | `src/gateway/server-methods/types.ts:16-27`                                                                                                                                                | `sessionTenantId` 只能是 hint，不能用于授权                       |
| Platform Auth 仍是本地 JSON 和模块内写队列                                 | `src/gateway/platform-auth/store.ts:23`、`src/gateway/platform-auth/store.ts:317-355`                                                                                                      | 尚不是多实例共享身份事实源                                        |
| Seat Assets 仅支持本地 JSON/SQLite                                         | `src/gateway/enterprise-seat-assets-backend.ts:32-173`                                                                                                                                     | owner/ACL 在多实例间不能天然一致                                  |
| Model Entitlement 仍是本地 JSON 和锁                                       | `src/gateway/model-entitlement/enterprise-model-entitlement-store.ts:28-91`                                                                                                                | 授权链整体尚未外置                                                |
| 现有 ACL subject 只有 employee/seat，action 只有 read/write/execute/manage | `src/gateway/enterprise-seat-assets-store.ts:74-84`                                                                                                                                        | 不能直接宣称已覆盖 membership/service principal/Growth permission |
| Agent create 直接使用 `params.tenantId` 并强制岗位所有、shared             | `src/gateway/server-methods/agents.ts:599-704`                                                                                                                                             | 尚无 membership-owned 企业个人 Agent 语义                         |
| Fly 配置为单 app process group、至少一台 machine，并挂载 `/data`           | `fly.toml:17-34`                                                                                                                                                                           | 配置仍依赖本地持久卷；该文件不能证明实际线上 machine 数量         |
| Growth Badge 和 Prelude 代码存在                                           | `ui/src/ui/ports/employee/views/workbench-growth-badge.ts:16-49`、`ui/src/ui/ports/employee/views/workbench-stage-growth-prelude.ts:1-8`                                                   | 用户功能真实存在，但不等于测试全绿                                |

### 3.2 当前成熟度矩阵

| 能力                                  | 当前成熟度      | v2 审核判断                                     |
| ------------------------------------- | --------------- | ----------------------------------------------- |
| 本地运营指标累计                      | 已实现          | 单进程可用；无 event identity 幂等              |
| Growth 投影与状态                     | 已实现          | 算法可复用；持久化仍是本地 JSON                 |
| Badge、Prelude、Report                | 已实现/部分验证 | 功能存在；当前测试基线不能宣称全绿              |
| Platform User、Enterprise、Membership | 部分实现        | 实体存在；存储和 active membership 不适合多实例 |
| Seat ownership、资产绑定、ACL         | 部分实现        | 只覆盖 employee/seat 和粗粒度 action            |
| 企业成员个人多 Agent ownership        | 未完整实现      | 企业 Agent 当前被强制 position-owned/shared     |
| canonical Agent Registry              | 仅方案          | 生产代码没有 `AgentAsset` registry              |
| 统一 `AgentAccessContext`             | 仅方案          | 生产请求尚无权威 membership context             |
| Growth Application/Repository 边界    | 仅方案          | runner、store、RPC 仍直接耦合                   |
| logical run/completion 幂等           | 未实现          | `runId` 存在但未传给 Growth                     |
| PostgreSQL、RLS、transactional outbox | 未实现          | 尚无生产实现                                    |
| tenant-aware 实时事件                 | 未实现          | 当前只有进程内广播                              |
| baseline/import epoch/rollback 工具   | 未实现          | 只有设计方向                                    |
| 多 Gateway 写实例                     | 不具备条件      | 身份、状态、ACL 和 fanout 尚未外置              |
| SLO、容量、保留与商业政策             | 待决策          | 必须在 Migration & SRE 规格中量化               |

### 3.3 UI 测试证据说明

专家报告的定向结果是 **42 通过、2 失败**，两个失败位于 Prelude UI 测试，表现为当前文案/CTA 与旧断言不一致。相关断言位于 `ui/src/ui/ports/employee/views/workbench-stage-growth-prelude.node.test.ts:69-99`。

本次 v2 修订只做了只读代码核验，**没有独立重跑该测试命令**。因此：

- 42/2 只记录为专家提供的测试证据。
- 本文不宣称 Growth UI 全量测试已通过。
- 后续规格必须记录 commit、命令、环境、时间和原始测试报告。
- 在实现前必须决定是产品文案回归，还是旧断言需要更新，再恢复目标测试全绿。

## 4. 不可破坏的架构原则

后续三个规格都必须遵守以下原则：

1. **稳定资产原则**：Growth 跟随稳定的 `AgentAsset`，不跟随当前用户、employee、seat、部署实例或操作者。
2. **双边界原则**：所有 Growth 数据以 `(enterpriseId, agentAssetId)` 为边界；即使 `agentAssetId` 全局唯一，也不能省略 enterprise 过滤和约束。
3. **服务端授权原则**：tenant、membership、owner 和 permission 只能由服务端从已验证 session/service principal 解析。
4. **单一权威原则**：一个企业在任意时刻只能有一个 authoritative Growth repository。
5. **控制面先行原则**：共享 Identity、Registry 和 ACL 未权威化前，Growth PostgreSQL 不得启用生产写入。
6. **事务原则**：observation、metrics、status 和 outbox 的同一业务变更必须在一个事务中提交。
7. **幂等与可修正原则**：精确重复不重复累计；错误结果通过 correction 事件修正，不能被第一次 `ON CONFLICT DO NOTHING` 永久锁死。
8. **回复 fail-open、数据不静默原则**：Growth 故障不应无限阻塞用户回复，但任何未持久化 observation 都必须可观测并触发告警。
9. **禁止长期双主原则**：本地 JSON 与 PostgreSQL 不得长期同时成为可写事实源。
10. **多实例门禁原则**：身份、ACL、Growth、journal、outbox relay 和事件扇出全部外置前，不允许多个 Gateway 写实例。
11. **同进程起步原则**：Growth Application Service 初期仍与 Gateway 同进程，不新建微服务。
12. **非绩效评分原则**：Growth 衡量 Agent 能力和运行质量，不是员工绩效评分或人事决策输入。

## 5. Agent 术语 ADR 前置

### 5.1 冲突说明

v1 使用 `AgentInstance` 表示不可变 canonical 资产；既有企业资产架构已用该词表示“某个 `AgentDefinition` 挂载到 seat、space 或 tenant 下的运行实例”。同名不同义会污染 schema、API、审计和迁移，不能带入实施。

### 5.2 v2 推荐四层模型

| 名称                              | v2 推荐语义                                           | Growth 是否归属该层               |
| --------------------------------- | ----------------------------------------------------- | --------------------------------- |
| `AgentDefinition`                 | 能力、提示词、工具与策略的定义                        | 否                                |
| `AgentAsset`                      | 企业内稳定、可转移、不可复用的 canonical 业务资产身份 | **是**                            |
| `AgentDeployment`                 | AgentAsset 在 seat、space、runtime 或环境中的运行挂载 | 否                                |
| `AgentSnapshot` / `AgentRevision` | 可审计、比较和回滚的不可变版本                        | 否；只作为 observation 的版本维度 |

推荐保留既有 `AgentInstance` 的运行挂载含义，或在单独 ADR 中统一迁移为 `AgentDeployment`。在 ADR 通过前，任何 schema 都不得创建 `agent_instance_id` 作为 Growth canonical key。

### 5.3 ADR 必须冻结的内容

ADR 至少回答：

- `AgentAsset` 是否为最终名称。
- `AgentInstance` 是保留、废止还是迁移为 `AgentDeployment`。
- 一个 AgentAsset 能否同时有多个 deployment。
- `AgentDefinition` 和 `AgentRevision` 的版本关系。
- AgentAsset 归档、转移和删除的生命周期。
- 是否禁止跨 enterprise 转移；v2 默认禁止。
- legacy `agentId`、配置目录和 AgentAsset 的映射规则。
- mapping 冲突、缺失、重复和孤儿数据的 quarantine 策略。

### 5.4 canonical key 与 alias

目标模型使用：

```text
Growth boundary = enterpriseId + agentAssetId
Enterprise-local alias = enterpriseId + agentSlug
Legacy resolver = enterpriseId + legacyAgentId -> agentAssetId
```

`agentSlug` 和 legacy `agentId` 只能用于企业内查找，不能作为云端 Growth 主键。无法唯一解析的 legacy Agent 必须进入 quarantine，禁止猜测企业或 owner。

## 6. Active membership 是平台安全前置

### 6.1 当前风险

一个 `PlatformAuthUser` 可以加入多个 enterprise，但当前 `findMembershipByUserId` 返回第一条匹配 membership；Billing scope 也使用该路径。与此同时，`GatewayClient` 没有经过认证的 `membershipId`，只有 user、session domain 和明确非权威的 tenant hint。

这会导致同一个用户在不同实例、不同对象枚举顺序或不同请求路径中得到不一致的企业上下文。该问题可能影响 Billing、Agent ownership、ACL 和 Growth，不能由 Growth 模块私自修补。

### 6.2 必须建立的 active membership 流程

1. 用户登录或切换企业时显式选择 active membership。
2. 服务端验证 membership：存在、active、属于当前 platform user、绑定目标 enterprise。
3. session/token 保存权威 `membershipId + enterpriseId`，并包含可撤销或可重新验证的 session 标识。
4. 每次 enterprise-scoped 请求重新验证 membership 仍有效，或使用有明确失效上界的权威缓存。
5. URL、header、RPC 参数和 `sessionTenantId` 只能表达路由意图，必须与权威 session context 一致。
6. 禁止通过“用户的第一条 membership”推导当前 enterprise。
7. 切换 enterprise 必须创建或更新明确的 active context，并写安全审计。
8. membership 被停用、移除或企业被冻结后，相关 session 必须失效或立即拒绝。

### 6.3 服务端访问上下文

统一 resolver 应构造类似以下概念对象：

```ts
type AgentAccessContext = {
  requestId: string;
  enterpriseId: string;
  actor:
    | {
        kind: "membership";
        platformUserId: string;
        membershipId: string;
      }
    | {
        kind: "service_principal";
        servicePrincipalId: string;
        onBehalfOfMembershipId?: string;
      };
  sessionId?: string;
  permissions: string[];
};
```

约束：

- 客户端不能直接构造该对象。
- `enterpriseId` 必须来自已验证 actor，不来自裸参数。
- runtime、cron、channel、projector、migration 和 outbox relay 使用不同 service principal。
- `onBehalfOfMembershipId` 只用于审计和收窄授权，不能扩大 service principal 权限。
- 未授权访问与不存在对象对外使用一致的非泄漏响应语义。

### 6.4 共享发布门禁

active membership 修复必须覆盖所有依赖企业上下文的消费者，包括 Billing、Agent create、entitlement 和 Growth。只修 Growth 会留下相同的串租户根因。

## 7. 共享 Identity、Agent Registry 与 ACL 控制面

### 7.1 为什么不能只迁移 Growth

如果 Growth 使用 PostgreSQL，而 membership、Agent Registry、owner binding 和 ACL 仍由每个 Gateway 的本地 JSON/SQLite 提供：

- 数据库无法验证 Agent 与 enterprise、owner 的权威关系。
- 不同 Gateway 可能构造不同的 `AgentAccessContext`。
- RLS tenant context 来源并不权威。
- Growth 数据可能一致，但“谁能读写”仍不一致。
- 所有权转移、membership 撤销和 ACL 变更不能可靠传播到所有实例。

因此，共享控制面不是 Growth 的可选依赖，而是 Growth 云端数据面的安全前置。

### 7.2 最小共享控制面

Phase -1 至少形成以下跨实例权威事实：

- Platform user、enterprise、membership 和 active session binding。
- AgentAsset、enterprise-local alias 和 legacy resolver。
- AgentDeployment 与版本引用。
- 当前 owner binding 与 owner 历史。
- Agent 访问策略、deny/allow、条件和审计。
- service principal 身份和最小权限。
- membership、AgentAsset、owner 和 policy 的状态变更事件或一致性刷新机制。

具体实现可以共享同一 PostgreSQL 集群，也可以由独立权威服务提供，但不能继续由各 Gateway 私有文件各自决定。

### 7.3 一期 owner 范围

一期只批准：

```text
membership-owned
seat-owned
```

| Owner      | 用途               | 生命周期                                                |
| ---------- | ------------------ | ------------------------------------------------------- |
| membership | 企业成员个人 Agent | 跟随 membership；离职时按治理策略转移、导出、归档或删除 |
| seat       | 岗位共享 Agent     | 跟随岗位；人员更换不改变 AgentAsset                     |

暂不批准：

- `team-owned`：等待 Team Registry、管理员边界和最小 cohort 治理。
- `enterprise-owned`：等待企业公共资产管理、委托管理和聚合可见性规则。

延后 owner 不得通过字符串扩展或临时 owner ID 绕过正式模型。

### 7.4 Ownership 与 access 分离

owner binding 说明资产归属，不等于所有使用权限。概念记录应包含：

```text
enterprise_id
agent_asset_id
owner_type
owner_id
valid_from
valid_to
changed_by_actor_id
change_reason
audit_id
```

所有权转移必须：

1. 关闭旧 binding。
2. 创建新 binding。
3. 保持同一 `agentAssetId` 和 Growth 历史。
4. 重新计算 access policies、凭证和 connector 授权。
5. 写入不可抵赖审计。
6. 不复制或清零 Growth。

### 7.5 ACL 统一而非叠加

现有 `EnterpriseAccessPolicy` 只有 employee/seat subject 和 read/write/execute/manage action。后续规格必须先裁决：

- 扩展现有 policy，或
- 以兼容迁移替换为统一 policy。

不允许再创建第三套 Growth-only ACL。目标能力至少覆盖：

- subject：membership、seat、service principal；team/enterprise 延后。
- resource：AgentAsset、AgentDeployment、Growth status、observation、aggregate。
- permission：读取状态、写入 observation、修正、repair、管理、聚合、导出。
- effect：allow 与 deny。
- condition：enterprise、owner scope、delegation、时间、风险和审计理由。
- migration：现有 employee policy 如何映射到 membership。

## 8. Growth Application Boundary

### 8.1 目标

在不急于更换数据库的情况下，先把身份、授权、业务语义和持久化解耦。Phase 1 仍运行在本地单 Gateway，但所有 Growth 入口必须经过统一 application boundary。

### 8.2 概念组件

```text
RPC / Runner / Command
  -> AgentAccessContext Resolver
  -> GrowthApplicationService
       -> GrowthRepository
       -> CompletionJournal
       -> GrowthEventPublisher abstraction
```

职责：

- `AgentAccessContext Resolver`：解析权威 enterprise、actor、membership、AgentAsset 和 permission。
- `GrowthApplicationService`：执行幂等、授权、事务边界、projector 和审计语义。
- `GrowthRepository`：抽象 observation、metrics、status、baseline 和 outbox 的一致性读写。
- `LocalGrowthRepository`：Phase 1 的本地单实例实现，不宣称支持多实例。
- `PostgresGrowthRepository`：Phase 2 的共享实现。
- `CompletionJournal`：主 repository 不可用时的耐久接收与重放接口。

### 8.3 必须收口的入口

- runner terminal completion。
- 查询 Growth status、metrics 和 history。
- milestone、反馈和 correction。
- repair/recompute。
- migration baseline import。
- projector 与 outbox relay service principal。

### 8.4 纯读与显式修复

`GET` 必须纯读，不再因为读取触发 sync 或写状态。任何 repair/recompute 都必须：

- 使用 command 方法。
- 有独立 permission。
- 携带 actor、reason、request ID 和 audit ID。
- 产生可追踪的 projection version。
- 明确是否产生 outbox 事件。

### 8.5 单一 repository 配置

任一 enterprise 在同一时刻只能处于以下一种模式：

```text
local-authoritative
postgres-authoritative
```

不得存在 `dual-authoritative`。影子比对只能读非权威副本，不得由副本接受业务写入或发布用户可见事件。

## 9. Logical run、attempt 与 completion 事件契约

### 9.1 事件身份

每个 Growth 事件使用组合身份：

```text
event identity = enterpriseId + agentAssetId + eventType + sourceEventId
```

数据库应使用独立列和组合唯一约束，不依赖易碰撞的字符串拼接。

通用字段：

```text
enterprise_id
agent_asset_id
event_type
source_event_id
logical_run_id nullable
attempt_id nullable
completion_event_id nullable
occurred_at
recorded_at
payload_version
actor_type
actor_id
on_behalf_of_membership_id nullable
correlation_id
```

### 9.2 三类 run 身份

| ID                  | 含义                                                | 稳定范围                                            |
| ------------------- | --------------------------------------------------- | --------------------------------------------------- |
| `logicalRunId`      | 一次用户可感知的逻辑任务                            | fallback、受控 retry 和同一任务 resume 期间保持不变 |
| `attemptId`         | 一次具体 provider/model/runtime attempt             | 每次 attempt 唯一                                   |
| `completionEventId` | 编排器确认逻辑任务最终完成后产生的 terminal outcome | 同一 terminal completion 的重放保持不变             |

### 9.3 Terminal completion 规则

1. fallback 或 retry 中的单次失败只产生 attempt 事实，不累计任务最终失败。
2. 只有编排器确认成功，或所有允许的 fallback/retry 最终耗尽后，才产生 terminal completion。
3. 一个 logical run 在任一时点只能有一个**有效** terminal completion。
4. 同一 completion 的网络重试和 journal 重放复用同一个 `completionEventId`。
5. 新的用户任务使用新的 `logicalRunId`；同一持久任务的 crash resume 必须恢复原 ID。
6. runner 必须把这些 ID 显式传入 Growth，不得由 Growth 在每次重试时临时生成。

### 9.4 Event type 与 source ID

| Event type                 | `sourceEventId`                                     |
| -------------------------- | --------------------------------------------------- |
| `run.completed`            | `completionEventId`                                 |
| `run.attempt_recorded`     | `attemptId`                                         |
| `run.completion_corrected` | 独立 correction ID，并引用被修正 completion         |
| `feedback.recorded`        | 稳定 feedback ID                                    |
| `milestone.recorded`       | 稳定 command ID                                     |
| `legacy.baseline_imported` | `importEpoch + sourceChecksum` 对应的稳定 import ID |

### 9.5 Correction 而不是覆盖

精确重复事件可以 `ON CONFLICT DO NOTHING`，但这只能去重**同一事件**。第一次错误记录为失败、后续确认成功时，必须追加 `run.completion_corrected`：

- 引用原 `completionEventId`。
- 携带独立 correction ID、actor、reason 和 audit ID。
- projector 撤销旧贡献并应用新贡献，或从受影响 checkpoint 重放。
- status 和 metrics version 单调递增。
- 不删除原始审计事实。

这样可避免第一次错误结果被幂等约束永久保留。

### 9.6 事务投影

PostgreSQL 目标事务：

1. 验证 authoritative `AgentAccessContext`。
2. 插入 observation；若是精确重复，返回当前投影且不重复累计。
3. 锁定或原子更新 `(enterprise_id, agent_asset_id)` metrics。
4. 使用明确的 `projector_version` 计算 status。
5. 同事务写入 outbox。
6. 提交后才允许 relay 发布事件。

observation、metrics、status 和 outbox 不得由调用方分别写入。

## 10. 回复 fail-open、observation 不 fail-silent

### 10.1 问题边界

transactional outbox 只解决“业务事务已进入数据库后如何可靠发布”，不能解决“数据库不可用时 observation 根本没有被接收”。因此 outbox 不能替代 ingestion journal。

### 10.2 写入策略

回复链采用有上限的两级接收：

1. 在明确的短时预算内尝试 authoritative repository。
2. repository 不可用或超时后，把同一稳定事件写入耐久 `CompletionJournal`。
3. journal 持久化确认后，回复链可继续结束。
4. 后台 worker 按稳定 event identity 重放到 authoritative repository。
5. 精确重复由 repository 幂等消除。
6. 反复失败或 payload 不合法的事件进入 quarantine，不得静默丢弃。

同步预算、最大积压、重试期限和并发度必须在 PostgreSQL Migration & SRE 规格中量化，本稿不擅自给出生产数值。

### 10.3 双重故障

如果 repository 和 journal 同时不可用，fail-open 与绝对零数据丢失无法同时保证。v2 要求：

- 不允许空 catch。
- 必须同步产生结构化 critical 日志和持久化能力失败指标。
- 必须触发告警并记录估算丢失事件数。
- 是否在特定企业策略下阻断回复，必须由 Product/SRE 明确裁决。
- 目标 RPO、允许的数据损失上限和事故处置流程未批准前，Phase 2 保持 BLOCKED。

### 10.4 本地与云端 journal

- Phase 1 的 journal 可以是单机 crash-safe 耐久实现，但只能服务单 Gateway 写实例。
- Phase 2/4 的 journal 必须是共享耐久设施，或由共享 PostgreSQL/托管队列提供等价保证。
- 单机临时文件、内存队列或进程退出即丢失的缓冲不能作为云端 journal。
- journal 不是第二事实源；成功重放并确认后按保留策略清理。

### 10.5 必须观测的指标

- primary ingest 成功率与延迟。
- journal append 成功率与延迟。
- backlog count、bytes 和 oldest age。
- replay 成功、重试、失败和 quarantine 数量。
- duplicate event rate。
- correction rate。
- estimated data-loss count。
- projector drift。
- outbox lag、retry 和 dead-letter 数量。

## 11. PostgreSQL 目标数据面

### 11.1 上线前提

Growth PostgreSQL 只有在以下任一条件满足后才能启用：

- 共享 Identity/Registry/ACL 控制面已经是生产 authoritative source；或
- 控制面与 Growth 数据面在同一发布门禁中上线，但 Growth feature flag 保持关闭，直到控制面完成迁移、验证和权威切换。

不允许 Growth 先上线，再长期依赖本地身份和 ACL 补齐。

### 11.2 概念表

共享控制面概念表由独立规格负责：

```text
enterprise
membership
active_membership_session
agent_asset
agent_alias
agent_deployment
agent_revision
agent_owner_binding
agent_access_policy
service_principal
control_plane_audit
```

Growth 数据面概念表：

```text
growth_observation
growth_metrics
growth_status
growth_projection_checkpoint
growth_outbox
legacy_metrics_baseline
legacy_growth_snapshot
growth_import_epoch
growth_quarantine
```

这些名称是评审模型，不是已批准的 DDL。

### 11.3 组合约束

所有 Agent 相关业务表必须保留 enterprise 维度：

```text
PRIMARY/UNIQUE (enterprise_id, agent_asset_id, ...)
FOREIGN KEY (enterprise_id, agent_asset_id)
  REFERENCES agent_asset (enterprise_id, agent_asset_id)
```

跨 enterprise 的 owner、policy、observation、status 或 outbox 关联必须被数据库约束拒绝，而不只依赖应用代码。

### 11.4 RLS 与数据库角色

- tenant context 只能由已验证 `AgentAccessContext` 设置。
- 使用事务级 `SET LOCAL`，禁止连接级 context 泄漏到池中下一请求。
- 普通应用角色、projector、migration、outbox relay 和 break-glass 使用不同角色。
- 普通应用角色不得 bypass RLS。
- service principal 只获得完成职责所需的最小 enterprise/permission 范围。
- break-glass 必须有审批、理由、范围、到期时间和审计。
- RLS 不是唯一防线；组合外键、application authorization 和审计同时存在。

### 11.5 Authoritative repository

PostgreSQL 切换后：

- 本地 JSON 只读保留到迁移验收期结束，或按备份政策归档。
- 不再接受本地业务写入。
- 不允许按请求失败时自动回退写本地。
- 应用版本回滚不自动等于数据源回滚。
- 只有完成可逆性演练后，才能执行数据权威回退。

## 12. Baseline 迁移、canary 与回滚

### 12.1 不伪造历史

旧系统只有累计 metrics 和当前 status，没有完整逐次 observation。迁移时不能反向编造每次 run。

导入两类明确的 baseline：

```text
legacy_metrics_baseline
legacy_growth_snapshot
source_checksum
import_epoch
projector_version
imported_at
```

含义：

- `legacy_metrics_baseline` 保存切换点前的累计计数。
- `legacy_growth_snapshot` 保存切换点前的 lifecycle、dimensions、milestones 和版本。
- `source_checksum` 证明源文件内容。
- `import_epoch` 标识一次可重复验证的迁移批次。
- `projector_version` 说明 snapshot 使用的算法版本。
- 切换后的新 run 才写逐次 observation。

查询和聚合必须标明 baseline 前后数据粒度不同，不能把 baseline 当成逐次事件分析。

### 12.2 导入流程

1. 建立 enterprise + legacy Agent 到 AgentAsset 的确定映射。
2. 无法唯一映射的数据进入 quarantine。
3. 计算源文件 checksum 并冻结 import manifest。
4. 以稳定 import ID 幂等导入 baseline 和 snapshot。
5. 对比 counters、dimensions、milestones、lifecycle 和版本。
6. 重跑相同 import 不得重复累计。
7. 完成单 Agent canary 后才扩大 enterprise 范围。

### 12.3 Canary 顺序

```text
内部测试 enterprise
  -> 单 Agent
  -> 单 enterprise 小范围 Agent
  -> tenant-by-tenant cutover
  -> 所有企业完成后再评估多实例
```

每次 cutover 只能有一个 writer，并具备停止、quarantine、对账和恢复能力。

### 12.4 回滚原则

- 禁止切换窗口双主写。
- 若云端增量不能无损反向回放，应用回滚时 PostgreSQL 仍保持数据权威。
- 数据权威回退必须有单独审批、已验证的 reverse replay 和完整对账。
- 不能把旧 JSON 快照直接覆盖云端切换后的新数据。
- rollback rehearsal 必须覆盖 journal、observation、projection 和 outbox 的切换窗口增量。

## 13. 实时事件与多实例

### 13.1 当前限制

当前 Growth 广播只在单 Gateway 进程内发生。它不能保证：

- 多实例订阅者收到相同事件。
- 事件只发送给正确 enterprise。
- 广播发生在数据库提交之后。
- 断线重连可以补齐事件。

### 13.2 目标模型

```text
Growth transaction
  -> growth_outbox
  -> outbox relay
  -> tenant-aware event bus/fanout
  -> authorized session subscribers
```

要求：

- relay 只发布 committed outbox。
- envelope 包含 enterprise、AgentAsset、event ID、status version 和 schema version。
- session 订阅范围来自 authoritative membership/ACL。
- consumer 使用 event ID 幂等。
- reconnect 使用 version 或 cursor 补偿。
- 不得把全平台事件先广播再由客户端过滤。

### 13.3 多实例硬门禁

只有以下能力全部外置并通过测试后，才允许多个 Gateway 写实例：

- active membership session。
- Agent Registry、owner binding 和 ACL。
- Growth repository 与 transaction projector。
- shared durable CompletionJournal。
- outbox relay 和 tenant-aware fanout。
- 分布式任务 ownership/lease 或等价的单次处理保证。
- 故障注入、并发和租户隔离测试。

## 14. 产品治理、隐私与商业边界

### 14.1 非员工绩效评分

Growth 定义为 **Agent 能力、可靠性和运行质量指标**。它不得：

- 作为员工绩效分数。
- 自动触发招聘、解雇、晋升、降级、薪酬或纪律决定。
- 把 Agent 错误直接归因给当前员工。
- 在 UI 中使用暗示员工排名或生产力监控的文案。

如未来希望用于人事相关场景，必须进入独立的法律、隐私、公平性和产品评审，不属于本方案。

### 14.2 必须先决定的治理问题

- 企业管理员能否查看 membership-owned 个人 Agent 的明细。
- seat-owned Agent 的历史在岗位交接后如何展示。
- 成员能否查看评分来源、projector version 和主要贡献因素。
- 成员如何提出异议、请求 correction 或删除。
- 所有权转移、离职、企业退出和删除请求如何影响历史。
- observation、baseline、status、outbox、journal、audit 和 aggregate 各保留多久。
- 企业聚合的最小 cohort 与反向识别保护。
- 数据导出、数据驻留、专属区域和专属数据库的责任边界。

### 14.3 建议的默认可见性

该建议仍待 Data Governance 和 Product 批准：

- 成员默认可见自己有权管理或使用的 Agent 状态与解释。
- 企业管理员默认可见 seat-owned Agent 的治理信息。
- membership-owned Agent 明细默认不因“管理员”身份自动全量开放；需明确 permission、目的和审计。
- 平台运营默认只看脱敏健康指标，不看企业业务内容。
- 跨成员聚合必须满足最小 cohort；不足时不展示或合并更大范围。

### 14.4 基础安全不能付费

以下能力对所有套餐都是基础安全和权利，不得作为付费开关：

- tenant isolation。
- ownership 正确性。
- 服务端授权和最小权限。
- 指标来源解释。
- correction、异议和删除权。
- 安全审计和事故通知。

可以商业化的差异包括：

- 更长历史保留期。
- 企业级趋势和受治理聚合。
- 高级审计导出。
- 专属区域或专属数据库。
- 高级 SLO、恢复和合规包。

商业能力不能削弱基础安全、删除权或租户隔离。

## 15. SRE、容量与部署决策

### 15.1 当前部署证据的边界

`fly.toml` 只证明当前配置包含一个 app process group、minimum 1 machine 和 `/data` volume。它不能单独证明线上始终只有一台 machine。正式评审必须附运行态部署清单和写实例数量证据。

### 15.2 PostgreSQL Migration & SRE 规格必须量化

- ingest、query 和 projection SLO。
- reply path 同步预算。
- journal RPO、RTO、最大 backlog、最大 oldest age 和保留期。
- outbox 最大 lag 和 dead-letter 处理时间。
- 单 enterprise/Agent 的事件峰值与容量模型。
- connection pool、transaction latency 和热点 Agent 处理策略。
- backup、PITR、restore rehearsal 和灾难恢复目标。
- observation、baseline、status、journal、outbox、audit 和 aggregate 保留期。
- schema migration 的 expand/contract 规则。
- quarantine 和人工修复责任人。
- incident severity 与告警路由。

这些数值未批准前，不能把 Phase 2 视为 production-ready。

### 15.3 不拆 Growth 微服务

初期将 Growth Application Service 与 Gateway 同进程部署：

- 减少新的网络和发布故障面。
- 先验证身份、事务和迁移契约。
- 通过 repository/application boundary 保留未来拆分可能。

只有在明确的容量、隔离或团队 ownership 证据出现后，才单独评审服务拆分。

## 16. 修订后的实施路线

所有阶段当前均为 **BLOCKED PENDING RE-REVIEW**。

### Phase -1：Shared Agent Identity & Access Control Plane

这是平台安全前置，不是 Growth 子模块内部实现。

交付：

- Agent 术语 ADR。
- enterprise/tenant 命名与边界规则。
- active membership 选择、session binding、撤销和审计。
- canonical AgentAsset Registry、alias 和 legacy resolver。
- membership-owned、seat-owned owner binding 与历史。
- 统一 ACL extension/replacement 决策与迁移。
- membership、seat、service principal actor。
- 服务端 `AgentAccessContext` resolver。
- Billing、Agent create、entitlement 和 Growth 的统一企业上下文迁移计划。

退出门：

- 同一 platform user 加入两个 enterprise，每个 enterprise 拥有多个 Agent 时不会串租户。
- 禁止 first-membership 推导 enterprise。
- 客户端 tenant/owner 被篡改时请求被拒绝。
- membership 撤销后所有相关请求失效。
- ownership、ACL 和审计在所有 Gateway 实例看到同一权威结果。

### Phase 1：Local-mode Growth Application Boundary

依赖 Phase -1 的术语和 access contract 冻结。仍保持单 Gateway、本地 authoritative repository。

交付：

- `GrowthApplicationService`。
- `GrowthRepository` 与 `LocalGrowthRepository`。
- `CompletionJournal` 接口和单机 crash-safe 实现。
- 所有 RPC 和 runner 使用统一 AgentRef/AccessContext。
- GET 纯读。
- 显式 repair/recompute，带 actor、reason 和 audit ID。
- logical run、attempt、completion 和 correction 契约。
- 未授权访问不泄漏 Agent 是否存在。
- 单一 authoritative repository 配置。

退出门：

- 本地成长行为兼容。
- 精确重复 completion 不重复累计。
- fallback/retry 的 attempt failure 不计为逻辑任务失败。
- correction 可修正投影且保留审计。
- repository 不可用时事件进入耐久 journal，不再静默丢失。
- 相关目标测试全绿并有可复现证据。

### Phase 2：Shared Control Plane + PostgreSQL Growth Data Plane

共享控制面和 Growth 数据面属于同一发布门禁。控制面必须先成为 authoritative，Growth 写入才可启用。

交付：

- 跨实例共享的 membership session、Agent Registry、owner binding 和 ACL。
- observation、metrics、status、checkpoint、outbox 和 baseline schema。
- `PostgresGrowthRepository`。
- 事务 projector。
- 组合外键与 RLS。
- 独立数据库角色。
- shared durable journal 与 replay worker。
- outbox relay。
- migration、reconciliation、quarantine 和 rollback 工具。

退出门：

- 幂等、correction、并发、事务和 projector version 测试通过。
- RLS、连接池 context 泄漏和跨 enterprise 外键测试通过。
- 数据库、journal 和 relay 故障注入通过。
- SLO、容量、保留和事故策略获批。
- 任一 enterprise 只有一个 authoritative repository。

### Phase 3：Baseline migration + 单企业单 Agent canary

交付：

- legacy mapping manifest。
- `legacy_metrics_baseline` 和 `legacy_growth_snapshot` 导入。
- source checksum、import epoch 和 projector version。
- 单企业、单 Agent canary。
- tenant-by-tenant cutover、reconciliation 和 quarantine。
- rollback rehearsal。

退出门：

- 导入不伪造逐次 observation。
- 重复导入不重复累计。
- baseline 和切换后增量可完整对账。
- canary 达到已批准 SLO。
- 回滚应用版本不会隐式恢复本地写入。

### Phase 4：Multi-instance + governed platform aggregation

交付：

- 多 Gateway 写实例。
- tenant-aware durable fanout。
- outbox relay 高可用与 consumer 幂等。
- 跨实例并发和故障转移。
- 企业聚合、最小 cohort、保留与导出治理。
- 平台脱敏健康视图。

退出门：

- Identity、Registry、ACL、Growth、journal、outbox 和 fanout 全部外置。
- 多实例故障注入、负载和 tenant isolation 测试通过。
- 聚合不会反向识别个人。
- Data Governance、Security、SRE 和 Product 联合批准。

## 17. 三个后续实施规格

本轮只冻结名称、边界和依赖；在 v2 复审通过前不创建实施规格或编码任务。

### 17.1 Shared Agent Identity/Access Control Plane

负责：

- 术语 ADR。
- active membership session。
- AgentAsset Registry、alias、deployment 和 owner binding。
- 统一 ACL、service principal 和审计。
- legacy Agent resolver。
- Billing、Agent、entitlement、Growth 的企业上下文契约。

不负责：

- Growth 计算算法。
- Growth observation schema。
- PostgreSQL cutover 的 SRE 实施。

### 17.2 Growth Application Boundary

负责：

- application service 和 repository abstraction。
- AgentRef/AccessContext 消费契约。
- logical run/attempt/completion/correction 语义。
- GET 纯读和显式 repair。
- LocalGrowthRepository。
- CompletionJournal 接口与本地模式行为。
- Growth 权限需求，不自行创建平行 ACL。

不负责：

- 平台 membership 选择实现。
- canonical Agent Registry 实现。
- 云数据库和多实例部署。

### 17.3 PostgreSQL Migration & SRE

负责：

- PostgreSQL schema、RLS、roles、transaction projector 和 outbox。
- shared durable journal、replay、quarantine 和 relay。
- baseline migration、canary、cutover、reconciliation 和 rollback。
- SLO、容量、保留、备份恢复、告警和 runbook。
- 多实例 readiness 证据。

不负责：

- 重新定义 Agent 身份或 owner 语义。
- 重新定义 Growth 算法和事件业务语义。
- 独立创建 Growth-only ACL。

### 17.4 依赖图

```text
Shared Agent Identity/Access Control Plane
        |                         |
        v                         v
Growth Application Boundary ---> PostgreSQL Migration & SRE
```

约束：

- Identity/Access 规格先冻结术语、主体和授权契约。
- Growth Application 规格消费这些契约并冻结事件业务语义。
- PostgreSQL Migration & SRE 同时消费控制面和应用边界，不能反向发明身份或业务规则。
- 三个规格分别需要 requirements、design、tasks、owner、测试计划和发布门禁。
- Growth 是统一身份控制面的首个消费者，不承担整个平台身份重构的全部 ownership。

## 18. 验收与证据门禁

### 18.1 文档复审门禁

- [ ] 专家确认 v2 已解决 `AgentInstance` 语义冲突。
- [ ] 专家批准一期仅 membership/seat owner。
- [ ] Security 批准 active membership 和 service principal 模型。
- [ ] Platform Architecture 批准控制面先于 Growth 数据面。
- [ ] Runtime 批准 logical run/attempt/completion/correction 契约。
- [ ] SRE 批准 journal/outbox 分工和待量化清单。
- [ ] Data Governance/Product 批准非员工绩效定位和商业边界。
- [ ] 专家批准三个后续规格的依赖和责任边界。

### 18.2 身份与租户测试

- [ ] 一个 platform user 在两个 enterprise 显式切换 active membership。
- [ ] 每个 enterprise 下至少两个 Agent，读取、执行和 Growth 数据不串租户。
- [ ] 修改 URL/header/RPC tenant 不能扩大权限。
- [ ] 修改 owner 参数不能创建越权 Agent。
- [ ] membership 撤销、企业冻结和 session 失效立即生效。
- [ ] 未授权与不存在对象不会产生可利用的存在性差异。
- [ ] service principal 权限和 `onBehalfOfMembershipId` 只能收窄，不能扩大。

### 18.3 事件与应用边界测试

- [ ] fallback/retry 共享 logical run，每个 attempt ID 唯一。
- [ ] 只有最终 terminal completion 累计任务结果。
- [ ] 同一 completion 重放不会重复累计。
- [ ] correction 能撤销旧贡献并应用新贡献。
- [ ] GET 不产生文件、数据库、version 或 outbox 写入。
- [ ] repair/recompute 需要独立 permission、reason 和 audit ID。
- [ ] repository 故障进入 journal。
- [ ] journal 重放、重复、poison payload 和 quarantine 行为可复现。

### 18.4 PostgreSQL 与 RLS 测试

- [ ] observation、metrics、status 和 outbox 同事务。
- [ ] 组合外键拒绝跨 enterprise 关联。
- [ ] RLS 拒绝跨 enterprise 直接 SQL 和应用请求。
- [ ] 连接复用不会泄漏上一个事务的 tenant context。
- [ ] 普通角色不能 bypass RLS。
- [ ] 并发 completion 不丢更新。
- [ ] projector version 升级与回滚有确定行为。
- [ ] relay 只发布 committed outbox。

### 18.5 迁移与可靠性测试

- [ ] baseline 保留源 checksum、import epoch 和 projector version。
- [ ] 重复导入不重复累计。
- [ ] 迁移前后 metrics、dimensions、milestones 和 lifecycle 对账。
- [ ] 不生成虚假的历史 observation。
- [ ] 数据库不可用、journal 不可用和双重故障均有明确证据与告警。
- [ ] backlog、oldest age、replay 和 estimated data loss 可观测。
- [ ] rollback rehearsal 覆盖切换窗口所有增量。
- [ ] 备份恢复和 PITR 演练达到批准目标。

### 18.6 UI 与产品测试

- [ ] 当前 Prelude 的两个失败已分类为产品回归或旧断言，并恢复目标测试全绿。
- [ ] Badge、Prelude、Report 不把 Growth 表述为员工绩效。
- [ ] 成员能看到已批准范围内的解释和 correction 入口。
- [ ] 管理员不能默认越权查看 membership-owned Agent 明细。
- [ ] 小 cohort 不展示可反向识别的聚合。

### 18.7 证据格式

所有“通过”结论必须附：

- commit SHA。
- 精确命令。
- 环境与关键配置。
- 时间。
- 原始报告或日志位置。
- 失败前/通过后的对照；bug fix 可行时必须有回归测试。

仅有设计说明、issue 文本或 AI 推理不能作为发布证据。

## 19. 风险登记

| ID  | 风险                           | 影响                   | v2 缓解                             | Owner                 |
| --- | ------------------------------ | ---------------------- | ----------------------------------- | --------------------- |
| R1  | `AgentInstance` 同名不同义     | schema/API/迁移歧义    | Phase -1 ADR，v2 暂用 AgentAsset    | Platform Architecture |
| R2  | first membership 选择企业      | 串租户                 | active membership session           | Enterprise Identity   |
| R3  | 客户端伪造 tenant/owner        | 越权创建或访问         | server-derived context              | Security              |
| R4  | Growth 单独上 PostgreSQL       | 身份与授权不一致       | 共享控制面联合门禁                  | Architecture          |
| R5  | 裸 Agent ID 冲突               | 跨企业关联错误         | enterprise + AgentAsset 组合边界    | Data                  |
| R6  | attempt failure 被当作任务失败 | 成长指标失真           | terminal completion 契约            | Runtime               |
| R7  | 第一次错误结果被幂等锁死       | 无法修正               | append-only correction              | Growth                |
| R8  | repository 异常静默丢数据      | Growth 不完整          | durable journal + alert             | SRE                   |
| R9  | journal 成为第二事实源         | 数据分叉               | 仅作暂存、确认重放后清理            | SRE                   |
| R10 | metrics/status/outbox 分写     | 投影不一致             | 单 application transaction          | Growth                |
| R11 | RLS context 泄漏               | 跨租户泄露             | `SET LOCAL` + role separation       | Security              |
| R12 | 所有权转移清零 Growth          | 企业资产历史丢失       | versioned owner binding             | Enterprise Identity   |
| R13 | 旧 metrics 伪造成事件          | 虚假分析历史           | baseline/snapshot import            | Data                  |
| R14 | 长期双主                       | 数据分叉               | tenant single-writer cutover        | SRE                   |
| R15 | 过早多实例                     | 丢更新、错授权、漏事件 | Phase 4 硬门禁                      | Architecture          |
| R16 | 管理员查看个人 Agent 明细      | 隐私与劳动治理风险     | 最小权限、目的限制、审计            | Data Governance       |
| R17 | 小 cohort 反向识别             | 个人隐私泄露           | 最小 cohort 与抑制                  | Data Governance       |
| R18 | Growth 被用于员工绩效          | 不当人事决策           | 产品定位和 policy 禁止              | Product/Legal         |
| R19 | 过早拆微服务                   | 运维复杂度             | 同 Gateway 进程 application service | Architecture          |
| R20 | SLO/保留未量化                 | 无法生产验收           | Migration & SRE 规格前置            | SRE                   |

## 20. 复审待裁决项

### 20.1 身份与术语

- [ ] 批准 `AgentAsset` 作为 provisional/final canonical 名称，或给出替代名称。
- [ ] 决定既有 `AgentInstance` 保留还是迁移为 `AgentDeployment`。
- [ ] 批准 enterprise + AgentAsset 组合边界。
- [ ] 批准 legacy resolver 与 ambiguity quarantine。
- [ ] 确认不允许跨 enterprise 转移 AgentAsset。

### 20.2 Membership 与 ACL

- [ ] 批准 active membership session 流程。
- [ ] 批准禁止 first-membership 授权推导。
- [ ] 决定现有 `EnterpriseAccessPolicy` 是扩展还是替换。
- [ ] 批准一期 membership-owned、seat-owned。
- [ ] 确认 team-owned、enterprise-owned 延后。
- [ ] 批准 service principal 和 on-behalf-of 约束。

### 20.3 Event 与故障语义

- [ ] 批准 logical run/attempt/completion 定义。
- [ ] 批准 terminal completion 只在 fallback/retry 最终结束后产生。
- [ ] 批准 append-only correction。
- [ ] 批准 event identity 组合键。
- [ ] 批准 CompletionJournal 与 outbox 的职责分离。
- [ ] 决定双重故障下的 RPO 和是否允许特定策略阻断回复。

### 20.4 数据、迁移与部署

- [ ] 批准控制面与 Growth 数据面的联合发布门禁。
- [ ] 批准 baseline/snapshot import，不伪造 observation。
- [ ] 批准单企业单 Agent canary。
- [ ] 批准应用回滚时 PostgreSQL 默认继续权威。
- [ ] 批准状态外置前禁止多个 Gateway 写实例。
- [ ] 批准初期不拆 Growth 微服务。

### 20.5 产品治理

- [ ] 批准 Growth 不是员工绩效评分。
- [ ] 决定企业管理员对 membership-owned Agent 的默认可见性。
- [ ] 决定 correction、删除、离职和所有权转移政策。
- [ ] 决定各类数据保留期。
- [ ] 决定最小聚合 cohort。
- [ ] 批准基础安全与付费能力边界。

## 21. 当前代码参考

| 关注点                                 | 当前文件                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| run 收尾、`runId` 与 Growth 静默 catch | `src/auto-reply/reply/agent-runner-execution.ts`                                     |
| 运营指标本地存储                       | `src/gateway/agent-growth/operational-metrics-store.ts`                              |
| 运营指标成长投影                       | `src/gateway/agent-growth/operational-growth.ts`                                     |
| Growth 状态本地存储                    | `src/gateway/agent-growth/store.ts`                                                  |
| Growth RPC 与 GET 写入                 | `src/gateway/server-methods/agent-growth.ts`                                         |
| first membership helper                | `src/gateway/platform-auth/memberships.ts`                                           |
| Billing membership 消费                | `src/gateway/billing/scope.ts`                                                       |
| Gateway client session context         | `src/gateway/server-methods/types.ts`                                                |
| Platform Auth 本地存储                 | `src/gateway/platform-auth/store.ts`                                                 |
| Seat Assets JSON/SQLite 后端           | `src/gateway/enterprise-seat-assets-backend.ts`                                      |
| 当前 access policy 形态                | `src/gateway/enterprise-seat-assets-store.ts`                                        |
| Model Entitlement 本地存储             | `src/gateway/model-entitlement/enterprise-model-entitlement-store.ts`                |
| Agent 创建与当前 ownership             | `src/gateway/server-methods/agents.ts`                                               |
| 既有 AgentInstance 语义                | `docs/design/openbot-enterprise-agent-asset-binding-and-handover-plan-2026-04-14.md` |
| Growth Badge                           | `ui/src/ui/ports/employee/views/workbench-growth-badge.ts`                           |
| Prelude 测试                           | `ui/src/ui/ports/employee/views/workbench-stage-growth-prelude.node.test.ts`         |
| 当前 Fly process group 与 volume       | `fly.toml`                                                                           |

## 22. 实施启动条件

三个后续实施规格只有在以下条件全部满足后才能创建为可执行计划：

1. 本文复审结论从 `Pending re-review` 更新为明确批准。
2. 第 20 节所有阻塞裁决有书面结论。
3. Platform Architecture、Enterprise Identity、Security、Runtime、Data Governance、SRE 和 Product 完成签署。
4. 三个规格分别建立 requirements、design、tasks、owner、路径归属、测试计划和发布门禁。
5. Shared Agent Identity/Access Control Plane 先冻结契约。
6. 数据库、云资源和生产迁移分别获得操作审批。
7. 测试环境、canary enterprise、canary Agent、rollback owner 和 incident owner 已定义。
8. 当前 UI 失败被分类并形成可复现基线。

即使本文复审通过，也不等于批准生产发布。每个阶段仍需通过自己的设计、测试、安全和发布门禁。

## 23. 审核结论记录

当前结论：**Pending re-review - Implementation remains BLOCKED**。

已吸收的专家结论：

- 架构方向可以有条件继续。
- v1 不可直接实施。
- 共享身份控制面必须先行。
- Growth 是该控制面的首个消费者，不是平台身份重构的唯一 owner。
- 三个后续实施规格必须分离责任并按依赖推进。

在复审与后续规格批准前：

- 不修改生产实现。
- 不创建生产数据库表。
- 不提交云资源。
- 不启用云端 Growth 写入。
- 不配置生产双写。
- 不扩展 Gateway 写实例。
- 不迁移租户数据或修改历史 Growth 文件。
- 不宣称云端多租户能力已经成立。

| Review role           | Reviewer | Decision          | Date | Conditions |
| --------------------- | -------- | ----------------- | ---- | ---------- |
| Platform Architecture | Pending  | Pending re-review | -    | -          |
| Enterprise Identity   | Pending  | Pending re-review | -    | -          |
| Agent Runtime         | Pending  | Pending re-review | -    | -          |
| Security              | Pending  | Pending re-review | -    | -          |
| Data Governance       | Pending  | Pending re-review | -    | -          |
| SRE                   | Pending  | Pending re-review | -    | -          |
| Product               | Pending  | Pending re-review | -    | -          |
