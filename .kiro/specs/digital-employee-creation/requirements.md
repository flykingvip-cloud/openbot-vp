# Digital Employee Creation — Requirements

> 产品目标：用户描述想要的数字员工，OpenBot **编译**成受约束的设计草稿并请人确认，再由现有 Agent Factory 实例化。  
> 权威边界：[`./architecture-principles.md`](./architecture-principles.md)（`DEC-F*` / `DEC-B*` / `DEC-I*`）。  
> P1/P2 合同细节：[`./p1-p2-design-baseline.md`](./p1-p2-design-baseline.md)。  
> 状态：**P0 原则冻结 + 本 Requirements 已作为 P1/P2 设计基线。**  
> **批准：** P1/P2 规格细化与离线验证。  
> **不批准：** P2 Designer 进入实现 / 生产自动创建。P4 Factory Adapter 另开准入。

## 0. 产品语言（必须一致）

| 对象                       | 产品说法                     | 只决定                                         |
| -------------------------- | ---------------------------- | ---------------------------------------------- |
| **Blueprint**              | 应该成为谁                   | 设计：职责、记忆声明、工作模式、策略建议、交互 |
| **RoleRecipe**             | 成为这个角色需要哪些标准能力 | 组合：引用已有 `skillKey`                      |
| **Skill**                  | 这些能力如何真正执行         | 实现：Skill Registry                           |
| **Policy / ACL / Account** | 被允许做什么                 | 授权：现有企业门                               |
| **Agent / agentId**        | 这个数字员工是谁             | 运行时身份                                     |
| **Digital Employee**       | 用户看见的员工               | Agent + Blueprint 投影，不是新主键             |

Designer 不是「替用户创建一个机器人」的模块，而是 **Employee Design Compiler**：把自然语言用工需求编译成结构化、可校验的员工设计草稿。

入口优先级（P5 体验，P1 先写进合同）：

1. **默认：AI 创建**（说需求）
2. **次级：从角色开始**（Role-assisted）
3. **管理员：企业模板**（Template-assisted）

三个入口必须汇入**同一份 Draft**。禁止三套创建逻辑。视觉上不得把三个入口做成平级主按钮。

## 1. 目标

1. 创建主路径：描述工作 → Design Compiler →「我理解的是…」→ 确认 / 自然语言修订。
2. 运行时身份只有现有 `agentId`。`agentId` 只能由现有 `agents.create` 产生（`DEC-I8` / `DEC-I1`）。
3. Blueprint 只描述如何创建；Skill Registry 描述会什么；Policy/ACL/Account 描述允许做什么。
4. Confirm 之前零生产副作用；Confirm 之后才进入 Factory。
5. 确认后可安装 **已存在** 的 skill；不可自动绑账号或授权；不可发明 skillKey；不可自动生成生产 Skill。
6. 创建流程不自动产生 ConversationTask、Cron、Mission、Ledger 行或外部业务写入。
7. 不确定时产出**不完整 Draft**，不得编造完整高权限员工。
8. 旧模板只做**映射解释层**，不做破坏性迁移。存量 Agent 继续按 Legacy Template 运行。

## 2. 非目标

- 第二套 DigitalEmployee 运行时实体
- 用 Blueprint 覆盖 Growth Template
- Tenant Capability Pack 与 RoleRecipe 共用类型/ID
- Designer 读取 CRM / 企业 Memory / 私有文档 / 会话 / 账号 token
- Designer 自动创建自定义 Skill
- Override / Lock / `upgrade()` / 企业继承 / 行业 Blueprint / Memory Runtime 重写
- 创建成功后另造数字员工首页 Runtime
- Marketplace（能力缺口字段可预留，产品不做市集）
- P2 直接进入生产自动创建

## 3. 正式状态机（UI 与 API 同名）

创建会话（`CreationSession`）状态：

```text
DESIGNING → DRAFT → REVISING → READY_FOR_CONFIRMATION → CONFIRMED → INSTANTIATING → INSTANTIATED | PARTIAL | FAILED
```

| 状态                     | 含义                                 | 可否 `agents.create` |
| ------------------------ | ------------------------------------ | -------------------- |
| `DESIGNING`              | Compiler 运行中                      | 否                   |
| `DRAFT`                  | 已有结构化草稿，可含缺口             | 否                   |
| `REVISING`               | 用户自然语言修订                     | 否                   |
| `READY_FOR_CONFIRMATION` | `validation.status` 允许展示确认卡   | 否                   |
| `CONFIRMED`              | 用户确认，持有幂等键                 | 是，且仅此之后       |
| `INSTANTIATING`          | Factory Adapter 已开始生产副作用     | 进行中               |
| `INSTANTIATED`           | Agent 已存在；skill 全部装上或无待装 | —                    |
| `PARTIAL`                | Agent 已存在；部分 skill 失败        | —                    |
| `FAILED`                 | Factory 失败；按现有补偿回滚         | —                    |

**DEC-I2：** 未确认 Draft 不得创建 Agent。  
`READY_FOR_CONFIRMATION` 仍不是创建许可；只有 `CONFIRMED` 才是。

Draft **可以不完整**。缺关键政策/职能输入时必须带 `unresolvedQuestions` / `missingCriticalInputs`，不得补造 ERP write / 付款 / 财务写入等权限建议。

## 4. 事务边界

| 阶段                                            | 允许                                                                                                     | 禁止                                        |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Confirm 之前**（Designer / Draft / Revision） | 读受控目录；写 Draft / Session                                                                           | 任何生产副作用                              |
| **Confirm 之后**（Factory）                     | `workspaces.create` → `agents.create` → `robots.bind-workspace` → 确认后的 skill 安装 → Creation Receipt | 绑账号、授权限、建 Task/Cron/Mission/Ledger |

Confirm 与 Factory **严格断开**。确认按钮不得内联调用 LLM 再 create。  
重复点击确认必须由 `CreationSession.id` + `idempotencyKey` 收敛为一次实例化。

Designer 零副作用的完整清单：

- 不产生 Agent / Workspace
- 不绑 Account、不授 Permission
- 不安装 Skill
- 不写 Cron / ConversationTask / Mission / Ledger Event
- 不调用企业外部业务 API，不外泄企业数据

Designer 默认只读：Role / Skill / Recipe / Blueprint Registry、Policy Schema、Product Capability Catalog。  
默认不得读：CRM 客户数据、企业 Memory、私有文档、会话历史、账号 token、敏感数据集。

## 5. Design Compiler（产品合同）

不是「一个 LLM 模块」。四步流水线，一步只回答一个问题：

| 步                           | 只回答                                | 一等输出                                                                              |
| ---------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------- |
| **D1 Intent Extraction**     | 用户想让这个数字员工做什么            | outcomes / responsibilities / constraints / schedule / delivery / policy requirements |
| **D2 Role Resolution**       | 最接近哪个**已发布** Role / Blueprint | `roleHypothesis`（推断）与 `roleResolution`（事实）必须分字段                         |
| **D3 Blueprint Composition** | 组合成什么样的员工                    | Role + Recipe + Memory Schema + Interaction + Policy **Recommendation**               |
| **D4 Validation**            | 这份草稿能不能给用户看                | `BlueprintValidation`；非法则不得进入确认卡                                           |

D2 强约束：有 Published Blueprint 必须优先复用。用户说「创建销售助理」必须命中标准 `sales_assistant`，不得让模型另造一份。

D3 能力解析：Need → Skill Search / Match → **已有** `skillKey`。找不到则 `unresolvedCapability` / 能力缺口，**禁止发明 skillKey**，禁止自动生成生产 Skill。

确认卡必须展示「设计映射」而不是思维链：

- 展示：你的需求条目 → 角色 / 能力 / 工作模式 / 安全边界
- 可展示：结构化需求依据（核心职责、主要交付、工作方式）
- 禁止：Chain of Thought、「我猜你喜欢分析数据」之类模型解释

解释不是第二份事实。事实字段是 `roleResolution`、`skillRecommendations`（已解析）、`validation`。

## 6. 对象职责（验收用语）

- Blueprint 决定「应该成为谁」。
- RoleRecipe 决定「为成为这个角色需要哪些标准能力」。
- Skill 决定「这些能力如何真正执行」。
- Policy 决定「被允许做什么」；Blueprint 里只有 recommendation。
- Factory Adapter 决定「Confirmed Blueprint 如何变成现有 `agents.create` 参数」。P4 只做适配，不新建 Digital Employee Factory。

首发必须预留 `blueprintId` + `blueprintVersion`，**不实现** `upgrade()`。  
Creation Receipt（原 Binding Manifest）只证明「当时怎么创建的」，不是运行时真源。

旧模板映射，不是迁移：

| Legacy `templateId`       | 新解释层                          |
| ------------------------- | --------------------------------- |
| `generic_worker`          | 通用办公 / 通用办公助理           |
| `contract_reviewer`       | 法务与风控 / 合同审查员           |
| `sales_assistant`         | 销售与客户 / 销售助理             |
| `personal_mail_assistant` | 邮件 RoleRecipe（不再是一级角色） |

`Legacy Agent → Legacy Template` 继续成立。`New Creation → Blueprint → Agent` 并行。禁止改写存量实例。

## 7. P1 必须交付的不变量（不是只交 Type）

P1 输出 = **Domain Types + State + Invariants + Ownership**。下列 `DEC-I*` 必须写成可测验收，不得只放注释。

| 不变量                            | P1 验收                                | 最早实现阶段    |
| --------------------------------- | -------------------------------------- | --------------- |
| DEC-I1 身份只有 `agentId`         | 类型/API 无第二员工主键                | P1              |
| DEC-I2 未确认不得创建             | 状态机：非 `CONFIRMED` 无 Factory 入口 | P1              |
| DEC-I3 / 零副作用                 | Designer 失败/放弃 = 上表全空          | P2 离线         |
| DEC-I4 确认后只装 skill           | Adapter 合同无 oauth/grant             | P1 合同 / P4 测 |
| DEC-I5 Recipe 只引已有 skill      | 未知 skillKey 校验失败                 | P1              |
| DEC-I6 Pack 命名空间隔离          | Recipe ID ≠ `CapabilityPackId`         | P1              |
| DEC-I7 不产生 Task/Cron/Ledger    | Factory 输入/输出无这些写点            | P1 合同 / P4 测 |
| DEC-I8 Blueprint 无企业真数据     | Draft 不含客户/token/文档原文          | P1              |
| DEC-I9 Growth 双轨                | Blueprint 不替换 `AgentTemplate`       | P1              |
| DEC-I10 Receipt 非真源            | Receipt 丢失不改变 Agent 语义          | P1 合同         |
| DEC-I18 `agentId` 仅 Factory 产生 | Designer/Draft 无 agentId 可写         | P1              |
| 不完整 Draft 合法                 | 缺关键输入仍可 `DRAFT`                 | P1              |
| Inference ≠ Resolution            | 两套字段，禁止合并                     | P1              |
| 禁止发明 skillKey                 | 自由字符串不得进入 resolved 列表       | P1              |
| Creation Session 幂等             | 同 key 不得双创建                      | P1 合同 / P4 测 |
| Designer 只读目录                 | 数据面 allowlist                       | P1 / P2 离线    |

## 8. 阶段与准入

| 阶段 | 内容                                                                    | 编码                                                                                                |
| ---- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| P0   | 审计 + 原则冻结                                                         | 已完成                                                                                              |
| P1   | Types + State + Invariants + Ownership                                  | **契约测试绿（cursor-dec-p1）**；不调模型、不调 Factory                                             |
| P2   | Design Compiler：D1–D4 + 输出 Contract + Validator                      | **P2-OFFLINE 完成**（[`./p2-offline-admission.md`](./p2-offline-admission.md)）；**不批准生产实现** |
| P3   | 确认卡：映射依据 + 自然语言 Revision                                    | **完成**（[`./p3-admission.md`](./p3-admission.md)）                                                |
| P4   | Factory Adapter → 现有 `agents.create`；部分成功语义；收回自动授权      | **完成**（[`./p4-admission.md`](./p4-admission.md)）                                                |
| P5   | 三入口汇聚，AI-first                                                    | 未开                                                                                                |
| P6+  | Upgrade / Lock / 企业目录 / Memory Runtime / Task Pattern / Marketplace | 后置                                                                                                |

### P4 开始前必须再冻结（本 Requirements 已立项，细节在 P1/P2 baseline）

1. Designer 结构化输出 Contract
2. Draft / Revision / Confirmed 生命周期
3. Role Resolution 与 Skill Resolution 规则
4. Blueprint Validation 规则
5. Creation Session / Idempotency
6. Factory Adapter 与 `agents.create` 边界
7. Skill 安装失败的 `PARTIAL` 语义
8. Designer 可访问数据范围
9. 高风险 Policy 仅 recommendation

## 9. 验收用例（产品 + 安全）

| 用例         | 输入                                     | 期望                                                               |
| ------------ | ---------------------------------------- | ------------------------------------------------------------------ |
| A 标准角色   | 「创建销售助理，跟进 CRM，出销售周报」   | Resolution = `sales_assistant`；skill 来自 Registry；policy 为推荐 |
| B 无职位名   | 「每天看销售数据，异常提醒，每周一总结」 | 推断销售运营/分析类；用户不必先选角色                              |
| C 组合       | 「监控竞品价格、分析内容、每周报告」     | 标准或自定义 Draft；缺口显式列出                                   |
| D 只读       | 「能看 CRM，不能改 CRM」                 | write = disabled/recommendation；无真实授权变更                    |
| E 高风险     | 「可以直接发公众号」                     | riskFlag + 待确认；不得授权                                        |
| F 修订       | 先「销售助理」再「CRM 只读」             | 同一 Creation Session 的 Draft Revision，不新建 Agent              |
| G 版本字段   | 创建后                                   | 写入 `blueprintVersion`；无 upgrade API                            |
| H 能力复用   | 邮件 Recipe                              | 多角色引用同一 `skillKey`，不复制实现                              |
| I 不完整     | 「我要一个财务助理」                     | Draft 带 `missingCriticalInputs`；不得编造财务 write               |
| J 未知能力   | 「分析客户流失」且 Registry 无对应 skill | `unresolvedCapability`，不发明 key                                 |
| K 双击确认   | 连续两次确认                             | 只创建一个 Agent                                                   |
| L 部分安装   | Factory 成功、1 个 skill 失败            | Agent 存在；状态 `PARTIAL`；不得只显示「创建成功」                 |
| M 放弃       | Designer 失败或用户关闭                  | 零副作用清单全空                                                   |
| N 映射不迁移 | 存量销售助理                             | 仍按 legacy template 运行                                          |

体验：简单员工从自然语言到可确认 Draft，普通场景 0–3 个关键问题，不出现 AI 表单问卷。确认卡是体验 MVP。

## 10. 最终产品模型

```text
用户的一句话
    → Design Compiler (D1–D4)
    → Intent / Role Resolution / Validation
    → 「我理解的是…」（设计映射）
    → 调整 = Draft Revision | 确认 = CONFIRMED
    → Factory Adapter
    → 现有 agents.create
    → Agent (agentId) + Skills + Growth Profile + Creation Receipt
    → Digital Employee（产品投影）
```
