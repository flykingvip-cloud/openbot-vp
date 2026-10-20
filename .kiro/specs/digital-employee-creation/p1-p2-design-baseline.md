# Digital Employee Creation — P1/P2 Design Baseline

> **状态:** 规格基线。**批准：** 领域合同、离线校验、契约测试。**不批准：** P2 Designer 生产实现、自动创建、调用 Factory。  
> **服从：** [`./architecture-principles.md`](./architecture-principles.md)、[`./requirements.md`](./requirements.md)。  
> **日期:** 2026-09-17

本文把「原则正确、实现时容易被自行解释」的点写成合同。类型片段是 **illustrative**，不是落表/落 RPC 批准。

---

## 1. P1 交付物

必须同时有四类，缺一不可：

1. **Domain Types** — Intent / Hypothesis / Resolution / Draft / Recipe / Session / Receipt / Validation
2. **State** — `CreationSession.status` 与 Draft 修订号
3. **Invariants** — `DEC-I*` 映射为可断言测试
4. **Ownership** — 谁写、谁只读、谁禁止调用

P1 **不得**：调用模型、调用 `agents.create` / `workspaces.create`、安装 skill、读写企业业务数据。

---

## 2. Design Compiler（D1–D4）

Designer = **Employee Design Compiler**，不是「一个 LLM 功能」。

```text
User Intent
  → D1 Intent Extraction
  → D2 Role Resolution
  → D3 Blueprint Composition
  → D4 Validation
  → Blueprint Draft
  → Human Confirmation
```

| 步  | 可调用                             | 禁止                                       |
| --- | ---------------------------------- | ------------------------------------------ |
| D1  | 读用户原文；产出 Intent 字段       | 选 Blueprint、发明 skill、谈授权结果       |
| D2  | 读 Published Blueprint / Role 目录 | 把 hypothesis 写成 selected；跳过 Registry |
| D3  | 读 Recipe / Skill 目录做 **match** | 发明 skillKey；生成生产 Skill；写账号      |
| D4  | 纯函数校验                         | 为通过校验而补造权限或能力                 |

LLM 若存在，只允许出现在 D1（以及 D3 的「需求→已有目录检索查询」）。D2/D4 必须是确定性规则。禁止 `User Prompt → LLM → 巨大 JSON` 单跳。

---

## 3. Inference ≠ Resolution

```ts
type RoleHypothesis = {
  family: string;
  role: string;
  confidence: number;
  evidence: string[]; // 映射自用户原句，不是 CoT
};

type RoleResolution =
  | {
      kind: "published";
      blueprintId: string;
      blueprintVersion: string;
      matchedBy: "exact" | "alias" | "family";
    }
  | { kind: "custom_draft"; reason: string };

type SkillRecommendation = {
  need: string;
  skillKey?: string; // 仅 Registry 命中时存在
  status: "resolved" | "unresolved";
  unresolvedReason?: string;
};
```

禁止用同一个字段既表示「模型觉得是销售助理」又表示「目录已选定 sales_assistant」。  
`roleHypothesis` 丢失不得冒充 `roleResolution`。  
`skillRecommendations[].skillKey` 必须存在于 Skill Registry；否则 `status=unresolved`。

---

## 4. BlueprintDraft 输出 Contract

```ts
type BlueprintDraft = {
  draftId: string;
  revision: number;
  source: "ai" | "role_chip" | "enterprise_template";

  roleHypothesis: RoleHypothesis;
  roleResolution: RoleResolution; // 事实；custom 时无 published id

  responsibilities: string[];
  objectives: string[];

  roleRecipeIds: string[];
  skillRecommendations: SkillRecommendation[];

  memorySchema: {
    entities: string[];
    memoryTypes: string[];
    priority?: string[];
  };

  taskPatterns: Array<{ id: string; label: string }>; // 声明，不创建任务
  toolRecommendations: Array<{ id: string; mode: "recommended" }>;
  policyRecommendations: Array<{
    id: string;
    effect: "recommended" | "confirmation_required" | "disabled";
    risk: "low" | "high";
  }>;

  interactionProfile: { proactiveLevel: string; responseStyle: string };

  unresolvedQuestions: Array<{ id: string; text: string; changes: string[] }>;
  missingCriticalInputs: string[];
  unresolvedCapabilities: string[];
  riskFlags: Array<{ id: string; summary: string }>;

  validation: BlueprintValidation;

  // 禁止字段
  // agentId, accountBindings, grantedPermissions, conversationTaskId, cronId
};
```

`unresolvedQuestions` / `missingCriticalInputs` / `unresolvedCapabilities` 是一等输出。  
高风险写/发/发布只能是 `confirmation_required` 或 `disabled`，不能是已授权。

---

## 5. Blueprint Validation

```ts
type BlueprintValidation = {
  status: "valid" | "valid_with_gaps" | "invalid";
  checks: Array<{ id: string; ok: boolean; detail: string }>;
};
```

D4 必查：

| check                                  | 失败则                   |
| -------------------------------------- | ------------------------ |
| role 合法（published 或显式 custom）   | `invalid`                |
| recipeId 存在且非 `CapabilityPackId`   | `invalid`                |
| 每个 resolved skillKey 存在于 Registry | `invalid`                |
| 无 invented skillKey                   | `invalid`                |
| 无 account binding 字段                | `invalid`                |
| 无 granted permission 字段             | `invalid`                |
| 无真实企业数据（客户名/账号/token）    | `invalid`                |
| 无非法 tool / 外连写                   | `invalid`                |
| 高风险 policy 仅为 recommendation      | `invalid`                |
| 关键缺口已列入 missing/unresolved      | 否则不得装成「完整员工」 |

`valid` 与 `valid_with_gaps` 都可进入确认卡。  
`invalid` 不得进入 `READY_FOR_CONFIRMATION`。  
「完整」不是进入确认卡的条件；「诚实」才是。

---

## 6. Creation Session 与幂等

```ts
type CreationSession = {
  id: string;
  draftId: string;
  status:
    | "DESIGNING"
    | "DRAFT"
    | "REVISING"
    | "READY_FOR_CONFIRMATION"
    | "CONFIRMED"
    | "INSTANTIATING"
    | "INSTANTIATED"
    | "PARTIAL"
    | "FAILED";
  idempotencyKey: string;
  actorUserId: string;
};
```

这是创建过程对象，**不是**员工身份。禁止用 `session.id` 替代 `agentId`。

不变量：同一 `idempotencyKey` 在 `CONFIRMED` 之后最多实例化一个 Agent。

---

## 7. Confirm ≠ Factory

```text
Draft / Revision     = 无生产副作用
CONFIRMED            = 用户许可，仍未 create
Factory Adapter      = 开始生产副作用
```

```ts
// P4 概念；P1 只冻结签名
function buildAgentCreateRequest(
  session: CreationSession,
  confirmed: BlueprintDraft,
): AgentCreateRequest;
```

Adapter 只编译现有 `agents.create`（及前置 `workspaces.create`）参数。  
禁止 `Confirmed Blueprint → New Digital Employee Factory → Agent`。

`agentId` 不在 Draft 里预分配。只由 `agents.create` 返回。

---

## 8. Skill 安装部分成功

现网 `autoInstallCapabilitiesOnAgentCreate` 已是 best-effort。新链路必须诚实暴露：

```ts
type SkillInstallReport = {
  requested: string[];
  succeeded: string[];
  failed: Array<{ skillKey: string; reason: string }>;
};
```

- Agent 创建成功且 `failed.length > 0` → Session = `PARTIAL`
- UI 不得只显示「创建成功」
- 允许「已创建，部分能力待配置」
- 失败 skill 不得通过重试 Designer 发明替代 key

P4 接入时必须停止把 `TEMPLATE_AUTO_SKILL_KEYS` 的账号/发信默认授权带进新链路。

---

## 9. Creation Receipt

原 Binding Manifest。语义 = **这次 Agent 是怎么被创建出来的证明**。

```ts
type CreationReceipt = {
  agentId: string;
  blueprintId?: string;
  blueprintVersion?: string;
  roleRecipeIds: string[];
  skillKeysRequested: string[];
  skillInstall: SkillInstallReport;
  policyRecommendations: string[];
  createdByUserId: string;
  confirmedAt: string;
  creationSessionId: string;
};
```

丢失 Receipt 不得改变 Agent 运行。运行时不读 Receipt 做授权。

---

## 10. Designer 数据面

| Allow                                      | Deny（除非另开规格）         |
| ------------------------------------------ | ---------------------------- |
| Role / Blueprint / Recipe / Skill Registry | CRM / 业务库客户数据         |
| Policy Schema、Product Capability Catalog  | 企业 Memory、私有文档        |
| 用户本轮创建原文                           | 历史会话、账号 token、敏感集 |

D3「网页检索竞品」若指**员工未来的能力**，写在 recommendation 里；Designer 自己不得去抓取或读取企业竞品库。

---

## 11. 离线验证（P2 允许）

允许：给定固定 Intent 与固定 Registry 夹具，跑 D2/D4 纯函数；用固定 JSON 断言 Inference/Resolution 分离、禁止发明 skillKey、不完整 Draft、零禁止字段。

禁止：接线网关、对生产/开发租户调用模型创建、写 `openbot.json`。

P2-OFFLINE 书面准入：[`./p2-offline-admission.md`](./p2-offline-admission.md)。  
P2 生产实现另需**新的**书面编码准入；本文 + 离线准入不得被引用为生产开闸。
