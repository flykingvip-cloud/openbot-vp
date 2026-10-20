import {
  findProposalBySkillKey,
  findRegistryEntryBySkillKey,
  submitProposal,
} from "./capability-governance-store.js";
import { isRecord } from "./records.js";
import {
  getSkillRuntimeDefinitionForBinding,
  publishSkillReview,
  SkillAssetStoreError,
  submitPersonalSkillToEnterprise,
  submitSkillForReview,
  type EmployeeSkillDetail,
} from "./skill-lifecycle-store.js";

export type EnterpriseSubmitShareVisibility = "审核中" | "已进入企业资产库";

export type SkillEnterpriseSubmitResult = {
  detail: EmployeeSkillDetail;
  capabilityId: string;
  shareVisibility: EnterpriseSubmitShareVisibility;
};

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => stringValue(entry)).filter(Boolean);
}

function mcpBindingFromDetail(detail: EmployeeSkillDetail) {
  const pinned = detail.versions.at(-1)?.runtimeDefinition?.mcpBinding;
  if (pinned?.serverName) {
    return pinned;
  }
  try {
    return getSkillRuntimeDefinitionForBinding(detail.id).runtimeDefinition.mcpBinding;
  } catch {
    return undefined;
  }
}

function toEmployeeCapabilityManifest(detail: EmployeeSkillDetail, packageDraft: unknown) {
  const version = detail.versions.at(-1)?.version ?? "1.0.0";
  const record = isRecord(packageDraft) ? packageDraft : {};
  const hasDraft = Object.keys(record).length > 0;
  const mcpBinding = mcpBindingFromDetail(detail);
  return {
    id: `urn:openclaw:skill:${detail.id}@${version}`,
    kind: "skill" as const,
    version,
    skillKey: detail.id,
    name: stringValue(record.packageTitle, detail.profile.name),
    description: stringValue(record.packageSummary, detail.profile.summary),
    assetType: detail.profile.assetType,
    ...(mcpBinding?.serverName ? { mcpServerName: mcpBinding.serverName } : {}),
    source: {
      kind: "personal",
      origin: `employee-capability:${detail.id}`,
      trustTier: "user",
    },
    risk: {
      level: "low" as const,
      network: false,
      filesystem: false,
      subprocess: false,
      secrets: false,
    },
    categoryId: detail.profile.category || "other",
    ...(hasDraft
      ? {
          enterpriseAssetPackage: {
            packageTitle: stringValue(record.packageTitle, detail.profile.name),
            packageSummary: stringValue(record.packageSummary, detail.profile.summary),
            assetPackageType:
              record.assetPackageType === "template_pack" ||
              record.assetPackageType === "workflow_pack" ||
              record.assetPackageType === "knowledge_pack" ||
              record.assetPackageType === "automation_pack" ||
              record.assetPackageType === "composite_pack"
                ? record.assetPackageType
                : "single_capability",
            businessScenario:
              stringValue(record.businessScenario) ||
              detail.profile.usageExamples[0] ||
              detail.sourceRobot?.name ||
              detail.profile.summary,
            inputArtifacts: stringArray(record.inputArtifacts),
            outputArtifacts: stringArray(record.outputArtifacts),
            dependencies: stringArray(record.dependencies),
            executionMode:
              record.executionMode === "semi_automatic" || record.executionMode === "automatic"
                ? record.executionMode
                : "assistive",
            riskTags: stringArray(record.riskTags),
            targetTeams: stringArray(record.targetTeams),
            verifiedInProduction:
              typeof record.verifiedInProduction === "boolean"
                ? record.verifiedInProduction
                : detail.usageCount > 0,
            promotionIntent:
              record.promotionIntent === "pilot" ||
              record.promotionIntent === "enterprise_standard" ||
              record.promotionIntent === "platform_candidate"
                ? record.promotionIntent
                : "internal_reuse",
            needsEnterpriseSecrets:
              typeof record.needsEnterpriseSecrets === "boolean"
                ? record.needsEnterpriseSecrets
                : false,
            notes: stringValue(record.notes),
          },
        }
      : {}),
  };
}

/**
 * After a proposal is approved into the registry, also publish the personal
 * skill so 全部技能 / 我的资产 stay on the same lifecycle as the registry.
 * Missing personal rows (platform discovery imports) are ignored.
 */
export function rematerializeApprovedEnterpriseSkill(
  skillKey: string | undefined,
  scope: unknown = { kind: "enterprise" },
): void {
  const skillId = skillKey?.trim();
  if (!skillId) {
    return;
  }
  try {
    publishSkillReview({ skillId, scope });
  } catch (error) {
    if (!(error instanceof SkillAssetStoreError)) {
      throw error;
    }
  }
}

/**
 * Single write path for "submit personal skill to enterprise review".
 * All public RPCs must call this — lifecycle + G5 review record + governance proposal.
 * Do not add new submitProposal / submitPersonalSkillToEnterprise callers from RPC handlers.
 */
export function submitSkillToEnterpriseReview(params: {
  skillId: string;
  submittedBy: string;
  enterpriseId?: string | null;
  packageDraft?: unknown;
  scope?: unknown;
}): SkillEnterpriseSubmitResult {
  const detail = submitPersonalSkillToEnterprise(params.skillId);
  submitSkillForReview({
    skillId: params.skillId,
    scope: params.scope ?? { kind: "enterprise" },
  });
  const manifest = toEmployeeCapabilityManifest(detail, params.packageDraft);
  if (findRegistryEntryBySkillKey(manifest.skillKey)) {
    return {
      detail,
      capabilityId: params.skillId,
      shareVisibility: "已进入企业资产库",
    };
  }
  const existingProposal = findProposalBySkillKey(manifest.skillKey);
  const submittedBy = params.submittedBy.trim() || "employee-capability";
  const enterpriseId = params.enterpriseId?.trim() || null;
  if (!existingProposal) {
    submitProposal({
      proposalId: `proposal:${manifest.id}`,
      submittedAt: new Date().toISOString(),
      submittedBy,
      ...(enterpriseId ? { enterpriseId } : {}),
      status: "proposed",
      manifest,
      findings: [],
    });
  } else if (existingProposal.status === "rejected" || existingProposal.status === "withdrawn") {
    submitProposal({
      proposalId: `${existingProposal.proposalId}:revision:${Date.now()}`,
      submittedAt: new Date().toISOString(),
      submittedBy,
      ...(enterpriseId ? { enterpriseId } : {}),
      status: "proposed",
      manifest,
      findings: [],
    });
  }
  return {
    detail,
    capabilityId: params.skillId,
    shareVisibility: "审核中",
  };
}
