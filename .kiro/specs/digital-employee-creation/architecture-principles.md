# Digital Employee Creation — Architecture Principles

> **状态:** 原则层 **v1.1 已冻结**。  
> **日期:** 2026-09-17  
> **性质:** 创建数字员工的权威边界合同。补充并约束现有 Agent Factory、Growth Template、Skill Registry、Policy/ACL、ConversationTask、Progress Ledger；**不替代**其编号体系。  
> **来源:** 现网创建链审计 + 专家团队两轮书面批准（DEC-F + 编译器/状态/数据面补强）。  
> **产品合同:** [`./requirements.md`](./requirements.md) · **P1/P2 基线:** [`./p1-p2-design-baseline.md`](./p1-p2-design-baseline.md)

## 0. 文档控制

| 字段         | 内容                                                                               |
| ------------ | ---------------------------------------------------------------------------------- |
| **冻结范围** | 身份、设计对象、能力组合、授权、创建副作用、Designer 边界                          |
| **编码准入** | P1 / P2-OFFLINE / P3 / P4 见同目录准入。**不批准** LLM D1、P5 三入口改版、自动授权 |
| **编号规则** | 本文只用 `DEC-F*` / `DEC-B*` / `DEC-I*`。不得占用 EA / CTR / Ledger / 任务聚焦编号 |
| **禁止**     | 在本文复制第二套 Agent / Skill / Policy / ConversationTask 字段定义                |

### 0.1 既有合同（不被本文取代）

| 合同                   | 路径                                                                         | 本文关系                     |
| ---------------------- | ---------------------------------------------------------------------------- | ---------------------------- |
| Agent Factory          | `src/gateway/server-methods/agents.ts` `agents.create`                       | 实例化唯一写点               |
| Workspace Factory      | `src/gateway/server-methods/workspaces.ts`                                   | 创建前先建 workspace         |
| Growth Template        | `.kiro/specs/agent-growth-lifecycle/`                                        | 成长/评分合同，不是创建蓝图  |
| Tenant Capability Pack | `src/gateway/capability-packs/starter-packs.ts`                              | 租户套餐 / 可见性 / entitle  |
| Skill Registry         | capability-governance + skill-lifecycle                                      | 能力实现真源                 |
| Execution Architecture | `.kiro/specs/conversation-task-runtime/execution-architecture-principles.md` | 任务 / 执行 / Ledger 边界    |
| Managed create UX      | `.kiro/specs/managed-agent-creation/`                                        | 托管路径与席位门，不定义身份 |

### 0.2 产品语言 ≠ 主键

| 语言                 | 是什么                                     | 不是什么                       |
| -------------------- | ------------------------------------------ | ------------------------------ |
| **Digital Employee** | 产品领域语言：企业数字员工                 | 数据库主键、第二套运行时实体   |
| **Agent**            | 现有运行时实体                             | 可被 Blueprint 替代的身份      |
| **agentId**          | Digital Employee 的唯一 canonical identity | 可再包一层 `digitalEmployeeId` |

冻结句：**Digital Employee 是产品概念；Agent 是运行时实体；agentId 是唯一身份。**

---

## 1. 冻结原则（DEC-F）

### DEC-F1 · 唯一身份

`agentId` 是 Digital Employee 唯一 canonical identity。禁止新增第二套运行时员工主键（`digitalEmployeeId` 或等价物）。

会话、左侧名单、`agents.list`、席位资产、Governance catalog、Workspace binding、Agent Runtime 必须继续认 `agentId`。

### DEC-F2 · Blueprint 是设计对象

Blueprint 描述「如何创建一个数字员工」，不是运行时实例。实例仍由现有 Agent Factory 创建：

```text
Blueprint Draft → Human Confirmation → agents.create → Agent
```

禁止：

```text
Blueprint → DigitalEmployee → Agent
```

实例绑定形状（合同，非落表批准）：

```ts
type AgentCreateBinding = {
  agentId: string;
  blueprintId?: string;
  blueprintVersion?: string;
};
```

### DEC-F3 · 两套 Pack 不得同名同 ID

| 对象                          | 现网真源                                                                                | 回答                               |
| ----------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------- |
| **Tenant Capability Pack**    | `CapabilityPackId`: `starter` / `cn-office` / `channels` / `local-dev` / `platform-ops` | 企业购买/启用哪些平台能力          |
| **RoleRecipe / FunctionPack** | 待建；**禁止**复用 `CapabilityPackId`                                                   | 某类数字员工默认应装哪些已有 skill |

禁止 `installCapabilityPack("email")` 这种 Ambiguous API。邮件/CRM/Excel 属于 RoleRecipe，不属于 Tenant Capability Pack。

### DEC-F4 · RoleRecipe 只引用 skillKey

RoleRecipe 只能引用 Skill Registry 已有 `skillKey`。禁止在 Recipe / Blueprint 内复制 skill 实现、内联 Prompt、内联 tool definition。

```text
Skill Registry = Implementation
RoleRecipe     = Composition
Blueprint      = Design
```

三层不得合并成一个对象。

### DEC-F5 · 设计不得授权

Blueprint / Role / RoleRecipe 不得自动授予 Account 或 Permission。

三阶段安装语义（冻结）：

```text
Recommendations
  → User Confirmation
  → Skill Installation      // 软件能力，确认后可装
  → Account Authorization   // 企业资源，必须走现有账号绑定
  → Permission Grant        // 企业权限，必须走 Policy / ACL / Human Gate
```

现网 `TEMPLATE_AUTO_SKILL_KEYS`（如销售助理自动装飞书/公众号、邮件助手「绑定后默认可发信」）**不得**进入 AI Designer 链路。P4 接入 Factory 时必须收回自动授权。

RoleRecipe 可以作为纯能力安装器调用既有 `installSkillKeysOntoRobot(agentId, skillKeys)`，但不得调用 `oauth.connect` / `grantPermission` / `bindExternalAccount`。

### DEC-F6 · 创建不是调度入口

ConversationTask / Cron / Mission / Progress Ledger / 长期运行 / 外部连接，**不由**数字员工创建流程自动产生。

创建只做：`Instantiate Employee`。

真正工作仍由 Conversation / Task / Cron 触发。本条与 Execution Architecture「入口只产生 Wake 或 Task Mutation」一致，创建流程甚至不产生 Wake。

### DEC-F7 · Designer 只出草稿与推荐

AI Designer 只允许产生 `EmployeeDesignIntent` / Blueprint Draft / Recommendation。不得直接：

- 调用 `agents.create` 或等价 Factory
- 绑定账号
- 授予权限
- 启动任务、Cron、Mission

错误：`User → LLM → createDigitalEmployee()` 或 `User Prompt → LLM → 巨大 JSON`  
正确：Design Compiler `D1 → D2 → D3 → D4`（见 DEC-B8），只出 Draft / Recommendation。

### DEC-F8 · Designer 只读产品目录

Designer 默认只读 Role / Blueprint / Recipe / Skill Registry、Policy Schema、Product Capability Catalog。  
默认不得读 CRM 客户数据、企业 Memory、私有文档、会话历史、账号 token、敏感数据集。  
禁止借「设计销售助理」去分析企业真实客户。Designer 是 Product Design Layer，不是企业数据分析 Agent。

---

## 2. 对象边界（DEC-B）

### DEC-B1 · 四层真源 + 两个记录面

| 真源                          | 只回答                       | 不准回答           |
| ----------------------------- | ---------------------------- | ------------------ |
| **Agent / agentId**           | 谁存在                       | 他本该怎么被设计   |
| **Blueprint**                 | 这个数字员工是怎么设计出来的 | 他现在能不能写 CRM |
| **Skill Registry / skillKey** | 他会什么                     | 他被允许做什么     |
| **Policy / ACL / Account**    | 他被允许做什么               | 他会什么、他是谁   |

记录面（不是第五/第六套员工身份）：

| 对象                                        | 只回答                                                      |
| ------------------------------------------- | ----------------------------------------------------------- |
| **Progress Ledger**                         | 他实际做了什么                                              |
| **ConversationTask**                        | 这一次具体在做什么                                          |
| **Creation Receipt**（原 Binding Manifest） | 这次实例是怎么被创建出来的证明（审计/复现，不是运行时真源） |

### DEC-B2 · DesignIntent / Blueprint / RoleRecipe

```text
EmployeeDesignIntent   = 用户想要什么（推理产物，可丢）
Blueprint Draft        = 这个员工应该是什么样（设计草稿）
RoleRecipe             = 为具备标准职能应装哪些已有 skill（组合）
Published Blueprint    = 标准员工目录中的规范设计
Agent                  = 实际存在的这个员工
```

Blueprint 可引用 RoleRecipe；RoleRecipe 不拥有 Blueprint 的职责、记忆、策略、交互定义。

### DEC-B3 · Designer 是推理层，Registry 是规范层

Designer 输出角色**假设**，不硬编码选角色：

```ts
type RoleHypothesis = {
  family: string;
  role: string;
  confidence: number;
};
```

Role Resolution（冻结算法，实现待 P2）：

```text
User Request
  → EmployeeDesignIntent
  → Role Resolution
  → Existing Published Blueprint?
       ├── Yes → 使用标准 Blueprint（允许字段修订）
       └── No  → 生成 Custom Blueprint Draft
```

用户说「创建销售助理」必须命中标准 `sales_assistant`，不得每次让模型重新发明一份。

### DEC-B4 · Draft 与 Published 分离

```text
Blueprint Draft v1 → Revision v2 → … → Human Confirmation
  → Instantiate Agent
  → （可选，后置）Publish 到企业/系统目录
```

AI 可以反复试设计。未确认的 Draft 不得写入正式 Blueprint Registry，也不得创建 Agent。

首发只要 `blueprintId` + `blueprintVersion`。Override / Lock / Upgrade / 企业继承 = P6+，本文不批准。

### DEC-B5 · Growth Template 独立

```text
Growth Template  = 成长 / 评分 / 生命周期合同
Role Blueprint   = 数字员工设计蓝图
Agent            = 实例
```

关系：

```text
Role Blueprint → Agent Creation → Agent → Growth Template（绑定成长合同）
```

禁止用 Blueprint 覆盖或吞并 `AgentTemplate`。`AgentTemplate.roleBlueprint` 字符串不是本规格的 Blueprint。

### DEC-B6 · Memory Schema 只是声明

```ts
type MemorySchema = {
  entities: string[];
  memoryTypes: string[];
  priority?: string[];
};
```

Schema describes **what should be remembered**, not **how it is stored**。

首发只把声明写入 Blueprint。禁止借创建流程重写 Memory Runtime / Session / Agent Runtime。存储仍由现网 `MEMORY.md` 等实现决定。

### DEC-B7 · Creation Receipt 不是真源

确认创建后可写一份 **Creation Receipt**（原 Binding Manifest，语义不变：创建证明）。

用途：Audit / Debug / Migration / Reproducibility / Support / 企业审计。  
禁止：运行时从 Receipt 覆盖 Agent / Policy / Skill Registry。Receipt 丢失不得改变 Agent 运行语义（DEC-I10）。

### DEC-B8 · Designer 是四步编译器

禁止单跳 Prompt→JSON。冻结流水线：

| 步                       | 只回答                                                              |
| ------------------------ | ------------------------------------------------------------------- |
| D1 Intent Extraction     | 用户想让这个数字员工做什么                                          |
| D2 Role Resolution       | 最接近哪个 Published Blueprint（先匹配，再 custom）                 |
| D3 Blueprint Composition | Role + Recipe + Memory Schema + Interaction + Policy Recommendation |
| D4 Validation            | 能否给用户看；缺口必须诚实                                          |

D2/D4 必须确定性。LLM 不得直接选定 Registry 事实，也不得发明 skillKey。

### DEC-B9 · Draft 是正式产品状态

UI 与 API 使用同一状态机：`DESIGNING → DRAFT → REVISING → READY_FOR_CONFIRMATION → CONFIRMED → …`。  
Agent 只在 `CONFIRMED` 之后由 Factory 创建。Draft **可以不完整**；不确定时带 `unresolvedQuestions` / `missingCriticalInputs`，禁止编造完整高权限员工。

### DEC-B10 · Inference ≠ Resolution

`roleHypothesis` 是 AI 推断。`roleResolution` / `selectedBlueprint` 是 Registry 事实。禁止混在同一字段。  
Skill 同理：Need → Search → 已有 skillKey；找不到则 `unresolvedCapability`，禁止自由生成 skillKey 或自动创建生产 Skill。

### DEC-B11 · Creation Session 只做幂等

`CreationSession` + `idempotencyKey` 防止重复确认创建两个 Agent。它不是员工身份，不得替代 `agentId`。

### DEC-B12 · Factory Adapter

P4 只允许：

```text
Confirmed Blueprint → Factory Adapter → 现有 agents.create
```

禁止新建 Digital Employee Factory。Adapter 负责把 Blueprint 编译成现有 Factory 参数。`blueprintVersion` 必须写入绑定；`upgrade()` 不在本文范围。

### DEC-B13 · Confirm 与 Factory 断开

Confirm 阶段无生产副作用。Factory 阶段才允许 workspace / agent / bind / 确认后的 skill 安装 / Receipt。  
Skill 安装失败且 Agent 已在 → 正式状态 `PARTIAL`（已创建，部分能力待配置），不得只报「创建成功」。

### DEC-B14 · 入口优先级

AI-first，Role-assisted，Template-assisted。三入口同一 Draft。映射旧模板，不迁移存量 Agent。

---

## 3. 创建链路（冻结）

```text
USER INTENT
    ↓
Employee Design Intent
    ↓
Role Resolution ──→ Published Blueprint? ──→ Draft（标准或自定义）
    ↓
Human Confirmation（确认卡 = 首发体验 MVP）
    ↓
Existing Agent Factory
    workspaces.create → agents.create → robots.bind-workspace
    ↓
Agent (agentId)
    ├── blueprintBinding
    ├── installed skillKeys
    ├── growthProfile
    └── Creation Receipt（记录，非真源）
    ↓
Digital Employee（产品投影，不是新行）
```

创建之后的工作入口仍是 Conversation / Task / Cron，不是 Factory。

### 3.1 首发体验切口

差异化只要求：

```text
说需求 → AI 设计 →「我理解的是…」→ 确认 / 自然语言修订
```

确认卡是创建流程的核心 MVP。入口优先级见 DEC-B14。确认卡展示设计映射（需求→角色/能力/边界），不展示 Chain of Thought。

创建成功页首发 = 现有「我的机器人」表面投影 Blueprint，不另造数字员工首页 Runtime。提供「开始对话」，不自动开聊任务。

### 3.2 兼容映射（声明，不批准破坏性迁移）

| 现网 `templateId`         | 首发 Published Blueprint / Recipe           |
| ------------------------- | ------------------------------------------- |
| `generic_worker`          | 通用办公 / 通用办公助理                     |
| `contract_reviewer`       | 法务与风控 / 合同审查员                     |
| `sales_assistant`         | 销售与客户 / 销售助理                       |
| `personal_mail_assistant` | **降级为邮件 RoleRecipe**，不再作为一级角色 |

老机器人继续按 `agentId` 运行。新建走 Blueprint。禁止一次性改写存量实例。

---

## 4. 阶段门（与编码准入）

| 阶段 | 做什么                                                                         | 本文是否批准编码                                         |
| ---- | ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| P0   | 现状审计 + 本文冻结                                                            | 已完成（审计 + 本文）                                    |
| P1   | Types + State + Invariants + Ownership                                         | **规格与契约测试可做**；不调模型、不调 Factory           |
| P2   | Design Compiler D1–D4 + 输出/校验合同                                          | **规格与离线验证可做**；**不批准生产实现**               |
| P3   | Preview / Confirmation Card                                                    | 已准入并落地（[`./p3-admission.md`](./p3-admission.md)） |
| P4   | 接入现有 `agents.create`，收回模板自动授权                                     | 已准入并落地（[`./p4-admission.md`](./p4-admission.md)） |
| P5   | 三入口汇聚                                                                     | 未开                                                     |
| P6+  | 版本继承 / 企业 Blueprint / Lock / Memory Runtime / Task Pattern / Marketplace | 明确后置                                                 |

P1 不得实现 Designer 调模型。P2 生产实现未批准。P4 之前不得把 Role Template 自动授权带进新链路。P4 开始前必须冻结 Requirements §8 所列 9 项（输出 Contract、生命周期、Resolution、Validation、Session、Adapter、PARTIAL、数据面、高风险 recommendation-only）。

---

## 5. 不变量（DEC-I）

| 号          | 不变量                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------ |
| **DEC-I1**  | 运行时员工身份只有 `agentId`                                                                     |
| **DEC-I2**  | 未确认 Draft 不得创建 Agent                                                                      |
| **DEC-I3**  | Designer 失败或用户放弃 = 零生产副作用（无 agent / workspace / 账号 / 权限 / skill 安装 / 任务） |
| **DEC-I4**  | 确认后可装 skill；不可自动绑账号、授写/发/发布权限                                               |
| **DEC-I5**  | RoleRecipe 不新增 skill 实现                                                                     |
| **DEC-I6**  | Tenant Capability Pack ID 与 RoleRecipe ID 命名空间隔离                                          |
| **DEC-I7**  | 创建流程不写 ConversationTask / Cron / Ledger 行                                                 |
| **DEC-I8**  | Blueprint 不含真实企业 Memory / Knowledge / 客户数据                                             |
| **DEC-I9**  | Growth Template 与 Blueprint 双轨并存                                                            |
| **DEC-I10** | Creation Receipt 丢失不得改变 Agent 运行语义                                                     |
| **DEC-I11** | 未确认 Draft 可以不完整；禁止用编造补全高风险权限                                                |
| **DEC-I12** | Inference 字段不得冒充 Resolution 事实                                                           |
| **DEC-I13** | 禁止发明不存在的 skillKey；禁止 Designer 创建生产 Skill                                          |
| **DEC-I14** | 同一 CreationSession 幂等键最多实例化一个 Agent                                                  |
| **DEC-I15** | Designer 只读受控目录（DEC-F8）；失败/放弃 = 零生产副作用且无企业外部副作用                      |
| **DEC-I16** | `invalid` Draft 不得进入确认卡；`valid_with_gaps` 可以                                           |
| **DEC-I17** | Agent 成功但 skill 部分失败 = `PARTIAL`，不得伪造成整体成功                                      |
| **DEC-I18** | Factory 只经 Adapter 调用现有 `agents.create`；Draft 不得预分配 `agentId`                        |

---

## 6. 安全验收（接入 P4 前必须有测试）

沿用并升格为创建链路门禁：

| 号         | 断言                                                |
| ---------- | --------------------------------------------------- |
| **S1**     | Blueprint 不得授予权限                              |
| **S2**     | RoleRecipe 不得自动获得 Account                     |
| **S3**     | Role 不得绕过 ACL / Policy                          |
| **S4**     | Designer 不得直接创建生产 Agent                     |
| **S5**     | Designer 不得产生外部副作用                         |
| **S6**     | Blueprint 不得包含真实企业数据                      |
| **S-auto** | 销售/邮件等旧模板的自动授权路径不得被新确认链路复用 |

---

## 7. 最终模型（一句话）

```text
Blueprint = 设计
Agent     = 人（agentId）
Skill     = 能力
Policy    = 权限
Task      = 工作
Execution = 一次执行
Ledger    = 事实
Audit     = 历史
```

用户体验从「填表创建」升级为「说需求 → 确认」；技术上不推翻现有 Agent / Skill / Policy / Task / Ledger。
