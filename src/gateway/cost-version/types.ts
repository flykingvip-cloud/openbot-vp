/**
 * CostVersion — 供应商成本版本快照（Package V2 Phase 4）。
 *
 * 与 Resource Catalog 解耦落盘：激活后冻结模型成本，供 ledger 归因。
 * 金额：每百万 token 的整数分（cents）。
 */

export type ModelCostSnapshot = {
  modelId: string;
  tier: string;
  inputCostPer1MCents: number;
  outputCostPer1MCents: number;
  /** 未配置时不要当成已知 0；有缓存用量时由 OrMissing 判缺失。 */
  cacheReadCostPer1MCents?: number;
  cacheWriteCostPer1MCents?: number;
};

export type CostVersionStatus = "active" | "draft" | "deprecated";

export type CostVersion = {
  id: string;
  version: number;
  status: CostVersionStatus;
  modelCosts: Record<string, ModelCostSnapshot>;
  createdAt: string;
  activatedAt?: string;
};
