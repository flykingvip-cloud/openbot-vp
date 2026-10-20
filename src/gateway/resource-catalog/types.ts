/**
 * Resource Catalog — 资源目录类型（Package V2 / Phase 1）。
 *
 * 与套餐解耦：Tier 与 Model 由平台独立维护；套餐通过 allowedTiers 引用能力层级，
 * 而非直接绑定 modelId。
 *
 * 金额约定：供应商成本字段 `*CostPer1M` 使用「每百万 token 的整数分（cents）」。
 */

/** 资源层级 ID（如 tier_a / tier_b / tier_c）。 */
export type ResourceTierId = string;

/** 模型引用（canonical `provider/model`）。 */
export type ModelRef = string;

/**
 * 资源层级定义。
 * Tier A = 低成本；Tier B = 平衡；Tier C = 高质量（默认语义，可扩展）。
 */
export type ResourceTier = {
  id: ResourceTierId;
  code: string;
  name: string;
  description: string;
  /** 展示排序（越小越靠前）。 */
  sortOrder: number;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
};

/** 模型能力标签（运营展示 / 路由理解）。 */
export type ResourceModelCapability =
  | "coding"
  | "reasoning"
  | "tool_use"
  | "vision"
  | "long_context";

/**
 * 平台模型目录条目（资源真源）。
 * 与 `cfg.models.providers` 可对齐，但 tier / 成本 / 启用态以此 store 为准。
 */
export type ResourceModelCatalogEntry = {
  modelId: ModelRef;
  provider: string;
  displayName: string;
  tier: ResourceTierId;
  enabled: boolean;
  contextWindow?: number;
  /** 运营能力标签；缺省时由 seed / UI 推断。 */
  capabilities?: ResourceModelCapability[];
  /** 单次任务平均 token 总量（可选）；用于 Avg Cost / Task 估算。 */
  avgTokensPerTask?: number;
  /** 输入成本：每 1M token，整数分。 */
  inputCostPer1MCents: number;
  /** 输出成本：每 1M token，整数分。 */
  outputCostPer1MCents: number;
  updatedAt: string;
};

/** Tier → Credit 权重（Credits 体系基础，Phase 3 消费）。 */
export type CreditWeight = {
  tier: ResourceTierId;
  creditCost: number;
  updatedAt: string;
  /** Credits v2：工具调用 benchmark（缺省 2）。 */
  v2ToolBenchmarkCalls?: number;
  /** Credits v2：运行时长 benchmark ms（缺省 30000）。 */
  v2RuntimeBenchmarkMs?: number;
};

/** Tier 内模型失败后的回退策略。 */
export type TierFailoverMode = "disabled" | "next_in_pool" | "fallback_tier";

/**
 * Tier 级熔断与 Fallback 规则（平台治理配置）。
 * 运行时 selector 可读取；P0 仅持久化 + 控制台编辑。
 */
export type TierFailoverRule = {
  tier: ResourceTierId;
  enabled: boolean;
  /** 失败率阈值 0–1；null 表示不按失败率触发。 */
  failureRateThreshold: number | null;
  /** 评估失败率前的最小样本数。 */
  minSampleSize: number;
  /** 连续失败次数达到后熔断。0 表示禁用此触发器。 */
  maxConsecutiveFailures: number;
  /** 延迟超过此值（ms）视为失败；0 表示禁用。 */
  latencyThresholdMs: number;
  /** 熔断后冷却秒数，再进入半开探测。 */
  cooldownSeconds: number;
  mode: TierFailoverMode;
  /** mode=fallback_tier 时的目标 Tier。 */
  fallbackTierId: ResourceTierId | null;
  /** 可选：fallback tier 内指定模型。 */
  fallbackModelId: ModelRef | null;
  updatedAt: string;
};

/** 从 tier 列表解析出的模型池（纯函数输出）。 */
export type TierModelPoolResult = {
  tierIds: ResourceTierId[];
  modelIds: ModelRef[];
  /** 按 tier 分组的模型。 */
  byTier: Record<string, ModelRef[]>;
};
