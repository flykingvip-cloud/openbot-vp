/**
 * 席位角色 → 模型授权档案（天花板套餐 + 角色价差 + 模型 grant 落地）。
 *
 * 企业订阅决定 Tier 天花板；席位角色决定默认授权的 Tier 子集：
 * - viewer：Tier A（基础）
 * - creator：Tier A + B（平衡）
 * - admin：企业天花板内全部 Tier
 */

import type { SeatRole } from "../billing/types.js";
import { resolveModelsFromTiers } from "../resource-catalog/resolve.js";
import type { ResourceModelCatalogEntry, ResourceTierId } from "../resource-catalog/types.js";
import type { ModelRef } from "./types.js";

/** 角色默认 Tier 预设（在企业天花板内取交集）。 */
export const ROLE_TIER_PRESETS: Record<SeatRole, readonly ResourceTierId[]> = {
  viewer: ["tier_a"],
  creator: ["tier_a", "tier_b"],
  admin: ["tier_a", "tier_b", "tier_c"],
};

export type RoleGrantProfile = {
  role: SeatRole;
  label: string;
  description: string;
  tierIds: ResourceTierId[];
  modelIds: ModelRef[];
  modelCount: number;
};

const ROLE_LABELS: Record<SeatRole, { label: string; description: string }> = {
  viewer: {
    label: "只读席位",
    description: "基础模型层（Tier A），适合日常查询与轻量任务",
  },
  creator: {
    label: "创作者席位",
    description: "基础 + 平衡层（Tier A/B），适合内容生产与多模型协作",
  },
  admin: {
    label: "管理席位",
    description: "企业天花板内全部可用 Tier，适合管理与高阶编排",
  },
};

function uniqueModels(values: readonly ModelRef[]): ModelRef[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))].toSorted((a, b) =>
    a.localeCompare(b),
  );
}

/** 从企业 entitlement 与目录推断企业 Tier 天花板。 */
export function resolveEnterpriseTierCeiling(input: {
  enterpriseAllowedModelIds: readonly ModelRef[];
  enterpriseAllowedTiers?: readonly ResourceTierId[] | null;
  catalog: readonly ResourceModelCatalogEntry[];
}): ResourceTierId[] {
  const explicit = (input.enterpriseAllowedTiers ?? [])
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (explicit.length > 0) {
    return [...new Set(explicit)].toSorted();
  }
  const entitled = new Set(input.enterpriseAllowedModelIds);
  const inferred = new Set<ResourceTierId>();
  for (const entry of input.catalog) {
    if (entry.enabled && entitled.has(entry.modelId)) {
      inferred.add(entry.tier);
    }
  }
  return [...inferred].toSorted();
}

function intersectTiers(
  preset: readonly ResourceTierId[],
  ceiling: readonly ResourceTierId[],
): ResourceTierId[] {
  const ceilingSet = new Set(ceiling);
  return preset.filter((t) => ceilingSet.has(t));
}

/**
 * 解析某角色在企业天花板内的默认模型授权集合。
 * 模型 = entitlement ∩ catalog(tier ∈ rolePreset ∩ enterpriseCeiling)。
 */
export function resolveRoleGrantProfile(input: {
  role: SeatRole;
  enterpriseAllowedModelIds: readonly ModelRef[];
  enterpriseAllowedTiers?: readonly ResourceTierId[] | null;
  catalog: readonly ResourceModelCatalogEntry[];
}): RoleGrantProfile {
  const entitled = uniqueModels(input.enterpriseAllowedModelIds);
  const ceiling = resolveEnterpriseTierCeiling(input);
  const tierIds = intersectTiers(ROLE_TIER_PRESETS[input.role], ceiling);

  let modelIds: ModelRef[] = [];
  if (tierIds.length > 0 && input.catalog.length > 0) {
    const pool = resolveModelsFromTiers({ allowedTierIds: tierIds, catalog: input.catalog });
    const entitledSet = new Set(entitled);
    modelIds = pool.modelIds.filter((id) => entitledSet.has(id));
  } else if (entitled.length > 0) {
    // 无 Tier 目录时回退：admin 全量，creator 约 2/3，viewer 约 1/3（按字典序切片）。
    const sliceRatio = input.role === "admin" ? 1 : input.role === "creator" ? 0.67 : 0.34;
    const count = Math.max(1, Math.ceil(entitled.length * sliceRatio));
    modelIds = entitled.slice(0, count);
  }

  const meta = ROLE_LABELS[input.role];
  return {
    role: input.role,
    label: meta.label,
    description: meta.description,
    tierIds,
    modelIds,
    modelCount: modelIds.length,
  };
}

/** 列出三档角色的授权档案（用于企业分配总览 UI）。 */
export function listRoleGrantProfiles(input: {
  enterpriseAllowedModelIds: readonly ModelRef[];
  enterpriseAllowedTiers?: readonly ResourceTierId[] | null;
  catalog: readonly ResourceModelCatalogEntry[];
}): RoleGrantProfile[] {
  const roles: SeatRole[] = ["viewer", "creator", "admin"];
  return roles.map((role) => resolveRoleGrantProfile({ ...input, role }));
}
