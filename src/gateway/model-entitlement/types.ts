/**
 * 模型 Entitlement 链 — 类型定义（P1）。
 *
 * 设计：`.kiro/specs/model-entitlement-chain/design.md`（§5 Data Models）。
 *
 * 本文件为纯类型 + 纯函数内核服务，**不得** import 任何 IO / gateway / lit，
 * 以便 `effective-set.ts` 可被 node 环境属性测试覆盖。
 *
 * 关键不变量：
 * - hard deny：运行时可用候选 ∈ EffectiveModelSet（Property 7）。
 * - 两态区分：entitlement「未配置/未迁移」(missing) vs「已解析但为空」(resolved+空集)。
 */

/** 模型引用（canonical `provider/model` 形式，如 "api-proxy-deepseek/deepseek-chat"）。 */
export type ModelRef = string;

/**
 * 平台模型目录条目（模型引用真源）。
 * `credentialRef` 为 P4 目标态字段：P1/P2 阶段运行时仍走现有 model-auth.ts 链，
 * 目录只约束「能引用哪些 modelId」。
 */
export type PlatformModelCatalogEntry = {
  modelId: ModelRef;
  provider: string;
  displayName: string;
  status: "active" | "deprecated";
  /** P4 启用：运行时 key 收敛到该引用。P1/P2/P3 不强制。 */
  credentialRef?: string;
};

/** 模型维度额度（可选；最终归集口径见 design §10）。 */
export type ModelQuota = {
  /** 周期内允许的最大请求数（可选）。 */
  maxRequests?: number;
  /** 周期内允许的最大 token 数（可选）。 */
  maxTokens?: number;
};

/**
 * Phase 4：模型级预算分账（**独立结构，绝不复用 modelQuota guardrail**）。
 *
 * 与套餐总预算（Credits / CreditBucket）口径分离：
 * - `modelQuota` = 模型级请求/Token guardrail（限流），不决定预算。
 * - `ModelBudget` = 模型级 Credits / 供应商花费预算上限，按 UsageLedger 的
 *   per-model `creditsCharged` / `providerCostCents` 周期归集核算（口径独立于套餐总额度）。
 *
 * 该结构只决定「单模型的预算上界」，不参与、不改写套餐总 Credits 主链。
 */
export type ModelBudget = {
  /** 周期内该模型允许消耗的最大 Credits（可选）。 */
  monthlyCreditsCap?: number;
  /** 周期内该模型允许产生的最大供应商花费（整数分，可选）。 */
  spendCapCents?: number;
};

/** AOR 执行策略（已存在于投影 platform-models-aor-projection；P3 才强制消费）。 */
export type PlanModelAorExecution = {
  taskTypeId: string;
  selectorStrategy: "cheapest" | "best_quality" | "balanced" | "bandit";
  evaluatorMode: string;
};

/**
 * plan_version → 模型绑定（旁路映射表，不污染 billing core）。
 * 键为已锁定的 `planVersionId`（与计费一致）；企业 entitlement 由此投影而来（§5.2）。
 *
 * 这是该绑定的**单一公共契约**：store / RPC / 企业投影均消费此类型
 * （`plan-version-model-binding-store.ts` 直接 import 本类型，避免类型语义分裂）。
 */
export type PlanVersionModelBinding = {
  planVersionId: string;
  /** 该套餐版本可用模型集合（modelRef，指向平台目录）。 */
  allowedModelIds: ModelRef[];
  /** 可选：允许的资源层级（Package V2；Phase 3 起为配置真源，allowedModelIds 为派生缓存）。 */
  allowedTiers?: string[];
  /** 可选：允许的路由策略（Package V2 Phase 2）。 */
  allowedPolicies?: string[];
  /** 可选：默认路由策略 ID。 */
  policyId?: string;
  /** 可选：模型维度额度 guardrail（key = modelId，value = { maxRequests?, maxTokens? }）。 */
  modelQuota?: Record<string, ModelQuota>;
  /** 可选：模型级预算分账（Phase 4，key = modelId；独立于 modelQuota，口径分离于套餐总 Credits）。 */
  modelBudgets?: Record<string, ModelBudget>;
  /** 可选：AOR 执行策略（P3 消费）。 */
  aorExecution?: PlanModelAorExecution;
  updatedAt: string;
};

/** 企业模型 entitlement（由订阅锁定的 planVersionId 投影；独立 store，不复用 seat assets）。 */
export type EnterpriseModelEntitlement = {
  tenantId: string;
  /** 来自当前订阅的已锁定版本；P1 可为空（手工/迁移写入），P2 起由投影维护。 */
  planVersionId?: string;
  allowedModelIds: ModelRef[];
  /** 关联企业预算引用（口径见 design §10）。 */
  budgetRef?: string;
  updatedAt: string;
};

/** 模型授权主体类型：席位级 或 员工级。 */
export type ModelGrantSubjectType = "seat" | "employee";

/**
 * 模型授权（独立 store，不扩展 EnterpriseManagedAssetType）。
 * 支持 seat 级与 employee 级两种粒度（design §5.4「seat / employee 授权」）：
 * - `subjectType="seat"`：授权跟随席位（交接后自然跟 seat 走）。
 * - `subjectType="employee"`：授权绑定到具体员工，优先级高于 seat 级。
 */
export type SeatModelGrant = {
  tenantId: string;
  subjectType: ModelGrantSubjectType;
  /** 主体 id：seat 级为 seatId，employee 级为 employeeId。 */
  subjectId: string;
  /** 描述性字段（便于排查/审计），不参与 key。 */
  seatId?: string;
  employeeId?: string;
  /** 必须 ⊆ EnterpriseModelEntitlement.allowedModelIds（越权授权在 RPC 层被拒）。 */
  grantedModelIds: ModelRef[];
  status: "active" | "revoked";
  updatedAt: string;
};

/**
 * EffectiveModelSet 解析状态：
 * - `missing`：该租户尚无已解析的 entitlement 记录（未配置/未迁移）→ 交灰度开关。
 * - `resolved`：已解析；此时 `allowedModelIds` 可能为空数组（= 已解析但为空 → hard deny）。
 */
export type EntitlementResolutionState = "missing" | "resolved";

/** EffectiveModelSet 计算结果。 */
export type EffectiveModelSetResult = {
  allowedModelIds: ModelRef[];
  state: EntitlementResolutionState;
  /** 人类可读原因（审计 / 拒绝提示）。 */
  reason: string;
  /** 该结果的主要约束来源，便于排查。 */
  source: "entitlement" | "grant" | "catalog" | "none";
  budgetRef?: string;
};
