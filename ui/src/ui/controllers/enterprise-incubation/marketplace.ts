import { TERMINOLOGY_BLACKLIST_PATTERN } from "../../capability/employee-capability/terminology-filter.ts";
import type { SkillRecommendation } from "../skill-recommendations.ts";

export type MarketplaceCapability = {
  skillId: string;
  name: string;
  description: string;
  scenarioTags: string[]; // 最多 3 个
  certified: boolean;
  installed: boolean;
};

/** 员工市场推荐来源（与后端 employee-capability.recommendations 的 source 对齐）。 */
export type RecommendationSource = "platform_direct" | "position_market" | "personal_shared";

/** 中文来源标签（R15.2/15.3：在员工侧展示来源）。 */
export type RecommendationSourceLabel = "平台直达" | "企业推送" | "共享推荐";

const SOURCE_LABELS: Record<RecommendationSource, RecommendationSourceLabel> = {
  platform_direct: "平台直达",
  position_market: "企业推送",
  personal_shared: "共享推荐",
};

/** 把后端 source 映射为中文来源标签；未知来源回退到「共享推荐」。 */
export function recommendationSourceLabel(source: string): RecommendationSourceLabel {
  return SOURCE_LABELS[source as RecommendationSource] ?? "共享推荐";
}

/** 员工市场聚合推荐项：在基础能力卡片上附加来源标签（R15.2/15.3）。 */
export type EmployeeMarketplaceRecommendation = MarketplaceCapability & {
  source: RecommendationSource;
  sourceLabel: RecommendationSourceLabel;
};

/** 后端 employee-capability.recommendations 单条聚合推荐的最小投影输入。 */
export type AggregatedRecommendationInput = {
  capability: {
    id: string;
    name: string;
    description?: string;
    summary?: string;
    scenarioTags?: string[];
    tags?: string[];
    certified?: boolean;
  };
  reason?: string;
  source?: string;
};

export type MarketplaceState = {
  loading: boolean;
  error: string | null;
  capabilities: MarketplaceCapability[];
  tagFilter: string | null;
  searchQuery: string;
  installingSkillId: string | null;
  installSuccess: string | null;
};

/**
 * 投影：从推荐列表响应中剥离运行时字段，映射为市场能力对象。
 * - source="shared" 映射为 certified=true
 * - tags 截取前 3 个作为 scenarioTags
 */
export function projectToMarketplace(raw: SkillRecommendation[]): MarketplaceCapability[] {
  return raw.map((rec) => ({
    skillId: rec.skillId,
    name: rec.name,
    description: rec.summary,
    scenarioTags: rec.tags.slice(0, 3),
    certified: rec.source === "shared",
    installed: false,
  }));
}

/**
 * 投影：把后端 `employee-capability.recommendations` 的聚合推荐（含 `source`）映射为
 * 带中文来源标签的员工市场项（R15.2/15.3）。
 * - 剥离运行时字段，仅保留 skillId/name/description/scenarioTags/certified/installed + source/sourceLabel
 * - scenarioTags 截取前 3 个
 * - 未知来源回退到「共享推荐」
 */
export function projectEmployeeRecommendations(
  raw: AggregatedRecommendationInput[],
): EmployeeMarketplaceRecommendation[] {
  return raw.map((rec) => {
    const source: RecommendationSource = (
      ["platform_direct", "position_market", "personal_shared"] as const
    ).includes(rec.source as RecommendationSource)
      ? (rec.source as RecommendationSource)
      : "personal_shared";
    const tags = rec.capability.scenarioTags ?? rec.capability.tags ?? [];
    return {
      skillId: rec.capability.id,
      name: rec.capability.name,
      description: rec.capability.description ?? rec.capability.summary ?? "",
      scenarioTags: tags.slice(0, 3),
      certified: rec.capability.certified ?? source === "platform_direct",
      installed: false,
      source,
      sourceLabel: recommendationSourceLabel(source),
    };
  });
}

/**
 * 验证文本不包含黑名单术语。
 * 返回 true 表示文本"干净"（不含黑名单术语）。
 */
export function isTerminologyClean(text: string): boolean {
  return !TERMINOLOGY_BLACKLIST_PATTERN.test(text);
}

/**
 * 按使用场景标签筛选。
 * tag 为 null 时返回全部。
 */
export function filterByTag(
  capabilities: MarketplaceCapability[],
  tag: string | null,
): MarketplaceCapability[] {
  if (!tag) {
    return capabilities;
  }
  return capabilities.filter((c) => c.scenarioTags.includes(tag));
}

/**
 * 按名称关键词搜索（不区分大小写，最少 1 个字符）。
 * query 为空或仅空白时返回全部。
 */
export function searchByName(
  capabilities: MarketplaceCapability[],
  query: string,
): MarketplaceCapability[] {
  const trimmed = query.trim();
  if (trimmed.length < 1) {
    return capabilities;
  }
  const lower = trimmed.toLowerCase();
  return capabilities.filter((c) => c.name.toLowerCase().includes(lower));
}

/**
 * 标记已安装能力。
 * 当 skillId 存在于 installedSkillIds 集合中时，installed 设为 true。
 */
export function markInstalled(
  capabilities: MarketplaceCapability[],
  installedSkillIds: Set<string>,
): MarketplaceCapability[] {
  return capabilities.map((c) => ({
    ...c,
    installed: installedSkillIds.has(c.skillId),
  }));
}
