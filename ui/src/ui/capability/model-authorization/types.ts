/**
 * 模型授权（Model Authorization）UI 侧纯类型。
 *
 * 设计：`.kiro/specs/model-entitlement-chain/design.md`（§4.1, §8.2, R2.1/R3.1/R4.1）。
 *
 * 这些类型镜像网关侧 `src/gateway/model-entitlement/types.ts` 的对外形态，
 * 供企业端「模型授权」操作面（任务 11）与员工端只读可用模型（任务 12）共享。
 * 仅 `type` 别名，不含 `interface`，不 import 任何 lit / IO。
 */

/** 模型引用（canonical `provider/model` 形式）。 */
export type ModelRef = string;

/** 授权主体类型：席位级 或 员工级。 */
export type ModelGrantSubjectType = "seat" | "employee";

/** AOR 执行策略（P3 消费；此处仅透传展示）。 */
export type PlanModelAorExecution = {
  taskTypeId: string;
  selectorStrategy: "cheapest" | "best_quality" | "balanced" | "bandit";
  evaluatorMode: string;
};

/** 模型维度额度。 */
export type ModelQuota = {
  maxRequests?: number;
  maxTokens?: number;
};

/** 套餐版本 → 模型绑定（平台侧维护）。 */
export type PlanVersionModelBinding = {
  planVersionId: string;
  allowedModelIds: ModelRef[];
  modelQuota?: Record<string, number>;
  aorExecution?: PlanModelAorExecution;
  updatedAt: string;
};

/** 企业模型 entitlement（由订阅投影；企业可见的授权上限）。 */
export type EnterpriseModelEntitlement = {
  tenantId: string;
  planVersionId?: string;
  allowedModelIds: ModelRef[];
  budgetRef?: string;
  updatedAt: string;
};

/** 模型授权记录（seat / employee 粒度）。 */
export type SeatModelGrant = {
  tenantId: string;
  subjectType: ModelGrantSubjectType;
  subjectId: string;
  seatId?: string;
  employeeId?: string;
  grantedModelIds: ModelRef[];
  status: "active" | "revoked";
  updatedAt: string;
};

/** 员工端只读可用模型解析状态（与网关 EffectiveModelSet 两态对齐）。 */
export type EntitlementResolutionState = "missing" | "resolved";

/** 员工端「我能用哪些模型 + 为何被拒」只读摘要。 */
export type EmployeeModelEntitlementSummary = {
  /** 当前员工实际可用的模型集合。 */
  modelIds: ModelRef[];
  /** 解析状态：missing（未配置/未迁移）vs resolved（已解析，可能为空）。 */
  state: EntitlementResolutionState;
  /** 人类可读说明（可用 / 被拒原因）。 */
  reason: string;
  /** 当前 seat（便于员工理解授权来源）。 */
  seatId?: string;
};
