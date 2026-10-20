/**
 * 为平台套餐预览企业侧角色分配档案（只读，不依赖真实订阅）。
 */

import { loadConfig } from "../../config/config.js";
import { getPlanEntitlementSnapshot } from "../package-entitlement/plan-version-entitlement-store.js";
import { listResourceModelCatalog } from "../resource-catalog/models-catalog-store.js";
import { resolveModelEntitlementRoutingMode } from "./entitlement-config.js";
import { getPlanVersionModelBinding } from "./plan-version-model-binding-store.js";
import { listRoleGrantProfiles } from "./role-grant-profiles.js";
import type { RoleGrantProfile } from "./role-grant-profiles.js";
import { resolveBindingAllowlist } from "./tier-routing.js";

export type PlanAllocationPreview = {
  planVersionId: string;
  allowedTiers: string[];
  entitledModelIds: string[];
  entitledModelCount: number;
  roleProfiles: RoleGrantProfile[];
  strategy: "ceiling_plan_role_grant";
  guide: {
    summary: string;
    steps: string[];
  };
};

export async function previewPlanAllocation(
  planVersionId: string,
): Promise<PlanAllocationPreview | null> {
  const versionId = planVersionId.trim();
  if (!versionId) {
    return null;
  }
  const binding = await getPlanVersionModelBinding(versionId);
  const snapshot = await getPlanEntitlementSnapshot(versionId);
  const cfg = loadConfig();
  const routingMode = resolveModelEntitlementRoutingMode(cfg);
  const catalog = await listResourceModelCatalog();
  const allowedTiers = snapshot?.allowedTiers ?? binding?.allowedTiers ?? [];
  const resolved = resolveBindingAllowlist({
    routingMode,
    allowedTiers,
    allowedModelIds: binding?.allowedModelIds ?? [],
    catalog,
  });

  const roleProfiles = listRoleGrantProfiles({
    enterpriseAllowedModelIds: resolved.modelIds,
    enterpriseAllowedTiers: allowedTiers,
    catalog,
  });

  return {
    planVersionId: versionId,
    allowedTiers: [...allowedTiers],
    entitledModelIds: resolved.modelIds,
    entitledModelCount: resolved.modelIds.length,
    roleProfiles,
    strategy: "ceiling_plan_role_grant",
    guide: {
      summary:
        "企业订阅本套餐后获得模型天花板；管理员按 viewer/creator/admin 分配席位，系统自动应用对应 Tier 模型档案。",
      steps: [
        "平台激活套餐并绑定 Tier/模型",
        "企业订阅本套餐（天花板）",
        "企业在「Seat 与权限」按岗位分配角色",
        "模型授权自动生效，可在访问控制中微调",
      ],
    },
  };
}
