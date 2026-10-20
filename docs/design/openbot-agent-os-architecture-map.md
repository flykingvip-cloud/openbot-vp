# OpenBot Agent OS 总架构对照

本文把「企业级 Agent Operating System」方案的**两大中枢 + 八大支柱**，逐一对照到 OpenBot 现有代码
模块与落地 spec，作为向专家团队介绍产品在数字能力建构方向特点与优势的一页总览，并把这套能力正式
定位为 Agent OS。

配图见 `docs/design/openbot-agent-os-architecture-draft.svg`（两大中枢 + 八大支柱 + 数字员工层 + 企业资产）。

> 说明：方案术语（Identity Gateway / Capability Center / Semantic Data Gateway / Knowledge Gateway /
> Data Planner / Event Bus / Policy Engine / Context Broker）是**对外产品叙事**；括号内为**代码内部命名**。
> 两者刻意保留差异：内部命名沿用既有工程语汇，产品叙事对齐 Agent OS 认知。

## 定位一句话

OpenBot 不是「一个会调用工具的聊天机器人」，而是一套**企业级 Agent 操作系统**：以统一身份接入企业
系统、以能力中心治理可调用的动作、以语义数据网关把异构源表抽象成规范业务对象、由 Agent 数据规划器
在授权范围内自主决定取哪些数据、经知识网关沉淀为可复用知识、以事件总线把「拉取」升级为「事件驱动」、
在策略引擎与密钥治理下全程合规，并支持多 Agent 协同。

## 两大中枢

| 中枢                                   | 代码根         | 职责                                                                                                        |
| -------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------- |
| 网关控制面（Gateway Control Plane）    | `src/gateway/` | 对外接入与治理面：身份、能力、数据、知识、事件、策略、协同的 RPC 与运行时都在此汇聚。                       |
| 治理内核（Governance Kernel / Fabric） | `src/fabric/`  | 横切执行内核：统一执行契约、策略运行时、决策链路（trace）、成本与审计，跨支柱提供一致的「可治理执行」底座。 |

治理内核关键件：`src/fabric/kernel.ts`（内核）、`src/fabric/policy-runtime.ts`（策略运行时）、
`src/fabric/execution.ts`（执行）、`src/fabric/decision-trace.ts`（决策链路）、`src/fabric/audit.ts`
（审计）、`src/fabric/cost.ts`（成本）、`src/fabric/contract.ts`（契约）。对应 spec：`.kiro/specs/openbot-fabric/`。

## 八大支柱对照表

| #   | 产品叙事术语                                                   | 代码模块（根）                                                                                                                                                         | 落地 spec                                                                         | 状态                          |
| --- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------- |
| ①   | Identity Gateway（身份网关）                                   | `src/gateway/enterprise-operational-identity*`、`src/gateway/user-operational-identity*`、`src/gateway/platform-auth*`                                                 | `.kiro/specs/operational-identity-governance/`                                    | 成熟                          |
| ②   | Capability Center（能力中心）                                  | `src/gateway/capability-governance-store.ts`、`src/gateway/enterprise-data/data-capability-store.ts`、`src/gateway/enterprise-data/capability-agent-invoke-runtime.ts` | `.kiro/specs/enterprise-data-capability-center/`                                  | 已实现                        |
| ③   | Semantic Data Gateway（语义数据网关）                          | `src/gateway/enterprise-data/`（`data-gateway.ts`、`connector-*`、`data-source-store.ts`、`projection-spec-store.ts`）+ `semantic-object-*`                            | `.kiro/specs/semantic-object-catalog/`                                            | 后端成熟；本轮补语义对象层    |
| ④   | Agent Data Planner + Context Broker（数据规划器 + 上下文中枢） | `src/gateway/enterprise-data/agent-data-planner.ts`、`agent-data-plan-types.ts`、`capability-grant-resolver.ts`                                                        | `.kiro/specs/agent-data-planner/`                                                 | 本轮新建（原最大缺口）        |
| ⑤   | Knowledge Gateway（知识网关）                                  | `src/gateway/knowledge/`                                                                                                                                               | `.kiro/specs/enterprise-data-capability-center/`（知识供给部分）                  | 成熟                          |
| ⑥   | Event Bus（企业数据事件总线）                                  | `src/gateway/enterprise-data/enterprise-data-event-bus.ts`、`enterprise-data-event-store.ts`、`enterprise-data-event-types.ts`                                         | `.kiro/specs/enterprise-data-event-bus/`                                          | 本轮新建（原仅通道级）        |
| ⑦   | Policy Engine + Security Governance（策略引擎 + 安全治理）     | `src/gateway/policy-engine/`、enterprise-data 的 scope/masking/approval 存储、`connector-credential-vault.ts` + `connector-credential-vault-key.ts`                    | `.kiro/specs/vault-key-externalization/`                                          | 已实现；本轮补 Vault 密钥外置 |
| ⑧   | Multi-Agent Collaboration（多 Agent 协同）                     | `src/organization/inter-agent-bus.ts`、`src/gateway/supervisor/`、`src/gateway/collaboration-*`                                                                        | `.kiro/specs/development-supervisor/`、`.kiro/specs/loom-workspace-orchestrator/` | 成熟                          |

## 逐支柱说明

### 支柱 1：Identity Gateway（身份网关）

统一接入企业系统与个人操作身份。企业侧操作身份（含 IMAP/SMTP、微信公众号、抖音、微博、B 站等
provider）在 `src/gateway/enterprise-operational-identity*`；个人操作身份（OAuth/密钥、授权链）在
`src/gateway/user-operational-identity*`；平台登录与受信代理在 `src/gateway/platform-auth*`。企业数据面
的席位身份解析（服务端解析、绝不接受客户端伪造）在 `src/gateway/enterprise-data/enterprise-data-seat-context.ts`。

### 支柱 2：Capability Center（能力中心）

把「可被 Agent 调用的动作」作为一等治理对象。能力治理与远程导入在
`src/gateway/capability-governance-store.ts` / `capability-remote-import.ts`；企业数据能力（DataCapability =
业务能力抽象，actionRefs 为真实执行源）在 `src/gateway/enterprise-data/data-capability-store.ts`；受治理的
Agent 调用桥（W5 sanctioned bridge，作用域/脱敏/审批/审计/配额一体）在
`src/gateway/enterprise-data/capability-agent-invoke-runtime.ts`。

### 支柱 3：Semantic Data Gateway（语义数据网关）

后端（连接器、动作、数据源、字段分级、投影归一/聚合/趋势）已成熟，位于 `src/gateway/enterprise-data/`
（`data-gateway.ts`、`connector-action-store.ts`、`connector-credential-*`、`data-source-store.ts`、
`projection-spec-store.ts`）。本轮补上缺失的**一等「企业对象目录」**：把异构源表映射到规范对象
（Customer/Order/Product/Inventory 等）的语义对象目录，位于 `src/gateway/enterprise-data/semantic-object-store.ts`
与 `semantic-object-types.ts`，并接入资产全景图（`asset-landscape-store.ts` 新增 object 节点层）。这让 Agent
理解的是「客户/订单」而非数据库表。spec：`.kiro/specs/semantic-object-catalog/`。

### 支柱 4：Agent Data Planner + Context Broker（数据规划器 + 上下文中枢，合一）

原方案 Phase 3 的最大能力缺口：过去 Agent 只能点名调用某个数据能力，缺「任务 → 查元数据目录 →
生成授权范围内的取数计划 → 交调用桥执行」这一步。本轮新建规划器（合并了 Phase 4 的 Context Broker）：
`planDataAccess` 以语义对象目录 + 能力目录 + 席位授权为地基，产出**授权感知的 Data Plan**
（每步标 granted/requestable，未绑定对象诚实暴露）；`buildAgentContextPack` 组装身份 + 计划 + 已授权能力 +
相关知识投影引用；执行仍复用支柱 2 的 W5 调用桥。授权判定抽为单一真源 `capability-grant-resolver.ts`。
模块：`src/gateway/enterprise-data/agent-data-planner.ts`。spec：`.kiro/specs/agent-data-planner/`。
这把 OpenBot 从「能调用能力」抬升到「自主决定要什么数据」。

### 支柱 5：Knowledge Gateway（知识网关）

按需知识投影物化、知识可见性策略、血缘与供给审计等，位于 `src/gateway/knowledge/`。方案的
「Metadata First / Data On Demand」在此已有落地（按需物化）；本轮的支柱 4 补齐了「规划取哪些数据」的前半段。

### 支柱 6：Event Bus（企业数据事件总线）

原先企业数据源全是拉取/探测（`src/gateway/enterprise-data/source-connection-probe.ts`），缺事件驱动。本轮
新建事件总线，实现 pull→push：入站信号归一为**元数据事件**（`EnterpriseDataEvent`，只带源/对象/类型/摘要，
无业务数据行）→ 幂等去重 →确定性匹配租户订阅 → 复用既有 Agent 触发桥（`callGateway({method:"agent"})`，
即 `src/organization/inter-agent-bus.ts` 的做法）触发目标 Agent；触发消息提示被触发 Agent 用支柱 4 的规划器
在授权范围内取数。模块：`src/gateway/enterprise-data/enterprise-data-event-bus.ts`。spec：
`.kiro/specs/enterprise-data-event-bus/`。

### 支柱 7：Policy Engine + Security Governance（策略引擎 + 安全治理）

策略引擎在 `src/gateway/policy-engine/`；企业数据面的作用域（scope）、脱敏（masking）、审批（approval）
策略与执行/数据审计在 `src/gateway/enterprise-data/`（`scope-policy-store.ts`、`field-classification-store.ts`、
`approval-*`、`seat-action-grant-store.ts` 等）；治理内核的策略运行时在 `src/fabric/policy-runtime.ts`。
凭证密钥治理：`connector-credential-vault.ts`（AES-256-GCM 信封）本轮新增可插拔 KEK 来源
`connector-credential-vault-key.ts`——沿既有 env-key 接缝，支持从外部密管（Hashicorp Vault / AWS Secrets
Manager / KMS，经 `src/secrets` secretref 契约）解析加密密钥。spec：`.kiro/specs/vault-key-externalization/`。

### 支柱 8：Multi-Agent Collaboration（多 Agent 协同）

跨 Agent 任务/提及经 `src/organization/inter-agent-bus.ts` 触发；监督与开发协同在 `src/gateway/supervisor/`
与 `src/gateway/collaboration-*`；工作树编排在 `.kiro/specs/loom-workspace-orchestrator/`。事件总线（支柱 6）
的触发正是复用这条协同链路。

## 关键数据流（把支柱串起来）

1. 任务驱动取数（规划闭环）：用户/Agent 提出任务 → 支柱 4 规划器查支柱 3 语义对象目录 + 支柱 2 能力目录 +
   支柱 7 席位授权 → 产出 Data Plan（元数据优先）→ 支柱 2 W5 调用桥在支柱 7 策略下执行 → 结果经支柱 5 沉淀。
2. 事件驱动取数（pull→push）：外部数据源信号 → 支柱 6 归一为企业事件 + 幂等 → 匹配订阅 → 经支柱 8 协同桥
   触发目标 Agent → 被触发 Agent 走流程 1 在授权范围内取数。
3. 全程治理：所有执行经支柱 7 策略引擎（作用域/脱敏/审批）+ 治理内核（`src/fabric/` 的 decision-trace/audit/cost）
   留痕，身份由支柱 1 服务端解析。

## 本轮落地总览

| 落地项                              | 优先级 | spec                                     | 关键新增                                                              |
| ----------------------------------- | ------ | ---------------------------------------- | --------------------------------------------------------------------- |
| 语义对象目录                        | P1     | `.kiro/specs/semantic-object-catalog/`   | `semantic-object-store.ts`、只读 RPC、asset-landscape object 节点层   |
| Agent Data Planner + Context Broker | P0     | `.kiro/specs/agent-data-planner/`        | `agent-data-planner.ts`、`capability-grant-resolver.ts`、planner RPC  |
| 企业数据事件总线                    | P1     | `.kiro/specs/enterprise-data-event-bus/` | `enterprise-data-event-bus.ts`、事件/订阅 store、入站/只读 RPC        |
| Vault 密钥外置                      | P2     | `.kiro/specs/vault-key-externalization/` | `connector-credential-vault-key.ts`（可插拔 KEK，复用 `src/secrets`） |

已成熟基线（无需新建，仅对照）：Identity Gateway、Capability Center、Semantic Data Gateway 后端、
Knowledge Gateway、Policy Engine、Multi-Agent Collaboration、治理内核 Fabric。

## 命名对照小结

| 产品叙事                            | 代码内部命名                                                          |
| ----------------------------------- | --------------------------------------------------------------------- |
| Identity Gateway                    | operational-identity（enterprise / user）+ platform-auth              |
| Capability Center                   | capability-governance + enterprise-data data-capability               |
| Semantic Data Gateway               | enterprise-data + semantic-object                                     |
| Agent Data Planner + Context Broker | agent-data-planner                                                    |
| Knowledge Gateway                   | knowledge                                                             |
| Event Bus                           | enterprise-data-event-bus                                             |
| Policy Engine / Security Governance | policy-engine + enterprise-data 策略存储 + connector-credential-vault |
| Multi-Agent Collaboration           | organization/inter-agent-bus + supervisor + collaboration             |
| Governance Kernel                   | fabric                                                                |
