import { loadConfig } from "../../config/config.js";
import {
  listAgents,
  listBindings,
  listTelemetry,
  type RuntimeCapabilityBinding,
  type RuntimeTelemetry,
} from "../agent-runtime-store.js";
import { evaluateAssetContentReadiness } from "../asset-admission.js";
import { inferOrganizableAssetClassification } from "../asset-classification.js";
import { recordAdoptionSignal } from "../asset-incubation-adoption-store.js";
import {
  findRegistryEntryBySkillKey,
  findProposalBySkillKey,
  getRegistryEntry,
  listRegistry,
  type GovernanceRegistryEntry,
  type GovernanceProposal,
} from "../capability-governance-store.js";
import { applySharedSkillToGroupParticipation } from "../collaboration-learning/participation-sync.js";
import { loadEnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import { syncExecutableAssetBinding } from "../executable-asset-binding/sync.js";
import {
  formatAssetShareNotification,
  sendGroupNotification,
} from "../group-notification-service.js";
import {
  listMyAccumulationSkillAssets,
  requireOwnedPersonalSkill,
  requirePersonalAssetOwner,
  resolvePersonalAssetOwnerIdentities,
  resolvePersonalAssetOwnerUserId,
} from "../personal-skill-asset-scope.js";
import { loadPlatformAuthStore, resolvePlatformAuthConfig } from "../platform-auth.js";
import { resolveAuthoritativeEnterpriseScopeForClient } from "../platform-auth/active-membership-scope.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { syncInstallToRuntime } from "../runtime-binding-sync.js";
import { triggerAssetCuration } from "../skill-asset-curation-trigger.js";
import {
  assessSkillAvailability,
  matchCapabilityIntent,
  packSkillIsNative,
  packSkillRequiresSecret,
  resolveVerbsForSkill,
  type CapabilityMatchCandidate,
} from "../skill-capability-contract.js";
import { submitSkillToEnterpriseReview } from "../skill-enterprise-submission.js";
import {
  isExecutableSkillProjectionEligible,
  syncSkillExecutionBinding,
} from "../skill-execution-binding/index.js";
import {
  deletePersonalSkillAsset,
  editPersonalSkillAsset,
  getPersonalSkillAssetDetail,
  getSkillRuntimeDefinitionForBinding,
  getSkillShareAttributions,
  includeInEnterprisePublicCatalog,
  installSkillToRobotAsset,
  listPersonalSkillAssets,
  listRobotSkillAssets,
  removeRobotSkillAsset,
  saveSkillAsset,
  sharePersonalSkillToGroup,
  SkillAssetStoreError,
  toggleRobotSkillAsset,
  type EmployeeSkillDetail,
  type EmployeeSkillSummary,
  type SkillLifecycleState,
  type SkillShareAttribution,
  type SkillVisibility,
} from "../skill-lifecycle-store.js";
import { resolveControlPlaneStorePathForClient } from "../tenant-context.js";
import { TENANT_SEAT_ASSETS_FILE } from "../tenant-store-paths.js";
import {
  resolvePackSkillInstallBlock,
  respondIfPackSkillReviewBlocked,
} from "./pack-skill-review-install.js";
import { isRecord, nonemptyStrings, optionalString, requiredString } from "./request-params.js";
import type { GatewayClient, GatewayRequestHandlers, RespondFn } from "./types.js";

type EmployeeHealthLabel = "运行稳定" | "偶尔异常" | "需要重新整理";
type EmployeeShareVisibility =
  | "私有"
  | "已共享到协作小组"
  | "审核中"
  | "需要修改后再次提交"
  | "已进入企业资产库"
  | "即将下线"
  | "已下线";

type CapabilitySummary = {
  id: string;
  name: string;
  summary: string;
  assetType?:
    | "prompt"
    | "template"
    | "workflow"
    | "knowledge"
    | "agent"
    | "capability"
    | "tool"
    | "mcp";
  usageExamples: string[];
  inputDescription: string;
  outputDescription: string;
  tags: string[];
  category: string;
  avatar: string | null;
  health: EmployeeHealthLabel;
  shareVisibility: EmployeeShareVisibility;
  maturity: null;
  attribution: {
    sourceRobot: { id: string; name: string };
    sourceTaskSummary: string;
    firstFormedScenario: string;
    highFrequencyScenarios: string[];
  };
  usage: {
    robots: Array<{ id: string; name: string }>;
    totalUsageCount: number;
    lastUsedAt: number | null;
  };
  usageMetrics: {
    robotCount: number;
    groupCount: number;
    totalUsageCount: number;
    lastUsedAt: number | null;
  };
  recentUpdate: { id: string; at: number; headline: string } | null;
  versionInfo: {
    currentVersion: string;
    versionCount: number;
    submittedVersion: string | null;
  };
  isDraft: boolean;
  createdAt: number;
  updatedAt: number;
  applicationSummary?: string;
  feedbackSummary?: string;
  enterpriseReview?: {
    proposalId?: string;
    registryManifestId?: string;
    statusLabel: string;
    nextStep: string;
    submittedAt?: number | null;
    reviewedAt?: number | null;
    reviewerId?: string | null;
    reviewerNote?: string | null;
  } | null;
  enterpriseLifecycle?: {
    stage:
      | "draft"
      | "shared"
      | "under_review"
      | "needs_revision"
      | "registered"
      | "sunsetting"
      | "offline";
    stageLabel: string;
    nextStep: string | null;
    proposalId?: string;
    registryManifestId?: string;
    submittedAt?: number | null;
    reviewedAt?: number | null;
    reviewerId?: string | null;
    reviewerNote?: string | null;
  } | null;
  sourceContextLabel?: string;
  optimizationTargets?: Array<{
    kind: "robot" | "group";
    id: string;
    name: string;
  }>;
  incubationReadiness?: {
    ready: boolean;
    admissible: boolean;
    gaps: Array<{ field: string; label: string; severity: "block" | "recommend" }>;
    reasons: string[];
  };
  shareHistory?: Array<{
    shareId: string;
    groupId: string;
    groupName: string;
    sharedByDisplayName: string;
    sharedAt: number;
  }>;
};

type EmployeeSeatScope = {
  tenantId: string;
  seatId: string;
  seatTitle: string;
};

type RecommendationSource = "platform_direct" | "position_market" | "personal_shared";

type RecommendationEntry = {
  capability: CapabilitySummary;
  reason: string;
  priority: number;
  source: RecommendationSource;
};

type EmployeeRuntimeProjectionContext = {
  bindingsByCapabilityId: Map<string, RuntimeCapabilityBinding[]>;
  telemetryByBindingKey: Map<string, RuntimeTelemetry[]>;
};

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function submittedByFromClient(client: GatewayClient | null): string | null {
  const user = stringValue(client?.user);
  if (user) {
    return user;
  }
  return stringValue(client?.connect?.client?.displayName) || null;
}

function adoptionOwnerKeyFromClient(client: GatewayClient | null | undefined): string {
  return submittedByFromClient(client ?? null)?.toLowerCase() || "local";
}

function userEmailFromClient(client: GatewayClient | null): string | null {
  const direct = stringValue(client?.user);
  if (direct) {
    return direct;
  }
  const connect = client?.connect;
  if (connect && typeof connect === "object" && "user" in connect) {
    return stringValue((connect as Record<string, unknown>).user);
  }
  return null;
}

function mapHealth(status: string): EmployeeHealthLabel {
  if (status === "warning") {
    return "偶尔异常";
  }
  if (status === "broken") {
    return "需要重新整理";
  }
  return "运行稳定";
}

function mapShareVisibility(
  visibility: SkillVisibility,
  lifecycle: SkillLifecycleState,
  proposal?: GovernanceProposal | null,
  hasEnterpriseRegistry = false,
): EmployeeShareVisibility {
  if (lifecycle === "deprecated") {
    return "即将下线";
  }
  if (lifecycle === "retired") {
    return "已下线";
  }
  if (
    !includeInEnterprisePublicCatalog({ lifecycle, visibility }) &&
    (lifecycle === "draft" || visibility === "private")
  ) {
    return "私有";
  }
  if (hasEnterpriseRegistry) {
    return "已进入企业资产库";
  }
  if (proposal?.status === "rejected" || proposal?.status === "withdrawn") {
    return "需要修改后再次提交";
  }
  if (proposal?.status === "approved") {
    return "已进入企业资产库";
  }
  if (proposal?.status === "proposed" || proposal?.status === "under_review") {
    return "审核中";
  }
  if (lifecycle === "reviewing" || lifecycle === "approved") {
    return "审核中";
  }
  if (visibility === "enterprise" && lifecycle === "published") {
    return "已进入企业资产库";
  }
  if (visibility === "group") {
    return "已共享到协作小组";
  }
  return "私有";
}

function updateTimes(detail: EmployeeSkillDetail): { createdAt: number; updatedAt: number } {
  const times = detail.versions.map((entry) => entry.createdAt).filter(Number.isFinite);
  return {
    createdAt: times[0] ?? 0,
    updatedAt: times.at(-1) ?? detail.lastUsedAt ?? 0,
  };
}

function updateRecaps(
  detail: EmployeeSkillDetail,
): Array<{ id: string; at: number; headline: string }> {
  return detail.versions
    .toReversed()
    .map((entry, index) => ({
      id: `${detail.id}-recap-${detail.versions.length - index}`,
      at: entry.createdAt,
      headline:
        entry.summary && entry.summary !== "Initial save"
          ? entry.summary
          : "最近更新 · 完成了能力整理",
    }))
    .filter((entry) => entry.headline.trim().length > 0);
}

function inferAssetType(
  detail: EmployeeSkillDetail | EmployeeSkillSummary,
): CapabilitySummary["assetType"] {
  const profile = detail.profile;
  // Trust an explicitly stored asset type. The store persists profile.assetType
  // (normalizeAssetType) at save time, so an uploaded knowledge document keeps
  // its "knowledge" type instead of being silently relabeled "能力". Only records
  // that collapsed to the default bucket ("capability") — legacy / unclassified
  // saves — fall through to keyword inference below.
  if (profile.assetType && profile.assetType !== "capability") {
    return profile.assetType;
  }
  return inferOrganizableAssetClassification({
    name: profile.name,
    summary: profile.summary,
    category: profile.category,
    tags: profile.tags,
  }).assetType;
}

function buildSourceContextLabel(detail: EmployeeSkillDetail | EmployeeSkillSummary): string {
  const sourceRobot = detail.sourceRobot?.name?.trim();
  const scenario = detail.profile.usageExamples[0]?.trim();
  if (scenario) {
    return `来自${scenario}`;
  }
  if (sourceRobot) {
    return `来自${sourceRobot}最近一次交付`;
  }
  return "来自最近一次工作整理";
}

function buildApplicationSummary(usageMetrics: CapabilitySummary["usageMetrics"]): string {
  const { robotCount, groupCount } = usageMetrics;
  if (groupCount > 0) {
    return `已在 ${groupCount} 个协作小组中复用`;
  }
  if (robotCount > 0) {
    return `已在 ${robotCount} 个机器人中应用`;
  }
  return "尚未被应用";
}

function buildFeedbackSummary(
  detail: EmployeeSkillDetail | EmployeeSkillSummary,
  visibility: EmployeeShareVisibility,
): string {
  const proposal = findProposalBySkillKey(detail.id);
  const reviewNote = proposal?.reviewer?.note?.trim();
  if (visibility === "审核中") {
    return "企业正在审核";
  }
  if (visibility === "需要修改后再次提交") {
    if (reviewNote) {
      return `企业建议：${reviewNote}`;
    }
    return "企业建议补充说明";
  }
  if (visibility === "已进入企业资产库") {
    return detail.health.status === "healthy" ? "近期应用稳定" : "建议继续优化";
  }
  if (detail.lifecycle === "draft") {
    return "待继续整理";
  }
  return detail.health.status === "healthy" ? "应用稳定" : "近期反馈一般，建议优化";
}

function buildEnterpriseReviewTracking(params: {
  detail: EmployeeSkillDetail | EmployeeSkillSummary;
  visibility: EmployeeShareVisibility;
  proposal: GovernanceProposal | null;
  registry: GovernanceRegistryEntry | null;
}): CapabilitySummary["enterpriseReview"] {
  const { visibility, proposal, registry } = params;
  if (!proposal && !registry) {
    return null;
  }
  if (registry) {
    return {
      proposalId: proposal?.proposalId,
      registryManifestId: registry.manifest.id,
      statusLabel: "已进入企业资产库",
      nextStep: "等待企业继续分发、安装或孵化。",
      submittedAt: proposal ? Date.parse(proposal.submittedAt) || null : null,
      reviewedAt: proposal?.reviewer ? Date.parse(proposal.reviewer.at) || null : null,
      reviewerId: proposal?.reviewer?.id ?? null,
      reviewerNote: proposal?.reviewer?.note ?? null,
    };
  }
  if (!proposal) {
    return null;
  }
  if (visibility === "审核中") {
    return {
      proposalId: proposal.proposalId,
      statusLabel: "审核中",
      nextStep:
        proposal.status === "under_review"
          ? "企业管理员正在查看详情与风险项。"
          : "等待企业管理员开始审核。",
      submittedAt: Date.parse(proposal.submittedAt) || null,
      reviewedAt: proposal.reviewer ? Date.parse(proposal.reviewer.at) || null : null,
      reviewerId: proposal.reviewer?.id ?? null,
      reviewerNote: proposal.reviewer?.note ?? null,
    };
  }
  if (visibility === "需要修改后再次提交") {
    return {
      proposalId: proposal.proposalId,
      statusLabel: "已退回修改",
      nextStep: "根据企业反馈补充资产内容后重新提交。",
      submittedAt: Date.parse(proposal.submittedAt) || null,
      reviewedAt: proposal.reviewer ? Date.parse(proposal.reviewer.at) || null : null,
      reviewerId: proposal.reviewer?.id ?? null,
      reviewerNote: proposal.reviewer?.note ?? null,
    };
  }
  return {
    proposalId: proposal.proposalId,
    statusLabel: visibility,
    nextStep: "等待企业侧继续处理。",
    submittedAt: Date.parse(proposal.submittedAt) || null,
    reviewedAt: proposal.reviewer ? Date.parse(proposal.reviewer.at) || null : null,
    reviewerId: proposal.reviewer?.id ?? null,
    reviewerNote: proposal.reviewer?.note ?? null,
  };
}

function buildVersionInfo(
  detail: EmployeeSkillDetail | EmployeeSkillSummary,
  proposal: GovernanceProposal | null,
  registry: GovernanceRegistryEntry | null,
): CapabilitySummary["versionInfo"] {
  return {
    currentVersion: detail.version,
    versionCount: detail.versionCount,
    submittedVersion: registry?.manifest.version ?? proposal?.manifest.version ?? null,
  };
}

function buildUsageMetrics(
  detail: EmployeeSkillDetail | EmployeeSkillSummary,
  graph: EmployeeSkillDetail["dependencyGraph"] | null,
  registry: GovernanceRegistryEntry | null,
  runtimeCtx: EmployeeRuntimeProjectionContext | null,
): CapabilitySummary["usageMetrics"] {
  const runtimeBindings = runtimeBindingsForCapability(detail, registry, runtimeCtx);
  const runtimeRobotCount = new Set(runtimeBindings.map((binding) => binding.runtimeAgentId)).size;
  const runtimeUsageCount = runtimeBindings.reduce((sum, binding) => {
    const latest = runtimeCtx ? latestRuntimeTelemetry(runtimeCtx, binding) : null;
    return (
      sum + Math.max(0, Math.round((latest?.calls7d ?? binding.invocationMetrics.calls7d) * 4))
    );
  }, 0);
  const runtimeLastUsedAt =
    runtimeBindings.length > 0
      ? Math.max(
          ...runtimeBindings.map((binding) => {
            const latest = runtimeCtx ? latestRuntimeTelemetry(runtimeCtx, binding) : null;
            return latest?.lastSampleAt ?? binding.updatedAt ?? 0;
          }),
        )
      : 0;
  return {
    robotCount: Math.max(
      graph?.installedRobots.length ?? (detail.sourceRobot ? 1 : 0),
      runtimeRobotCount,
    ),
    groupCount: graph?.sharedGroups.length ?? 0,
    totalUsageCount: Math.max(detail.usageCount, runtimeUsageCount),
    lastUsedAt: Math.max(detail.lastUsedAt ?? 0, runtimeLastUsedAt) || null,
  };
}

function buildEnterpriseLifecycle(params: {
  visibility: EmployeeShareVisibility;
  proposal: GovernanceProposal | null;
  registry: GovernanceRegistryEntry | null;
}): CapabilitySummary["enterpriseLifecycle"] {
  const { visibility, proposal, registry } = params;
  if (visibility === "已进入企业资产库" && registry) {
    return {
      stage: "registered",
      stageLabel: "已进入企业资产库",
      nextStep: "等待企业继续分发、安装、复用或孵化。",
      proposalId: proposal?.proposalId,
      registryManifestId: registry.manifest.id,
      submittedAt: proposal ? Date.parse(proposal.submittedAt) || null : null,
      reviewedAt: proposal?.reviewer ? Date.parse(proposal.reviewer.at) || null : null,
      reviewerId: proposal?.reviewer?.id ?? null,
      reviewerNote: proposal?.reviewer?.note ?? null,
    };
  }
  if (visibility === "审核中") {
    return {
      stage: "under_review",
      stageLabel: "审核中",
      nextStep:
        proposal?.status === "under_review"
          ? "企业管理员正在查看详情与风险项。"
          : "等待企业管理员开始审核。",
      proposalId: proposal?.proposalId,
      submittedAt: proposal ? Date.parse(proposal.submittedAt) || null : null,
      reviewedAt: proposal?.reviewer ? Date.parse(proposal.reviewer.at) || null : null,
      reviewerId: proposal?.reviewer?.id ?? null,
      reviewerNote: proposal?.reviewer?.note ?? null,
    };
  }
  if (visibility === "需要修改后再次提交") {
    return {
      stage: "needs_revision",
      stageLabel: "需修改后再次提交",
      nextStep: "根据企业反馈补充资产内容后重新提交。",
      proposalId: proposal?.proposalId,
      submittedAt: proposal ? Date.parse(proposal.submittedAt) || null : null,
      reviewedAt: proposal?.reviewer ? Date.parse(proposal.reviewer.at) || null : null,
      reviewerId: proposal?.reviewer?.id ?? null,
      reviewerNote: proposal?.reviewer?.note ?? null,
    };
  }
  if (visibility === "已共享到协作小组") {
    return {
      stage: "shared",
      stageLabel: "已共享到协作小组",
      nextStep: "可继续打磨后提交企业。",
    };
  }
  if (visibility === "即将下线") {
    return {
      stage: "sunsetting",
      stageLabel: "即将下线",
      nextStep: "请安排迁移或替换。",
    };
  }
  if (visibility === "已下线") {
    return {
      stage: "offline",
      stageLabel: "已下线",
      nextStep: "已停止继续复用。",
    };
  }
  return {
    stage: "draft",
    stageLabel: "资产草稿",
    nextStep: "补充信息后可共享或提交企业。",
  };
}

function buildOptimizationTargets(
  detail: EmployeeSkillDetail | EmployeeSkillSummary,
  graph: EmployeeSkillDetail["dependencyGraph"] | null,
): CapabilitySummary["optimizationTargets"] {
  const targets: NonNullable<CapabilitySummary["optimizationTargets"]> = [];
  const robots: Array<{ agentId: string; name: string }> = graph?.installedRobots ?? [];
  if (robots.length === 0 && detail.sourceRobot) {
    robots.push({ agentId: detail.sourceRobot.id, name: detail.sourceRobot.name });
  }
  for (const robot of robots) {
    targets.push({
      kind: "robot",
      id: robot.agentId,
      name: robot.name,
    });
  }
  for (const group of graph?.sharedGroups ?? []) {
    targets.push({
      kind: "group",
      id: group.groupId,
      name: group.name,
    });
  }
  return targets;
}

function buildShareHistory(
  skillId: string,
  sharedGroups: Array<{ groupId: string; name: string }>,
): CapabilitySummary["shareHistory"] {
  const attributions: SkillShareAttribution[] = getSkillShareAttributions(skillId);
  if (attributions.length === 0) {
    return undefined;
  }
  const groupNameById = new Map(sharedGroups.map((group) => [group.groupId, group.name]));
  // 最近分享的排在前面，便于详情页按时间倒序展示"谁在何时分享到哪个组"
  return attributions
    .map((attribution) => ({
      shareId: attribution.shareId,
      groupId: attribution.groupId,
      groupName: groupNameById.get(attribution.groupId) ?? attribution.groupId,
      sharedByDisplayName: attribution.sharedBy.displayName,
      sharedAt: attribution.sharedAt,
    }))
    .toSorted((left, right) => right.sharedAt - left.sharedAt);
}

function toCapabilitySummary(
  detail: EmployeeSkillDetail | EmployeeSkillSummary,
  runtimeCtx: EmployeeRuntimeProjectionContext | null = null,
): CapabilitySummary {
  const fullDetail = "dependencyGraph" in detail ? detail : null;
  const proposal = findProposalBySkillKey(detail.id);
  const registry = findRegistryEntryBySkillKey(detail.id);
  const sourceRobot = detail.sourceRobot ?? { id: "", name: "未知来源" };
  const times = fullDetail
    ? updateTimes(fullDetail)
    : { createdAt: 0, updatedAt: detail.lastUsedAt ?? 0 };
  const recaps = fullDetail ? updateRecaps(fullDetail) : [];
  const shareVisibility = mapShareVisibility(
    detail.profile.visibility,
    detail.lifecycle,
    proposal,
    registry !== null,
  );
  const usageMetrics = buildUsageMetrics(
    detail,
    fullDetail?.dependencyGraph ?? null,
    registry,
    runtimeCtx,
  );
  const usageRobots =
    fullDetail?.dependencyGraph.installedRobots.map((robot) => ({
      id: robot.agentId,
      name: robot.name,
    })) ?? (sourceRobot.id ? [sourceRobot] : []);
  const assetType = fullDetail ? inferAssetType(fullDetail) : inferAssetType(detail);
  const incubationReadiness = evaluateAssetContentReadiness({
    assetType: assetType ?? "capability",
    name: detail.profile.name,
    summary: detail.profile.summary,
    usageExamples: detail.profile.usageExamples,
    inputDescription: detail.profile.inputDescription,
    outputDescription: detail.profile.outputDescription,
    category: detail.profile.category,
    tags: detail.profile.tags,
  });
  return {
    id: detail.id,
    name: detail.profile.name,
    summary: detail.profile.summary,
    assetType,
    usageExamples: detail.profile.usageExamples,
    inputDescription: detail.profile.inputDescription,
    outputDescription: detail.profile.outputDescription,
    tags: detail.profile.tags,
    category: detail.profile.category,
    avatar: detail.profile.avatar || null,
    health: mapHealth(detail.health.status),
    shareVisibility,
    maturity: null,
    attribution: {
      sourceRobot,
      sourceTaskSummary: `从${sourceRobot.name || "日常工作"}中自然形成`,
      firstFormedScenario: "首次在日常任务中形成",
      highFrequencyScenarios: detail.profile.usageExamples,
    },
    usage: {
      robots: usageRobots,
      totalUsageCount: usageMetrics.totalUsageCount,
      lastUsedAt: usageMetrics.lastUsedAt,
    },
    usageMetrics,
    recentUpdate: recaps[0] ?? null,
    versionInfo: buildVersionInfo(detail, proposal, registry),
    isDraft: detail.lifecycle === "draft",
    createdAt: times.createdAt,
    updatedAt: times.updatedAt,
    applicationSummary: buildApplicationSummary(usageMetrics),
    feedbackSummary: buildFeedbackSummary(detail, shareVisibility),
    enterpriseReview: buildEnterpriseReviewTracking({
      detail,
      visibility: shareVisibility,
      proposal,
      registry,
    }),
    enterpriseLifecycle: buildEnterpriseLifecycle({
      visibility: shareVisibility,
      proposal,
      registry,
    }),
    sourceContextLabel: buildSourceContextLabel(detail),
    optimizationTargets: buildOptimizationTargets(detail, fullDetail?.dependencyGraph ?? null),
    incubationReadiness,
    shareHistory: buildShareHistory(detail.id, fullDetail?.dependencyGraph.sharedGroups ?? []),
  };
}

function toListItem(capability: CapabilitySummary) {
  return {
    id: capability.id,
    name: capability.name,
    summary: capability.summary,
    assetType: capability.assetType,
    health: capability.health,
    shareVisibility: capability.shareVisibility,
    isDraft: capability.isDraft,
    recentUpdate: capability.recentUpdate,
    updatedAt: capability.updatedAt,
    sourceRobotName: capability.attribution.sourceRobot.name || null,
    sourceContextLabel: capability.sourceContextLabel,
    usageBrief: {
      robotCount: capability.usageMetrics.robotCount,
      lastUsedAt: capability.usageMetrics.lastUsedAt,
    },
    usageMetrics: capability.usageMetrics,
    versionInfo: capability.versionInfo,
    applicationSummary: capability.applicationSummary,
    feedbackSummary: capability.feedbackSummary,
    enterpriseReview: capability.enterpriseReview,
    enterpriseLifecycle: capability.enterpriseLifecycle,
    optimizationTargets: capability.optimizationTargets,
    incubationReadiness: capability.incubationReadiness,
    incubationReady: capability.incubationReadiness?.ready ?? false,
  };
}

function respondCapabilityError(respond: RespondFn, error: unknown): void {
  if (respondIfPackSkillReviewBlocked(respond, error)) {
    return;
  }
  if (error instanceof SkillAssetStoreError) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, error.message));
    return;
  }
  respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
}

async function loadOwnedPersonalSkill(
  client: GatewayClient | null,
  skillId: string,
): Promise<EmployeeSkillDetail> {
  const ownerIds = await resolvePersonalAssetOwnerIdentities(client);
  return requireOwnedPersonalSkill({ skillId, ownerIds });
}

function parseQuickSaveForm(
  params: Record<string, unknown>,
): { name: string; summary: string } | null {
  const form = isRecord(params.form) ? params.form : params;
  const name = stringValue(form.name);
  const summary = stringValue(form.summary);
  return name && summary ? { name, summary } : null;
}

function registryEntryForCapabilityId(capabilityId: string): GovernanceRegistryEntry | null {
  return getRegistryEntry(capabilityId) ?? findRegistryEntryBySkillKey(capabilityId);
}

function localSkillIdForRegistryEntry(entry: GovernanceRegistryEntry, fallbackId: string): string {
  return entry.manifest.skillKey || fallbackId;
}

/**
 * Single robot mount: skill relation, execution files, and MCP process config.
 * Enterprise-wide install must call this instead of writing a second binding.
 */
export function mountSkillAssetOnRobot(params: { agentId: string; skillId: string }): {
  mounted: boolean;
  reason?: string;
} {
  installSkillToRobotAsset({ agentId: params.agentId, skillId: params.skillId });
  const projection = syncSkillExecutionBinding({
    agentId: params.agentId,
    skillId: params.skillId,
  });
  let executable = false;
  let isMcp = false;
  try {
    const bundle = getSkillRuntimeDefinitionForBinding(params.skillId);
    executable = isExecutableSkillProjectionEligible({
      enabled: true,
      lifecycle: bundle.lifecycle,
      assetType: bundle.profile.assetType,
    });
    isMcp = bundle.profile.assetType === "mcp";
  } catch {
    executable = false;
  }
  if (isMcp && executable) {
    syncExecutableAssetBinding({
      skillId: params.skillId,
      op: "install",
      agentId: params.agentId,
      healthProbeEnabled: false,
    });
  }
  if (executable && projection.action !== "materialised") {
    return { mounted: false, reason: projection.reason ?? "unknown" };
  }
  return { mounted: projection.action === "materialised" };
}

async function resolveEmployeeSeatScope(
  client: GatewayClient | null,
): Promise<EmployeeSeatScope | null> {
  const email = userEmailFromClient(client);
  if (!email) {
    return null;
  }
  try {
    const cfg = loadConfig();
    const authConfig = resolvePlatformAuthConfig(cfg.gateway?.auth?.trustedProxy);
    if (!authConfig?.enabled) {
      return null;
    }
    const platformStore = await loadPlatformAuthStore(authConfig);
    const scope = resolveAuthoritativeEnterpriseScopeForClient({
      store: platformStore,
      client,
      canonicalize: (value) => value?.trim() || null,
    });
    if (scope.kind !== "authoritative") {
      return null;
    }
    const { user, membership } = scope;
    const seatStore = await loadEnterpriseSeatAssetsStore(
      await resolveControlPlaneStorePathForClient(client, TENANT_SEAT_ASSETS_FILE),
    );
    const binding =
      Object.values(seatStore.bindings)
        .filter(
          (entry) =>
            entry.tenantId === membership.enterpriseId &&
            entry.employeeId === user.id &&
            entry.bindingStatus === "active",
        )
        .toSorted((left, right) => right.effectiveAt.localeCompare(left.effectiveAt))[0] ?? null;
    if (!binding) {
      return null;
    }
    const seat = seatStore.seats[binding.seatId];
    if (!seat || seat.tenantId !== membership.enterpriseId) {
      return null;
    }
    return { tenantId: membership.enterpriseId, seatId: seat.seatId, seatTitle: seat.title };
  } catch {
    return null;
  }
}

async function resolveEmployeeEnterpriseId(client: GatewayClient | null): Promise<string | null> {
  const email = userEmailFromClient(client);
  if (!email) {
    return null;
  }
  try {
    const cfg = loadConfig();
    const authConfig = resolvePlatformAuthConfig(cfg.gateway?.auth?.trustedProxy);
    if (!authConfig?.enabled) {
      return null;
    }
    const platformStore = await loadPlatformAuthStore(authConfig);
    const scope = resolveAuthoritativeEnterpriseScopeForClient({
      store: platformStore,
      client,
      canonicalize: (value) => value?.trim() || null,
    });
    return scope.kind === "authoritative" ? scope.enterpriseId : null;
  } catch {
    return null;
  }
}

async function listPositionCapabilityEntries(
  client: GatewayClient | null,
): Promise<Array<{ entry: GovernanceRegistryEntry; seatTitle: string }>> {
  const scope = await resolveEmployeeSeatScope(client);
  if (!scope) {
    return [];
  }
  try {
    const seatStore = await loadEnterpriseSeatAssetsStore(
      await resolveControlPlaneStorePathForClient(client, TENANT_SEAT_ASSETS_FILE),
    );
    const capabilityIds = Object.values(seatStore.accessPolicies)
      .filter(
        (policy) =>
          policy.tenantId === scope.tenantId &&
          policy.subjectType === "seat" &&
          policy.subjectId === scope.seatId &&
          policy.resourceType === "capability" &&
          policy.action === "execute" &&
          !policy.revokedAt,
      )
      .map((policy) => policy.resourceId);
    const entries = [...new Set(capabilityIds)]
      .map((capabilityId) => registryEntryForCapabilityId(capabilityId))
      .filter((entry): entry is GovernanceRegistryEntry => entry !== null);
    return entries.map((entry) => ({ entry, seatTitle: scope.seatTitle }));
  } catch {
    return [];
  }
}

async function listPlatformDirectCapabilityEntries(
  client: GatewayClient | null,
): Promise<GovernanceRegistryEntry[]> {
  const scope = await resolveEmployeeSeatScope(client);
  if (!scope) {
    return [];
  }
  return listRegistry().filter((entry) => {
    if (entry.lifecycleState !== "active") {
      return false;
    }
    if (entry.distribution.employeeVisibilityMode !== "direct_employee_visible") {
      return false;
    }
    const tenantIds = entry.distribution.scope.tenantIds;
    return !tenantIds || tenantIds.length === 0
      ? entry.distribution.defaultEnabled
      : tenantIds.includes(scope.tenantId);
  });
}

async function createEmployeeRuntimeProjectionContext(
  client: GatewayClient | null,
): Promise<EmployeeRuntimeProjectionContext | null> {
  const email = userEmailFromClient(client);
  if (!email) {
    return null;
  }
  const cfg = loadConfig();
  const authConfig = resolvePlatformAuthConfig(cfg.gateway?.auth?.trustedProxy);
  if (!authConfig?.enabled) {
    return null;
  }
  const platformStore = await loadPlatformAuthStore(authConfig);
  const scope = resolveAuthoritativeEnterpriseScopeForClient({
    store: platformStore,
    client,
    canonicalize: (value) => value?.trim() || null,
  });
  if (scope.kind !== "authoritative") {
    return null;
  }
  const { membership } = scope;
  const agentIds = new Set(
    listAgents({
      lifecycle: null,
      health: null,
      tenantId: membership.enterpriseId,
      searchQuery: "",
    }).map((agent) => agent.runtimeAgentId),
  );
  if (agentIds.size === 0) {
    return null;
  }
  const bindings = listBindings({
    runtimeAgentId: null,
    capabilityId: null,
    bindingType: null,
    bindingState: null,
    health: null,
  }).filter((binding) => agentIds.has(binding.runtimeAgentId));
  const telemetry = listTelemetry({
    runtimeAgentId: null,
    capabilityId: null,
    window: "30d",
  }).filter((sample) => agentIds.has(sample.runtimeAgentId));

  const bindingsByCapabilityId = new Map<string, RuntimeCapabilityBinding[]>();
  for (const binding of bindings) {
    const bucket = bindingsByCapabilityId.get(binding.capabilityId) ?? [];
    bucket.push(binding);
    bindingsByCapabilityId.set(binding.capabilityId, bucket);
  }

  const telemetryByBindingKey = new Map<string, RuntimeTelemetry[]>();
  for (const sample of telemetry) {
    const key = `${sample.runtimeAgentId}:${sample.capabilityId ?? ""}`;
    const bucket = telemetryByBindingKey.get(key) ?? [];
    bucket.push(sample);
    telemetryByBindingKey.set(key, bucket);
  }

  return { bindingsByCapabilityId, telemetryByBindingKey };
}

function latestRuntimeTelemetry(
  ctx: EmployeeRuntimeProjectionContext,
  binding: RuntimeCapabilityBinding,
): RuntimeTelemetry | null {
  const key = `${binding.runtimeAgentId}:${binding.capabilityId}`;
  return (
    ctx.telemetryByBindingKey
      .get(key)
      ?.toSorted((left, right) => right.lastSampleAt - left.lastSampleAt)[0] ?? null
  );
}

function runtimeBindingsForCapability(
  detail: EmployeeSkillDetail | EmployeeSkillSummary,
  registry: GovernanceRegistryEntry | null,
  ctx: EmployeeRuntimeProjectionContext | null,
): RuntimeCapabilityBinding[] {
  if (!ctx) {
    return [];
  }
  const candidateIds = new Set<string>([detail.id]);
  if (registry?.manifest.id) {
    candidateIds.add(registry.manifest.id);
  }
  return [...candidateIds]
    .flatMap((capabilityId) => ctx.bindingsByCapabilityId.get(capabilityId) ?? [])
    .filter((binding) => binding.bindingState !== "disabled");
}

function registryEntryToCapabilitySummary(
  entry: GovernanceRegistryEntry,
  seatTitle: string,
): CapabilitySummary {
  const createdAt = Date.parse(entry.createdAt);
  const updatedAt = Date.parse(entry.updatedAt);
  const timestamp = Number.isFinite(updatedAt)
    ? updatedAt
    : Number.isFinite(createdAt)
      ? createdAt
      : Date.now();
  const category =
    typeof entry.manifest.categoryId === "string" && entry.manifest.categoryId.trim()
      ? entry.manifest.categoryId.trim()
      : "企业能力";
  const tags = [category, seatTitle, "企业推送"].filter(Boolean);
  return {
    id: entry.manifest.skillKey || entry.manifest.id,
    name: entry.manifest.name,
    summary: entry.manifest.descriptionZh ?? entry.manifest.description,
    assetType: "capability",
    usageExamples: [`适用于${seatTitle}岗位的机器人能力补充`],
    inputDescription: "按能力说明输入业务素材",
    outputDescription: "输出结构化处理结果",
    tags,
    category,
    avatar: null,
    health: "运行稳定",
    shareVisibility: "已进入企业资产库",
    maturity: null,
    attribution: {
      sourceRobot: { id: "enterprise-capability-market", name: "企业能力市场" },
      sourceTaskSummary: "企业推送到岗位能力市场",
      firstFormedScenario: `${seatTitle}岗位能力市场`,
      highFrequencyScenarios: [`${seatTitle}岗位机器人增强`],
    },
    usage: {
      robots: [],
      totalUsageCount: 0,
      lastUsedAt: null,
    },
    usageMetrics: {
      robotCount: 0,
      groupCount: 0,
      totalUsageCount: 0,
      lastUsedAt: null,
    },
    recentUpdate: {
      id: `${entry.manifest.id}:position-market`,
      at: timestamp,
      headline: `企业已推送给${seatTitle}`,
    },
    versionInfo: {
      currentVersion: entry.manifest.version,
      versionCount: 1,
      submittedVersion: null,
    },
    isDraft: false,
    createdAt: Number.isFinite(createdAt) ? createdAt : timestamp,
    updatedAt: timestamp,
    applicationSummary: "可按机器人职责选择安装",
    feedbackSummary: "来自企业岗位能力市场",
    sourceContextLabel: `企业推送 · ${seatTitle}`,
  };
}

function registryEntryToPlatformDirectCapabilitySummary(
  entry: GovernanceRegistryEntry,
): CapabilitySummary {
  const createdAt = Date.parse(entry.createdAt);
  const updatedAt = Date.parse(entry.updatedAt);
  const timestamp = Number.isFinite(updatedAt)
    ? updatedAt
    : Number.isFinite(createdAt)
      ? createdAt
      : Date.now();
  const category =
    typeof entry.manifest.categoryId === "string" && entry.manifest.categoryId.trim()
      ? entry.manifest.categoryId.trim()
      : "平台能力";
  return {
    id: entry.manifest.skillKey || entry.manifest.id,
    name: entry.manifest.name,
    summary: entry.manifest.descriptionZh ?? entry.manifest.description,
    assetType: "capability",
    usageExamples: ["平台已向当前企业开放，可直接安装到适配机器人"],
    inputDescription: "按能力说明输入业务素材",
    outputDescription: "输出结构化处理结果",
    tags: [category, "平台直达"].filter(Boolean),
    category,
    avatar: null,
    health: "运行稳定",
    shareVisibility: "已进入企业资产库",
    maturity: null,
    attribution: {
      sourceRobot: { id: "platform-capability-market", name: "平台能力市场" },
      sourceTaskSummary: "平台直达企业员工能力市场",
      firstFormedScenario: "平台能力市场",
      highFrequencyScenarios: ["平台认证能力安装"],
    },
    usage: {
      robots: [],
      totalUsageCount: 0,
      lastUsedAt: null,
    },
    usageMetrics: {
      robotCount: 0,
      groupCount: 0,
      totalUsageCount: 0,
      lastUsedAt: null,
    },
    recentUpdate: {
      id: `${entry.manifest.id}:platform-direct`,
      at: timestamp,
      headline: "平台已向当前企业开放",
    },
    versionInfo: {
      currentVersion: entry.manifest.version,
      versionCount: 1,
      submittedVersion: null,
    },
    isDraft: false,
    createdAt: Number.isFinite(createdAt) ? createdAt : timestamp,
    updatedAt: timestamp,
    applicationSummary: "可直接安装到当前机器人",
    feedbackSummary: "来自平台能力市场",
    sourceContextLabel: "平台直达",
  };
}

function ensureEnterpriseCapabilityLocalAsset(params: {
  capabilityId: string;
  agentId: string;
  entry: GovernanceRegistryEntry;
  ownerUserId?: string | null;
}): void {
  const localSkillId = localSkillIdForRegistryEntry(params.entry, params.capabilityId);
  try {
    getPersonalSkillAssetDetail(localSkillId);
    return;
  } catch {
    // The capability is enterprise-provided; materialize a local installable
    // asset so the existing robot skill relation and runtime sync can reuse it.
    // Lineage prefix keeps these copies out of 我的资产.
  }
  saveSkillAsset({
    skillId: localSkillId,
    sourceAgentId: params.agentId,
    ownerUserId: params.ownerUserId ?? null,
    contextId: `enterprise-capability:${params.entry.manifest.id}`,
    lifecycle: "published",
    profile: {
      name: params.entry.manifest.name,
      summary: params.entry.manifest.descriptionZh ?? params.entry.manifest.description,
      assetType: "capability",
      usageExamples: ["来自企业岗位能力市场，可安装到适配机器人"],
      inputDescription: "按能力说明输入业务素材",
      outputDescription: "输出结构化处理结果",
      tags: ["企业能力", "岗位推送"],
      category:
        typeof params.entry.manifest.categoryId === "string"
          ? params.entry.manifest.categoryId
          : "企业能力",
      visibility: "enterprise",
    },
    enterpriseConsumers: [
      {
        consumerId: params.entry.manifest.id,
        name: "企业岗位能力市场",
        type: "position-market",
      },
    ],
  });
}

export type EmployeeCapabilityProfile = {
  robotId: string;
  whatItCanDo: CapabilitySummary[];
  goodAt: string[];
  recentlyLearned: Array<{ capabilityId: string; name: string; at: number }>;
  sourcesOfAccumulation: Array<{ label: string; count: number }>;
};

/**
 * 共享聚合（E1）：构建某机器人的能力画像。
 * `employee-capability.profile` handler 与大白引导（daibai-guide）共用，保证投影/语义一致。
 */
export function buildEmployeeCapabilityProfile(agentId: string): EmployeeCapabilityProfile {
  const capabilities = listRobotSkillAssets(agentId).map((entry) => toCapabilitySummary(entry));
  return {
    robotId: agentId,
    whatItCanDo: capabilities,
    goodAt: [...new Set(capabilities.flatMap((capability) => capability.tags))].slice(0, 6),
    recentlyLearned: capabilities.slice(0, 3).map((capability) => ({
      capabilityId: capability.id,
      name: capability.name,
      at: capability.updatedAt,
    })),
    sourcesOfAccumulation: [{ label: "日常工作", count: capabilities.length }],
  };
}

/**
 * 共享聚合（E1）：个人技能库推荐（同步层，不需 client）。
 * 与 `employee-capability.recommendations` 的 personal 档使用同一投影与过滤口径。
 */
export function buildEmployeeCapabilityPersonalRecommendations(
  agentId: string,
): Array<{ capability: CapabilitySummary; reason: string }> {
  const installedIds = new Set(listRobotSkillAssets(agentId).map((entry) => entry.id));
  return listPersonalSkillAssets()
    .map((entry) => toCapabilitySummary(entry))
    .filter((capability) => !installedIds.has(capability.id))
    .filter(
      (capability) =>
        capability.shareVisibility === "已共享到协作小组" ||
        capability.shareVisibility === "已进入企业资产库",
    )
    .toSorted((left, right) => right.usage.totalUsageCount - left.usage.totalUsageCount)
    .map((capability) => ({
      capability,
      reason:
        capability.shareVisibility === "已进入企业资产库"
          ? "已在企业资产库中沉淀，适合补充这个机器人"
          : "来自协作小组共享，适合当前工作场景",
    }));
}

export type EmployeeCapabilityRecommendation = {
  capability: CapabilitySummary;
  reason: string;
  source: RecommendationSource;
};

/**
 * 共享聚合（E1）：完整能力推荐（personal + position + platform 去重排序）。
 * `employee-capability.recommendations` handler 与大白引导（异步态）共用同一聚合与优先级。
 */
export async function buildEmployeeCapabilityRecommendations(
  agentId: string,
  client: GatewayClient | null,
): Promise<EmployeeCapabilityRecommendation[]> {
  const installedIds = new Set(listRobotSkillAssets(agentId).map((entry) => entry.id));
  const personalRecommendations: RecommendationEntry[] =
    buildEmployeeCapabilityPersonalRecommendations(agentId).map(({ capability, reason }) => ({
      capability,
      reason,
      priority: 3,
      source: "personal_shared" as const,
    }));
  const positionRecommendations: RecommendationEntry[] = (
    await listPositionCapabilityEntries(client)
  )
    .map(({ entry, seatTitle }) => ({
      capability: registryEntryToCapabilitySummary(entry, seatTitle),
      reason: `企业已推送到${seatTitle}岗位能力市场，可按机器人职责选择安装`,
      priority: 1,
      source: "position_market" as const,
    }))
    .filter((entry) => !installedIds.has(entry.capability.id));
  const platformDirectRecommendations: RecommendationEntry[] = (
    await listPlatformDirectCapabilityEntries(client)
  )
    .map((entry) => ({
      capability: registryEntryToPlatformDirectCapabilitySummary(entry),
      reason: "平台已向当前企业开放，可直接安装到这个机器人",
      priority: 2,
      source: "platform_direct" as const,
    }))
    .filter((entry) => !installedIds.has(entry.capability.id));

  const dedupedById = new Map<string, RecommendationEntry>();
  for (const entry of [
    ...positionRecommendations,
    ...platformDirectRecommendations,
    ...personalRecommendations,
  ]) {
    const existing = dedupedById.get(entry.capability.id);
    if (!existing || entry.priority < existing.priority) {
      dedupedById.set(entry.capability.id, entry);
    }
  }
  return [...dedupedById.values()]
    .toSorted((left, right) => left.priority - right.priority)
    .map(({ capability, reason, source }) => ({ capability, reason, source }));
}

function verbsForCapabilityId(
  capabilityId: string,
  profile: { name: string; summary: string; tags: string[] },
): { verbs: string[]; secrets: boolean; native: boolean } {
  let verbs: string[] = [];
  let secrets = packSkillRequiresSecret(capabilityId);
  let native = packSkillIsNative(capabilityId);
  try {
    const bundle = getSkillRuntimeDefinitionForBinding(capabilityId);
    verbs = resolveVerbsForSkill({
      skillId: capabilityId,
      skillKey: capabilityId,
      name: profile.name,
      summary: profile.summary,
      tags: profile.tags,
      explicit: bundle.runtimeDefinition.capabilities,
    });
    secrets =
      secrets ||
      bundle.runtimeDefinition.providers.some(
        (provider) => provider.requiresSecret === true || provider.kind === "api",
      );
    native =
      native || bundle.runtimeDefinition.providers.some((provider) => provider.kind === "native");
  } catch {
    verbs = resolveVerbsForSkill({
      skillId: capabilityId,
      skillKey: capabilityId,
      name: profile.name,
      summary: profile.summary,
      tags: profile.tags,
    });
  }
  return { verbs, secrets, native };
}

function toMatchCandidate(params: {
  id: string;
  name: string;
  summary: string;
  tags: string[];
  category: string;
  installed: boolean;
  lifecycle?: EmployeeSkillSummary["lifecycle"];
}): CapabilityMatchCandidate {
  const flags = verbsForCapabilityId(params.id, params);
  return {
    id: params.id,
    name: params.name,
    summary: params.summary,
    tags: params.tags,
    category: params.category,
    installed: params.installed,
    lifecycle: params.lifecycle,
    ...flags,
  };
}

function assertCapabilityInstallAllowed(params: { capabilityId: string; agentId: string }): void {
  const installedIds = new Set(listRobotSkillAssets(params.agentId).map((entry) => entry.id));
  let lifecycle: EmployeeSkillSummary["lifecycle"] | undefined;
  let name = params.capabilityId;
  let summary = "";
  let tags: string[] = [];
  let category = "";
  try {
    const detail = getPersonalSkillAssetDetail(params.capabilityId);
    lifecycle = detail.lifecycle;
    name = detail.profile.name;
    summary = detail.profile.summary;
    tags = detail.profile.tags;
    category = detail.profile.category;
  } catch {
    // Registry-only ids still go through pack flags.
  }
  const assessment = assessSkillAvailability(
    toMatchCandidate({
      id: params.capabilityId,
      name,
      summary,
      tags,
      category,
      installed: installedIds.has(params.capabilityId),
      lifecycle,
    }),
  );
  if (!assessment.installAllowed) {
    throw new SkillAssetStoreError(assessment.nextStep);
  }
}

export const employeeCapabilityHandlers: GatewayRequestHandlers = {
  "employee-capability.profile": ({ params, respond }) => {
    const agentId = requiredString(params, "agentId", respond);
    if (!agentId) {
      return;
    }
    respond(true, { profile: buildEmployeeCapabilityProfile(agentId) }, undefined);
  },

  "employee-capability.toggle": ({ params, respond }) => {
    const capabilityId = requiredString(params, "capabilityId", respond);
    const agentId = requiredString(params, "agentId", respond);
    if (!capabilityId || !agentId) {
      return;
    }
    if (typeof params.enabled !== "boolean") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "enabled is required"));
      return;
    }
    try {
      toggleRobotSkillAsset({ agentId, skillId: capabilityId, enabled: params.enabled });
      respond(true, { capabilityId, agentId, enabled: params.enabled }, undefined);
    } catch (error) {
      respondCapabilityError(respond, error);
    }
  },

  "employee-capability.remove-from-robot": ({ params, respond }) => {
    const capabilityId = requiredString(params, "capabilityId", respond);
    const agentId = requiredString(params, "agentId", respond);
    if (!capabilityId || !agentId) {
      return;
    }
    try {
      removeRobotSkillAsset({ agentId, skillId: capabilityId });
      respond(true, { capabilityId, agentId }, undefined);
    } catch (error) {
      respondCapabilityError(respond, error);
    }
  },

  "employee-capability.install-to-robot": async ({ params, respond, client }) => {
    const capabilityId = requiredString(params, "capabilityId", respond);
    const agentId = requiredString(params, "agentId", respond);
    if (!capabilityId || !agentId) {
      return;
    }
    try {
      const reviewBlock = await resolvePackSkillInstallBlock({
        client,
        capabilityId,
        targetRobotId: agentId,
      });
      if (reviewBlock) {
        throw reviewBlock;
      }
      const enterpriseEntry = registryEntryForCapabilityId(capabilityId);
      const installCapabilityId = enterpriseEntry
        ? localSkillIdForRegistryEntry(enterpriseEntry, capabilityId)
        : capabilityId;
      if (enterpriseEntry) {
        ensureEnterpriseCapabilityLocalAsset({
          capabilityId: installCapabilityId,
          agentId,
          entry: enterpriseEntry,
          ownerUserId: await resolvePersonalAssetOwnerUserId(client),
        });
      }
      assertCapabilityInstallAllowed({ capabilityId: installCapabilityId, agentId });
      const projection = mountSkillAssetOnRobot({
        agentId,
        skillId: installCapabilityId,
      });
      let bundle: ReturnType<typeof getSkillRuntimeDefinitionForBinding> | null = null;
      try {
        bundle = getSkillRuntimeDefinitionForBinding(installCapabilityId);
      } catch {
        bundle = null;
      }
      if (
        bundle &&
        isExecutableSkillProjectionEligible({
          enabled: true,
          lifecycle: bundle.lifecycle,
          assetType: bundle.profile.assetType,
        }) &&
        !projection.mounted
      ) {
        throw new SkillAssetStoreError(
          `已记录安装，但未能挂载到该机器人（${projection.reason ?? "unknown"}）。请重试。`,
        );
      }
      recordAdoptionSignal({
        ownerKey: adoptionOwnerKeyFromClient(client),
        capabilityId: installCapabilityId,
        kind: "member_use",
        memberId: agentId,
      });
      const userEmail = userEmailFromClient(client);
      if (userEmail) {
        await syncInstallToRuntime({
          cfg: loadConfig(),
          userEmail,
          capabilityId: installCapabilityId,
        });
      }
      respond(
        true,
        {
          capabilityId: installCapabilityId,
          agentId,
          mounted: projection.mounted,
        },
        undefined,
      );
    } catch (error) {
      respondCapabilityError(respond, error);
    }
  },

  "employee-capability.quick-save": async ({ params, respond, client }) => {
    const sourceAgentId = requiredString(params, "sourceAgentId", respond);
    if (!sourceAgentId) {
      return;
    }
    const form = parseQuickSaveForm(params);
    if (!form) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "name and summary are required"),
      );
      return;
    }
    try {
      const ownerUserId = requirePersonalAssetOwner(await resolvePersonalAssetOwnerUserId(client));
      const result = saveSkillAsset({
        sourceAgentId,
        ownerUserId,
        contextId: optionalString(params, "sourceContextId"),
        profile: {
          name: form.name,
          summary: form.summary,
          visibility: "private",
        },
      });
      respond(true, { capability: toCapabilitySummary(result.detail) }, undefined);

      // 后台异步触发 LLM 内容增强（不阻塞 save 响应）
      void triggerAssetCuration({
        skillId: result.skillId,
        sourceAgentId,
      }).catch(() => undefined);
    } catch (error) {
      respondCapabilityError(respond, error);
    }
  },

  "employee-capability.my-accumulation": async ({ client, params, respond }) => {
    const query = optionalString(params, "searchQuery")?.toLowerCase() ?? "";
    const filterTag = optionalString(params, "filterTag");
    const filterCategory = optionalString(params, "filterCategory");
    const filterSource = optionalString(params, "filterSource");
    const filterShareVisibility = optionalString(params, "filterShareVisibility");
    const runtimeCtx = await createEmployeeRuntimeProjectionContext(client);
    const ownerIds = await resolvePersonalAssetOwnerIdentities(client);
    const capabilities = listMyAccumulationSkillAssets(ownerIds)
      .map((summary) => getPersonalSkillAssetDetail(summary.id))
      .map((detail) => toCapabilitySummary(detail, runtimeCtx));
    const items = capabilities
      .filter((capability) => {
        if (
          query &&
          !capability.name.toLowerCase().includes(query) &&
          !capability.summary.toLowerCase().includes(query)
        ) {
          return false;
        }
        if (filterTag && !capability.tags.includes(filterTag)) {
          return false;
        }
        if (filterCategory && capability.category !== filterCategory) {
          return false;
        }
        if (filterSource && capability.attribution.sourceRobot.name !== filterSource) {
          return false;
        }
        if (filterShareVisibility && capability.shareVisibility !== filterShareVisibility) {
          return false;
        }
        return true;
      })
      .map(toListItem);
    const availableTags = Array.from(
      new Set(capabilities.flatMap((capability) => capability.tags)),
    );
    const availableCategories = Array.from(
      new Set(
        capabilities
          .map((capability) => capability.category)
          .filter((value) => value.trim().length > 0),
      ),
    );
    const availableSources = Array.from(
      new Set(
        capabilities
          .map((capability) => capability.attribution.sourceRobot.name)
          .filter((value) => value.trim().length > 0),
      ),
    );
    respond(true, { items, availableTags, availableCategories, availableSources }, undefined);
  },

  "employee-capability.detail": async ({ client, params, respond }) => {
    const capabilityId = requiredString(params, "capabilityId", respond);
    if (!capabilityId) {
      return;
    }
    try {
      const runtimeCtx = await createEmployeeRuntimeProjectionContext(client);
      const detail = await loadOwnedPersonalSkill(client, capabilityId);
      respond(true, { capability: toCapabilitySummary(detail, runtimeCtx) }, undefined);
    } catch (error) {
      respondCapabilityError(respond, error);
    }
  },

  "employee-capability.edit": async ({ params, respond, client }) => {
    const capabilityId = requiredString(params, "capabilityId", respond);
    if (!capabilityId) {
      return;
    }
    const changes = isRecord(params.changes) ? params.changes : {};
    try {
      const current = await loadOwnedPersonalSkill(client, capabilityId);
      const edited = editPersonalSkillAsset({
        skillId: capabilityId,
        profile: {
          ...current.profile,
          name: stringValue(changes.name, current.profile.name),
          summary: stringValue(changes.summary, current.profile.summary),
          usageExamples: Array.isArray(changes.usageExamples)
            ? nonemptyStrings(changes.usageExamples)
            : current.profile.usageExamples,
          inputDescription: stringValue(changes.inputDescription, current.profile.inputDescription),
          outputDescription: stringValue(
            changes.outputDescription,
            current.profile.outputDescription,
          ),
          tags: Array.isArray(changes.tags) ? nonemptyStrings(changes.tags) : current.profile.tags,
          category: stringValue(changes.category, current.profile.category),
          avatar: stringValue(changes.avatar, current.profile.avatar),
        },
        summary: optionalString(params, "changeHeadline") ?? "最近更新 · 优化了能力说明",
      });
      respond(true, { capability: toCapabilitySummary(edited) }, undefined);
    } catch (error) {
      respondCapabilityError(respond, error);
    }
  },

  "employee-capability.delete": async ({ params, respond, client }) => {
    const capabilityId = requiredString(params, "capabilityId", respond);
    if (!capabilityId) {
      return;
    }
    try {
      await loadOwnedPersonalSkill(client, capabilityId);
      deletePersonalSkillAsset(capabilityId);
      respond(true, { capabilityId }, undefined);
    } catch (error) {
      respondCapabilityError(respond, error);
    }
  },

  "employee-capability.share-to-group": async ({ params, client, context, respond }) => {
    const capabilityId = requiredString(params, "capabilityId", respond);
    const groupId = requiredString(params, "groupId", respond);
    if (!capabilityId || !groupId) {
      return;
    }
    try {
      await loadOwnedPersonalSkill(client, capabilityId);
      const userEmail = userEmailFromClient(client);
      // 分享由用户从工作台发起：归因以 user email + 显示名为准。
      // GatewayClient 无 agentId 字段，client 层拿不到可靠的 agent 身份，故 agentId 记为 null。
      const displayName = submittedByFromClient(client) ?? userEmail ?? "未知用户";
      const detail = sharePersonalSkillToGroup({
        skillId: capabilityId,
        groupId,
        sharedBy: {
          userId: userEmail,
          agentId: null,
          displayName,
        },
      });
      void applySharedSkillToGroupParticipation({
        groupId,
        skillId: capabilityId,
        skillLabel: detail.profile.name || capabilityId,
        botId: detail.sourceRobot?.id ?? null,
      }).catch(() => undefined);
      recordAdoptionSignal({
        ownerKey: adoptionOwnerKeyFromClient(client),
        capabilityId,
        kind: "share_to_group",
        memberId: groupId,
      });

      // 发送小组通知（实时推送到 group session + 持久归因已在 store 记录）
      void sendGroupNotification({
        groupId,
        message: formatAssetShareNotification({
          assetName: detail.profile.name,
          assetType: detail.profile.assetType,
          sharedBy: displayName,
        }),
        metadata: {
          type: "asset_shared",
          relatedResourceId: capabilityId,
          actionBy: displayName,
        },
        delivery: {
          groupId,
          botId: detail.sourceRobot?.id ?? null,
          nodeSendToSession: context.nodeSendToSession,
        },
      }).catch((err) => {
        console.error(`Failed to send group notification for asset share: ${err}`);
      });

      respond(true, { capabilityId, groupId, shareVisibility: "已共享到协作小组" }, undefined);
    } catch (error) {
      respondCapabilityError(respond, error);
    }
  },

  // Canonical employee submit. personal-skills.submit / skill-review.submit alias this write.
  "employee-capability.submit-to-enterprise": async ({ client, params, respond }) => {
    const capabilityId = requiredString(params, "capabilityId", respond);
    if (!capabilityId) {
      return;
    }
    try {
      await loadOwnedPersonalSkill(client, capabilityId);
      const submittedBy =
        typeof params.submittedBy === "string" && params.submittedBy.trim()
          ? params.submittedBy.trim()
          : (submittedByFromClient(client) ?? "employee-capability");
      const enterpriseId =
        typeof params.enterpriseId === "string" && params.enterpriseId.trim()
          ? params.enterpriseId.trim()
          : await resolveEmployeeEnterpriseId(client);
      const submitted = submitSkillToEnterpriseReview({
        skillId: capabilityId,
        submittedBy,
        enterpriseId,
        packageDraft: params.packageDraft,
      });
      recordAdoptionSignal({
        ownerKey: adoptionOwnerKeyFromClient(client),
        capabilityId,
        kind: "enterprise_submit",
      });
      respond(true, { capabilityId, shareVisibility: submitted.shareVisibility }, undefined);
    } catch (error) {
      respondCapabilityError(respond, error);
    }
  },

  "employee-capability.recommendations": async ({ params, respond, client }) => {
    const agentId = requiredString(params, "agentId", respond);
    if (!agentId) {
      return;
    }
    try {
      const recommendations = await buildEmployeeCapabilityRecommendations(agentId, client);
      respond(true, { recommendations }, undefined);
    } catch (error) {
      respondCapabilityError(respond, error);
    }
  },

  "employee-capability.can": async ({ params, respond, client }) => {
    const agentId = requiredString(params, "agentId", respond);
    const intent = optionalString(params, "intent") || optionalString(params, "query");
    if (!agentId) {
      return;
    }
    if (!intent) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "intent is required"));
      return;
    }
    try {
      const installed = listRobotSkillAssets(agentId);
      const installedIds = new Set(installed.map((entry) => entry.id));
      const recommendations = await buildEmployeeCapabilityRecommendations(agentId, client);
      const candidates: CapabilityMatchCandidate[] = [
        ...installed.map((entry) =>
          toMatchCandidate({
            id: entry.id,
            name: entry.profile.name,
            summary: entry.profile.summary,
            tags: entry.profile.tags,
            category: entry.profile.category,
            installed: true,
            lifecycle: entry.lifecycle,
          }),
        ),
        ...recommendations.map((entry) =>
          toMatchCandidate({
            id: entry.capability.id,
            name: entry.capability.name,
            summary: entry.capability.summary,
            tags: entry.capability.tags,
            category: entry.capability.category,
            installed: installedIds.has(entry.capability.id),
          }),
        ),
      ];
      const deduped = new Map<string, CapabilityMatchCandidate>();
      for (const candidate of candidates) {
        const existing = deduped.get(candidate.id);
        if (!existing || candidate.installed) {
          deduped.set(candidate.id, candidate);
        }
      }
      const matches = matchCapabilityIntent(intent, [...deduped.values()])
        .map((match) => {
          const installedEntry = installed.find((entry) => entry.id === match.id);
          const recommended = recommendations.find((entry) => entry.capability.id === match.id);
          const capability = installedEntry
            ? toCapabilitySummary(installedEntry)
            : recommended?.capability;
          if (!capability) {
            return null;
          }
          return {
            capability,
            task: match.task,
            status: match.assessment.status,
            nextStep: match.assessment.nextStep,
          };
        })
        .filter((row) => row !== null);
      respond(true, { query: intent, matches }, undefined);
    } catch (error) {
      respondCapabilityError(respond, error);
    }
  },

  "employee-capability.preflight": ({ params, respond }) => {
    const agentId = requiredString(params, "agentId", respond);
    const capabilityId = requiredString(params, "capabilityId", respond);
    if (!agentId || !capabilityId) {
      return;
    }
    try {
      const installedIds = new Set(listRobotSkillAssets(agentId).map((entry) => entry.id));
      let name = capabilityId;
      let summary = "";
      let tags: string[] = [];
      let category = "";
      let lifecycle: EmployeeSkillSummary["lifecycle"] | undefined;
      try {
        const detail = getPersonalSkillAssetDetail(capabilityId);
        name = detail.profile.name;
        summary = detail.profile.summary;
        tags = detail.profile.tags;
        category = detail.profile.category;
        lifecycle = detail.lifecycle;
      } catch {
        // Pack/registry ids still resolve flags from the pack catalog.
      }
      const assessment = assessSkillAvailability(
        toMatchCandidate({
          id: capabilityId,
          name,
          summary,
          tags,
          category,
          installed: installedIds.has(capabilityId),
          lifecycle,
        }),
      );
      respond(
        true,
        {
          capabilityId,
          status: assessment.status,
          nextStep: assessment.nextStep,
          canInstall: assessment.installAllowed,
        },
        undefined,
      );
    } catch (error) {
      respondCapabilityError(respond, error);
    }
  },

  "employee-capability.attribution": async ({ params, respond, client }) => {
    const capabilityId = requiredString(params, "capabilityId", respond);
    if (!capabilityId) {
      return;
    }
    try {
      const capability = toCapabilitySummary(await loadOwnedPersonalSkill(client, capabilityId));
      respond(true, { capabilityId, attribution: capability.attribution }, undefined);
    } catch (error) {
      respondCapabilityError(respond, error);
    }
  },

  "employee-capability.usage-brief": async ({ params, respond, client }) => {
    const capabilityId = requiredString(params, "capabilityId", respond);
    if (!capabilityId) {
      return;
    }
    try {
      const capability = toCapabilitySummary(await loadOwnedPersonalSkill(client, capabilityId));
      respond(true, { capabilityId, usage: capability.usage }, undefined);
    } catch (error) {
      respondCapabilityError(respond, error);
    }
  },

  "employee-capability.health-label.subscribe": async ({ params, respond, client }) => {
    const capabilityIds = Array.isArray(params.capabilityIds)
      ? params.capabilityIds.map((entry) => stringValue(entry)).filter(Boolean)
      : [];
    const ownerIds = await resolvePersonalAssetOwnerIdentities(client);
    respond(
      true,
      {
        subscriptionId: `employee-capability-health-${Date.now()}`,
        initialLabels: capabilityIds.map((capabilityId) => {
          try {
            const detail = requireOwnedPersonalSkill({ skillId: capabilityId, ownerIds });
            return {
              capabilityId,
              health: toCapabilitySummary(detail).health,
            };
          } catch {
            return { capabilityId, health: "运行稳定" };
          }
        }),
      },
      undefined,
    );
  },

  "employee-capability.update-recap": async ({ params, respond, client }) => {
    const capabilityId = requiredString(params, "capabilityId", respond);
    if (!capabilityId) {
      return;
    }
    try {
      const detail = await loadOwnedPersonalSkill(client, capabilityId);
      respond(true, { capabilityId, recaps: updateRecaps(detail) }, undefined);
    } catch (error) {
      respondCapabilityError(respond, error);
    }
  },
};
