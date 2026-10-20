/**
 * 平台「套餐⇄模型」统一配置 UI 侧纯类型（P6）。
 *
 * 设计：`.kiro/specs/model-entitlement-chain/design.md`（§5.2 旁路表保持解耦；§8.2 平台端）。
 *
 * 数据层仍解耦（billing plan / plan-model-binding 两个 store），本模块只把网关聚合的
 * `platform-model-binding.overview` 投影成"单一真相视图"供平台运营操作。
 */

export type ModelRef = string;

export type PlanModelAorExecution = {
  taskTypeId: string;
  selectorStrategy: "cheapest" | "best_quality" | "balanced" | "bandit";
  evaluatorMode: string;
};

/** 每模型 guardrail：周期内 { 最大请求数, 最大 token 数 }（均可选）。 */
export type PlanModelQuotaEntry = {
  maxRequests?: number;
  maxTokens?: number;
};

/** 一个套餐（当前版本）在统一视图里的行。 */
export type PlanModelRow = {
  planId: string;
  name: string;
  status: string;
  currentVersionId: string;
  allowedModelIds: ModelRef[];
  aorExecution?: PlanModelAorExecution;
  modelQuota?: Record<string, PlanModelQuotaEntry>;
};

/** `platform-model-binding.overview` 聚合结果。 */
export type PlatformModelBindingOverview = {
  /** 平台目录上界（active modelRef 全集）。 */
  catalog: ModelRef[];
  /** 各套餐当前版本的模型绑定。 */
  plans: PlanModelRow[];
  /** 反向索引：modelId → 含它的 planId 列表（N:N 视图）。 */
  reverseIndex: Record<ModelRef, string[]>;
};
