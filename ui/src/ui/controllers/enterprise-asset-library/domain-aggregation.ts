/**
 * 能力领域聚合工具（企业能力中心 · 第二屏"能力领域分布"）
 *
 * 将企业能力资产列表按 `CapabilityDomain` 聚合，得到第二屏视图所需的
 * `DomainDistribution[]`：
 *
 *   - capabilityCount         — 该领域下的能力数量
 *   - representativeCapabilities — 至多 3 个代表性能力名称
 *     · 排序键 1：成熟度 DESC（核心资产 > 企业标准 > 企业认证 > 多人复用 > 稳定使用 > 初步形成）
 *     · 排序键 2：valueSummary.monthlyExecutions DESC
 *   - coverageRate            — 领域覆盖率（%，四舍五入；总数为 0 时为 0）
 *
 * 输出列表按 `capabilityCount` DESC 排序；并列时按规范领域顺序兜底
 * （销售 → HR → 客服 → 财务 → 法务 → 数据分析），确保所有 6 个领域始终出现，
 * 即使该领域当前没有任何能力。
 *
 * Validates: Requirements 19.4, 19.5, 19.6
 *
 * 设计说明：
 * - 纯函数：不修改入参；对所有内部数组进行复制后再排序
 * - 联合输入：同时接受 `EnterpriseAssetListItem | EnterpriseCapabilityAsset`，
 *   两者共有 `domain`、`name`、`maturity`、`valueSummary` 字段，其余字段不参与聚合
 * - 本文件本地维护 `MATURITY_ORDER`，避免与 Task 2.4（`./ordering-utils.ts`）形成
 *   构建阻塞；如未来 ordering-utils 落地，可在不破坏外部 API 的前提下迁移导入
 */

import type {
  CapabilityDomain,
  CapabilityMaturity,
  DomainDistribution,
  EnterpriseAssetListItem,
  EnterpriseCapabilityAsset,
} from "../../capability/enterprise-capability/types.ts";
import { CAPABILITY_DOMAINS } from "../../capability/enterprise-capability/types.ts";

/**
 * 成熟度等级 → 数值映射（1–6）。用于"成熟度 DESC"排序：值越大越靠前。
 *
 * 与 design.md Property 9 的等级序保持一致：
 * 初步形成(1) < 稳定使用(2) < 多人复用(3) < 企业认证(4) < 企业标准(5) < 核心资产(6)
 */
const MATURITY_ORDER: Record<CapabilityMaturity, number> = {
  初步形成: 1,
  稳定使用: 2,
  多人复用: 3,
  企业认证: 4,
  企业标准: 5,
  核心资产: 6,
};

/** 聚合阶段使用的最小输入面：只读取 domain / name / maturity / valueSummary。 */
type AggregationInput = EnterpriseAssetListItem | EnterpriseCapabilityAsset;

/**
 * 在领域内对能力进行排序：成熟度 DESC，并列时按 monthlyExecutions DESC。
 * 不修改入参，返回新数组。
 */
function sortByMaturityThenExecutionsDesc(
  items: ReadonlyArray<AggregationInput>,
): AggregationInput[] {
  return [...items].toSorted((a, b) => {
    const maturityDelta = MATURITY_ORDER[b.maturity] - MATURITY_ORDER[a.maturity];
    if (maturityDelta !== 0) {
      return maturityDelta;
    }
    return b.valueSummary.monthlyExecutions - a.valueSummary.monthlyExecutions;
  });
}

/**
 * 将能力列表按领域聚合为 `DomainDistribution[]`。
 *
 * 行为细节：
 * 1. 始终返回 6 个领域的条目（销售 / HR / 客服 / 财务 / 法务 / 数据分析），
 *    空领域以 `capabilityCount: 0`、`representativeCapabilities: []`、`coverageRate: 0` 占位
 * 2. 每个领域的 `representativeCapabilities` 至多 3 项，按"成熟度 DESC → monthlyExecutions DESC"选取
 * 3. `coverageRate = round(capabilityCount / totalItems × 100)`；`totalItems === 0` 时为 0
 * 4. 输出按 `capabilityCount` DESC 排序，并列时按 `CAPABILITY_DOMAINS` 中的规范顺序
 */
export function aggregateByDomain(items: ReadonlyArray<AggregationInput>): DomainDistribution[] {
  const totalItems = items.length;

  // 1) 按领域分桶——预先为所有 6 个领域建立空桶，确保即使输入为空也输出全部 6 个领域。
  const buckets = new Map<CapabilityDomain, AggregationInput[]>();
  for (const domain of CAPABILITY_DOMAINS) {
    buckets.set(domain, []);
  }
  for (const item of items) {
    const bucket = buckets.get(item.domain);
    if (bucket) {
      bucket.push(item);
    }
    // 注：联合类型已限定 domain ∈ CAPABILITY_DOMAINS；越界值在类型层就会被拒绝，
    // 运行时即便出现也仅是被静默跳过，不会破坏其它领域的统计。
  }

  // 2) 为每个领域构造 DomainDistribution（领域顺序为 CAPABILITY_DOMAINS 的规范顺序）。
  const distributions: DomainDistribution[] = CAPABILITY_DOMAINS.map((domain) => {
    const domainItems = buckets.get(domain) ?? [];
    const ranked = sortByMaturityThenExecutionsDesc(domainItems);
    const representativeCapabilities = ranked.slice(0, 3).map((item) => item.name);
    const capabilityCount = domainItems.length;
    const coverageRate = totalItems > 0 ? Math.round((capabilityCount / totalItems) * 100) : 0;

    return {
      domain,
      capabilityCount,
      representativeCapabilities,
      coverageRate,
    };
  });

  // 3) 按 capabilityCount DESC 排序；并列时按规范领域顺序兜底。
  // 注：构造时已是规范顺序，但显式比较索引可避免对 Array.sort 稳定性的隐式依赖。
  return distributions.toSorted((a, b) => {
    if (a.capabilityCount !== b.capabilityCount) {
      return b.capabilityCount - a.capabilityCount;
    }
    return CAPABILITY_DOMAINS.indexOf(a.domain) - CAPABILITY_DOMAINS.indexOf(b.domain);
  });
}

/**
 * 返回 6 个空领域分布——所有计数与覆盖率为 0、代表能力为空数组，
 * 顺序为 `CAPABILITY_DOMAINS` 的规范顺序。
 *
 * 用作初始/降级状态的基线（如能力列表加载前、加载失败、或确保所有领域始终被渲染）。
 */
export function emptyDomainDistributions(): DomainDistribution[] {
  return CAPABILITY_DOMAINS.map((domain) => ({
    domain,
    capabilityCount: 0,
    representativeCapabilities: [],
    coverageRate: 0,
  }));
}
