import { Buffer } from "node:buffer";
import { loadConfig } from "../../config/config.js";
import { maybeSeedAgentRuntimeFromPlatformState } from "../agent-runtime-seed.js";
import {
  deleteBinding,
  getBinding,
  listAgents,
  listBindings,
  listTelemetry,
  upsertBinding,
  type RuntimeAgent,
  type RuntimeCapabilityBinding,
} from "../agent-runtime-store.js";
import {
  resolveContributionProvenance,
  type ContributionAttributionContext,
} from "../capability-attribution/resolve-contribution-provenance.js";
import {
  approveAndRegister,
  getProposal,
  getRegistryEntry,
  listProposals,
  listRegistry,
  updateProposalStatus,
  updateRegistryMaturityGrant,
  type GovernanceManifest,
  type GovernanceProposal,
  type GovernanceDistributionScope,
  type GovernanceRegistryEntry,
} from "../capability-governance-store.js";
import {
  canSubmitToPlatform,
  ensureSanitizationSession,
  getSanitizationSession,
  updateSanitizationSession,
  createEnterpriseSubmission,
  listEnterpriseSubmissions,
  listGovernanceEvents,
  recordGovernanceEvent,
  createSanitizedPackage,
  getSanitizedPackage,
  type EnterpriseSubmissionStatus,
} from "../capability-install-governance-store.js";
import {
  CAPABILITY_MATURITY_ORDER,
  effectiveMaturity,
  maturityFromUsage,
  monthlyExecutionsFromBindings,
  uniqueAgentCount,
  type CapabilityMaturity,
} from "../capability-maturity.js";
import { hideRegistryDraftFromPublicCatalog } from "../enterprise-data/capability-center-install.js";
import {
  grantEnterpriseAccessPolicy,
  loadEnterpriseSeatAssetsStore,
  saveEnterpriseSeatAssetsStore,
  type EnterpriseSeatAssetsStore,
  type EnterprisePositionSeat,
  type EnterpriseSeatBinding,
} from "../enterprise-seat-assets-store.js";
import {
  loadPlatformAuthStore,
  resolvePlatformAuthConfig,
  type PlatformAuthMembership,
  type PlatformAuthStore,
  type PlatformAuthUser,
} from "../platform-auth.js";
import { resolveAuthoritativeEnterpriseScopeForClient } from "../platform-auth/active-membership-scope.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { listAgentsForGateway } from "../session-utils.js";
import { rematerializeApprovedEnterpriseSkill } from "../skill-enterprise-submission.js";
import { syncSkillExecutionBinding } from "../skill-execution-binding/sync.js";
import { EXECUTABLE_LIFECYCLES } from "../skill-execution-binding/types.js";
import {
  getPersonalSkillAssetDetail,
  getSkillRuntimeDefinitionForBinding,
  removeRobotSkillAsset,
  SkillAssetStoreError,
  type AssetType,
} from "../skill-lifecycle-store.js";
import { resolveControlPlaneStorePathForClient } from "../tenant-context.js";
import { TENANT_SEAT_ASSETS_FILE } from "../tenant-store-paths.js";
import { mountSkillAssetOnRobot } from "./employee-capability.js";
import {
  exactMember,
  isRecord,
  nonemptyStrings as stringArray,
  oneOf,
  optionalString as stringParam,
  respondInvalid,
  respondUnavailable,
  stringValue,
} from "./request-params.js";
import type { GatewayClient, GatewayRequestHandlers } from "./types.js";

type AssetLifecycle =
  | "submitted"
  | "reviewing"
  | "approved"
  | "published"
  | "deprecated"
  | "retired";
type CapabilityDomain = "销售" | "HR" | "客服" | "财务" | "法务" | "数据分析";
type EnterpriseHealthStatus = "效果稳定" | "偶尔结果不理想" | "建议重新整理" | "已不适合继续推广";
type ApplicableScope =
  | { kind: "enterprise" }
  | { kind: "department"; id: string; name: string }
  | { kind: "group"; id: string; name: string }
  | { kind: "role"; id: string; name: string };
type AssetSortField = "maturity" | "reuseValue" | "createdAt";
type SortDirection = "asc" | "desc";
type ContributionRecordsSortField = "submittedAt" | "employeeName" | "reviewStatus";
type SidebarEntry = "my-installed" | "my-contributed" | "all";
type ReviewResult = "通过" | "拒绝" | "需修改";
type ReviewStatus = "待审核" | "审核中" | "已通过" | "已拒绝" | "需修改";
type InstallSource = "管理员推送" | "员工自主安装";
type InstallStatus = "正常运行" | "已暂停" | "待更新";
type EnterpriseAssetPackageType =
  | "single_capability"
  | "template_pack"
  | "workflow_pack"
  | "knowledge_pack"
  | "automation_pack"
  | "composite_pack";
type EnterpriseAssetExecutionMode = "assistive" | "semi_automatic" | "automatic";
type EnterpriseAssetRiskTag =
  | "external_publish"
  | "credential_required"
  | "brand_risk"
  | "customer_data"
  | "manual_review_required";
type EnterpriseAssetPackage = {
  packageTitle: string;
  packageSummary: string;
  assetPackageType: EnterpriseAssetPackageType;
  businessScenario: string;
  inputArtifacts: string[];
  outputArtifacts: string[];
  dependencies: string[];
  executionMode: EnterpriseAssetExecutionMode;
  riskTags: EnterpriseAssetRiskTag[];
  targetTeams: string[];
  verifiedInProduction: boolean;
  promotionIntent: "internal_reuse" | "pilot" | "enterprise_standard" | "platform_candidate";
  needsEnterpriseSecrets: boolean;
  notes: string;
};

type EnterpriseCapabilityValueSummary = {
  monthlyExecutions: number;
  departmentCoverageCount: number;
  reuseGrowthRate30d: number;
};

type EnterpriseReuseData = {
  robotCount: number;
  employeeCount: number;
  departmentCount: number;
  trend30Days: number[];
  growthPercentage: number;
};

type ContributionRecord = {
  id: string;
  employeeId: string;
  employeeName: string;
  timestamp: number;
  type: "初始提交" | "内容修改" | "场景补充";
  summary: string;
};

type ReviewRecord = {
  id: string;
  reviewerId: string;
  reviewerName: string;
  timestamp: number;
  result: ReviewResult;
  opinion: string;
};

type EnterpriseAssetCatalog = "skills" | "mcp";

type EnterpriseCapabilityAsset = {
  id: string;
  name: string;
  description: string;
  usageScenarios: string[];
  applicableScope: ApplicableScope;
  domain: CapabilityDomain;
  maturity: CapabilityMaturity;
  healthStatus: EnterpriseHealthStatus;
  healthManualLock: boolean;
  healthNoTelemetry: boolean;
  assetType: AssetType;
  mcpServerName: string | null;
  lifecycle: AssetLifecycle;
  valueSummary: EnterpriseCapabilityValueSummary;
  credibilityIndicators: {
    verifiedDepartments: string[];
    productionUsageDays: number;
  };
  reuseData: EnterpriseReuseData;
  source: {
    employee: { id: string; name: string };
    robot: { id: string; name: string };
    task: { id: string; summary: string };
  };
  contributionHistory: ContributionRecord[];
  reviewHistory: ReviewRecord[];
  avatar: string | null;
  createdAt: number;
  updatedAt: number;
};

type EnterpriseAssetListItem = {
  id: string;
  name: string;
  description: string;
  usageScenarios: string[];
  applicableScope: ApplicableScope;
  domain: CapabilityDomain;
  maturity: CapabilityMaturity;
  healthStatus: EnterpriseHealthStatus;
  assetType: AssetType;
  mcpServerName: string | null;
  lifecycle: AssetLifecycle;
  valueSummary: EnterpriseCapabilityValueSummary;
  reuseData: EnterpriseReuseData;
  sourceEmployeeName: string;
  avatar: string | null;
};

type InstallRelation = {
  id: string;
  capabilityId: string;
  capabilityName: string;
  robotId: string;
  robotName: string;
  robotOwnerEmployeeId?: string | null;
  robotOwnerEmployeeName?: string | null;
  robotOwnerEmployeeEmail?: string | null;
  robotPositionId?: string | null;
  robotPositionTitle?: string | null;
  robotTeamLabel?: string | null;
  robotRoleCode?: string | null;
  installedAt: number;
  source: InstallSource;
  status: InstallStatus;
};

type InstallRelationEnhanced = InstallRelation & {
  businessSource?: "员工沉淀" | "企业发布";
  usageStats?: {
    executions30d: number;
    successRate: number;
  };
};

type EnterpriseScope = {
  cfg: ReturnType<typeof loadConfig>;
  platformStore: PlatformAuthStore | null;
  user: PlatformAuthUser | null;
  membership: PlatformAuthMembership | null;
  tenantId: string | null;
  tenantName: string;
  employeeCount: number;
};

type RuntimeProjectionContext = {
  scope: EnterpriseScope;
  agents: RuntimeAgent[];
  bindings: RuntimeCapabilityBinding[];
  seatStore: EnterpriseSeatAssetsStore | null;
};

function authoritativeEnterpriseId(scope: EnterpriseScope): string | null {
  const id = scope.membership?.enterpriseId?.trim();
  return id || null;
}

/** Proposals with no enterpriseId, or another tenant's id, are not this tenant's. */
function listProposalsForAuthoritativeTenant(tenantId: string | null): GovernanceProposal[] {
  if (!tenantId) {
    return [];
  }
  return listProposals().filter((proposal) => proposal.enterpriseId === tenantId);
}

function toAttributionContext(ctx: RuntimeProjectionContext): ContributionAttributionContext {
  return {
    scope: {
      cfg: ctx.scope.cfg,
      platformStore: ctx.scope.platformStore,
      tenantId: ctx.scope.tenantId,
      tenantName: ctx.scope.tenantName,
      employeeCount: ctx.scope.employeeCount,
    },
    seatStore: ctx.seatStore,
    agents: ctx.agents,
  };
}

const CAPABILITY_DOMAINS: readonly CapabilityDomain[] = [
  "销售",
  "HR",
  "客服",
  "财务",
  "法务",
  "数据分析",
] as const;

const MATURITY_ORDER = CAPABILITY_MATURITY_ORDER;

async function resolveEnterpriseIdFromClient(client: GatewayClient | null): Promise<string> {
  const email = stringValue(client?.user);
  if (!email) {
    return "default";
  }
  try {
    const cfg = loadConfig();
    const authConfig = resolvePlatformAuthConfig(cfg.gateway?.auth?.trustedProxy);
    if (!authConfig?.enabled) {
      return "default";
    }
    const platformStore = await loadPlatformAuthStore(authConfig);
    const scope = resolveAuthoritativeEnterpriseScopeForClient({
      store: platformStore,
      client,
      canonicalize: (value) => value?.trim() || null,
    });
    return scope.kind === "authoritative" ? scope.enterpriseId : "default";
  } catch {
    return "default";
  }
}

/**
 * Map the canonical EnterpriseSubmission lifecycle status onto the incubation
 * center tracker's display status. Keeps one status vocabulary for the "上报记录"
 * list while sourcing data from the real platform-submission store.
 */
function mapSubmissionStatusToProposalStatus(
  status: EnterpriseSubmissionStatus,
): "pending" | "reviewing" | "approved" | "rejected" | "supplement" {
  switch (status) {
    case "reviewing":
      return "reviewing";
    case "published":
    case "enterprise-only":
      return "approved";
    case "rejected":
      return "rejected";
    case "returned-for-modification":
      return "supplement";
    default:
      return "pending";
  }
}

function enterpriseAssetPackageFromManifest(
  manifest: GovernanceManifest,
): EnterpriseAssetPackage | null {
  const raw = isRecord(manifest.enterpriseAssetPackage) ? manifest.enterpriseAssetPackage : null;
  if (!raw) {
    return null;
  }
  return {
    packageTitle: stringValue(raw.packageTitle) || manifest.name,
    packageSummary: stringValue(raw.packageSummary) || manifest.description,
    assetPackageType:
      raw.assetPackageType === "template_pack" ||
      raw.assetPackageType === "workflow_pack" ||
      raw.assetPackageType === "knowledge_pack" ||
      raw.assetPackageType === "automation_pack" ||
      raw.assetPackageType === "composite_pack"
        ? raw.assetPackageType
        : "single_capability",
    businessScenario: stringValue(raw.businessScenario) || "",
    inputArtifacts: stringArray(raw.inputArtifacts),
    outputArtifacts: stringArray(raw.outputArtifacts),
    dependencies: stringArray(raw.dependencies),
    executionMode:
      raw.executionMode === "semi_automatic" || raw.executionMode === "automatic"
        ? raw.executionMode
        : "assistive",
    riskTags: stringArray(raw.riskTags).filter((entry): entry is EnterpriseAssetRiskTag =>
      [
        "external_publish",
        "credential_required",
        "brand_risk",
        "customer_data",
        "manual_review_required",
      ].includes(entry),
    ),
    targetTeams: stringArray(raw.targetTeams),
    verifiedInProduction:
      typeof raw.verifiedInProduction === "boolean" ? raw.verifiedInProduction : false,
    promotionIntent:
      raw.promotionIntent === "pilot" ||
      raw.promotionIntent === "enterprise_standard" ||
      raw.promotionIntent === "platform_candidate"
        ? raw.promotionIntent
        : "internal_reuse",
    needsEnterpriseSecrets:
      typeof raw.needsEnterpriseSecrets === "boolean" ? raw.needsEnterpriseSecrets : false,
    notes: stringValue(raw.notes) || "",
  };
}

function defaultEnterpriseAssetPackageFromManifest(
  manifest: GovernanceManifest,
): EnterpriseAssetPackage {
  return {
    packageTitle: manifest.name,
    packageSummary: manifest.description,
    assetPackageType: "single_capability",
    businessScenario: manifest.description,
    inputArtifacts: [],
    outputArtifacts: [],
    dependencies: [],
    executionMode: "assistive",
    riskTags: [],
    targetTeams: [],
    verifiedInProduction: false,
    promotionIntent: "internal_reuse",
    needsEnterpriseSecrets: false,
    notes: "",
  };
}

function pageInput(raw: unknown): { page: number; pageSize: 10 | 20 | 50 } {
  const record = isRecord(raw) ? raw : {};
  const pageRaw = record.page;
  const page = typeof pageRaw === "number" && Number.isFinite(pageRaw) ? Math.max(1, pageRaw) : 1;
  const pageSizeRaw = record.pageSize;
  const pageSize: 10 | 20 | 50 =
    pageSizeRaw === 20 || pageSizeRaw === 50 || pageSizeRaw === 10 ? pageSizeRaw : 10;
  return { page: Math.floor(page), pageSize };
}

function paginate<T>(
  items: T[],
  rawPagination: unknown,
): { items: T[]; pagination: { currentPage: number; pageSize: 10 | 20 | 50; totalItems: number } } {
  const { page, pageSize } = pageInput(rawPagination);
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    pagination: { currentPage, pageSize, totalItems },
  };
}

async function resolveEnterpriseScope(client: GatewayClient | null): Promise<EnterpriseScope> {
  const cfg = loadConfig();
  const platformAuthConfig = resolvePlatformAuthConfig(cfg.gateway?.auth?.trustedProxy);
  if (!platformAuthConfig) {
    return {
      cfg,
      platformStore: null,
      user: null,
      membership: null,
      tenantId: null,
      tenantName: "企业",
      employeeCount: 0,
    };
  }

  const platformStore = await loadPlatformAuthStore(platformAuthConfig);
  const scope = resolveAuthoritativeEnterpriseScopeForClient({
    store: platformStore,
    client,
    canonicalize: (value) => value?.trim() || null,
  });
  const user =
    scope.kind === "authoritative" || scope.kind === "no-enterprise-membership" ? scope.user : null;
  const membership = scope.kind === "authoritative" ? scope.membership : null;
  const enterprises = Object.values(platformStore.enterprises);
  const fallbackEnterprise = enterprises
    .slice()
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  const enterprise =
    (membership ? platformStore.enterprises[membership.enterpriseId] : undefined) ??
    fallbackEnterprise ??
    null;
  const tenantId = enterprise?.id ?? null;
  const employeeCount = tenantId
    ? Object.values(platformStore.memberships).filter((entry) => entry.enterpriseId === tenantId)
        .length
    : Object.values(platformStore.memberships).length;

  return {
    cfg,
    platformStore,
    user,
    membership,
    tenantId,
    tenantName: enterprise?.name ?? "企业",
    employeeCount,
  };
}

async function prepareRuntimeContext(
  client: GatewayClient | null,
): Promise<RuntimeProjectionContext> {
  const scope = await resolveEnterpriseScope(client);
  await maybeSeedAgentRuntimeFromPlatformState({
    cfg: scope.cfg,
    trustedProxy: scope.cfg.gateway?.auth?.trustedProxy,
  });
  const agents = listAgents({
    lifecycle: null,
    health: null,
    tenantId: scope.tenantId,
    searchQuery: "",
  });
  const agentIds = new Set(agents.map((agent) => agent.runtimeAgentId));
  const bindings = listBindings({
    runtimeAgentId: null,
    capabilityId: null,
    bindingType: null,
    bindingState: null,
    health: null,
  }).filter((binding) => (scope.tenantId ? agentIds.has(binding.runtimeAgentId) : true));

  let seatStore: EnterpriseSeatAssetsStore | null = null;
  try {
    seatStore = await loadEnterpriseSeatAssetsStore(
      await resolveControlPlaneStorePathForClient(client, TENANT_SEAT_ASSETS_FILE),
    );
  } catch {
    seatStore = null;
  }

  return { scope, agents, bindings, seatStore };
}

function parseTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function capabilityIdMatches(entry: GovernanceRegistryEntry, capabilityId: string): boolean {
  return entry.manifest.id === capabilityId || entry.manifest.skillKey === capabilityId;
}

function findRegistryEntry(capabilityId: string): GovernanceRegistryEntry | null {
  return (
    getRegistryEntry(capabilityId) ??
    listRegistry().find((entry) => capabilityIdMatches(entry, capabilityId)) ??
    null
  );
}

function normalizeEnterpriseAssetType(value: unknown): AssetType | null {
  switch (value) {
    case "prompt":
    case "template":
    case "workflow":
    case "knowledge":
    case "agent":
    case "tool":
    case "mcp":
    case "capability":
      return value;
    default:
      return null;
  }
}

function personalAssetType(skillKey: string | undefined): AssetType | null {
  const id = skillKey?.trim();
  if (!id) {
    return null;
  }
  try {
    return getPersonalSkillAssetDetail(id).profile.assetType;
  } catch {
    return null;
  }
}

function personalMcpServerName(skillKey: string | undefined): string | null {
  const id = skillKey?.trim();
  if (!id) {
    return null;
  }
  try {
    return getSkillRuntimeDefinitionForBinding(id).runtimeDefinition.mcpBinding?.serverName ?? null;
  } catch {
    return null;
  }
}

function resolveEnterpriseAssetType(manifest: GovernanceManifest): AssetType {
  return (
    normalizeEnterpriseAssetType(manifest.assetType) ??
    personalAssetType(manifest.skillKey) ??
    "capability"
  );
}

function resolveMcpServerName(manifest: GovernanceManifest, assetType: AssetType): string | null {
  if (assetType !== "mcp") {
    return null;
  }
  const tagged = stringValue(manifest.mcpServerName);
  if (tagged) {
    return tagged;
  }
  return personalMcpServerName(manifest.skillKey);
}

const TENANT_MCP_MOUNT_LIMIT = 500;

function executableMcpSkillId(entry: GovernanceRegistryEntry): string | null {
  const skillId = entry.manifest.skillKey?.trim();
  if (!skillId) {
    return null;
  }
  try {
    const bundle = getSkillRuntimeDefinitionForBinding(skillId);
    if (bundle.profile.assetType !== "mcp" || !bundle.runtimeDefinition.mcpBinding) {
      return null;
    }
    if (!EXECUTABLE_LIFECYCLES.has(bundle.lifecycle)) {
      return null;
    }
    return skillId;
  } catch {
    return null;
  }
}

function mountMcpOnRobotIds(
  skillId: string,
  agentIds: string[],
): {
  skillId: string;
  mountedRobotIds: string[];
  failures: Array<{ robotId: string; reason: string }>;
} {
  const mountedRobotIds: string[] = [];
  const failures: Array<{ robotId: string; reason: string }> = [];
  const unique = [...new Set(agentIds.map((id) => id.trim()).filter(Boolean))].slice(
    0,
    TENANT_MCP_MOUNT_LIMIT,
  );
  for (const robotId of unique) {
    try {
      const mounted = mountSkillAssetOnRobot({ agentId: robotId, skillId });
      if (!mounted.mounted) {
        failures.push({ robotId, reason: "未能挂到该机器人" });
        continue;
      }
      mountedRobotIds.push(robotId);
    } catch {
      failures.push({ robotId, reason: "未能挂到该机器人" });
    }
  }
  return { skillId, mountedRobotIds, failures };
}

function bindTenantCapabilityIfMissing(params: {
  ctx: RuntimeProjectionContext;
  entry: GovernanceRegistryEntry;
  agentIds: string[];
}): void {
  const agents = new Map(params.ctx.agents.map((agent) => [agent.runtimeAgentId, agent] as const));
  const installed = new Set(
    params.ctx.bindings
      .filter(
        (binding) =>
          binding.capabilityId === params.entry.manifest.id &&
          binding.bindingType === "tenant-installed" &&
          binding.bindingState !== "disabled",
      )
      .map((binding) => binding.runtimeAgentId),
  );
  for (const robotId of params.agentIds) {
    const agent = agents.get(robotId);
    if (!agent || installed.has(robotId)) {
      continue;
    }
    upsertBinding({
      runtimeAgentId: agent.runtimeAgentId,
      capabilityId: params.entry.manifest.id,
      capabilityVersion: params.entry.manifest.version,
      bindingType: "tenant-installed",
      loadStrategy: "lazy",
      routingPriority: null,
      policy: null,
      fallbackBindingId: null,
    });
    installed.add(robotId);
  }
}

function robotIdsForPositionPush(
  ctx: RuntimeProjectionContext,
  positionIds: string[],
): { ids: string[]; scope: "tenant" | "positions" } {
  const seats = ctx.seatStore
    ? Object.values(ctx.seatStore.seats).filter((seat) => seat.tenantId === ctx.scope.tenantId)
    : [];
  const requested = new Set(positionIds);
  const coversAll = seats.length > 0 && seats.every((seat) => requested.has(seat.seatId));
  if (coversAll) {
    const ids = new Set<string>();
    for (const agent of ctx.agents) {
      ids.add(agent.runtimeAgentId);
    }
    for (const seat of seats) {
      for (const agentId of seat.defaultAgentAssetIds ?? []) {
        ids.add(agentId);
      }
    }
    return { ids: [...ids], scope: "tenant" };
  }
  const ids = new Set<string>();
  for (const seat of seats) {
    if (!requested.has(seat.seatId)) {
      continue;
    }
    for (const agentId of seat.defaultAgentAssetIds ?? []) {
      ids.add(agentId);
    }
  }
  return { ids: [...ids], scope: "positions" };
}

function mountEnterpriseMcpForRobots(params: {
  ctx: RuntimeProjectionContext;
  entry: GovernanceRegistryEntry;
  agentIds: string[];
  scope: "tenant" | "positions";
}): {
  skillId: string;
  scope: "tenant" | "positions";
  mountedRobotIds: string[];
  failures: Array<{ robotId: string; reason: string }>;
} | null {
  const skillId = executableMcpSkillId(params.entry);
  if (!skillId || params.agentIds.length === 0) {
    return null;
  }
  bindTenantCapabilityIfMissing({
    ctx: params.ctx,
    entry: params.entry,
    agentIds: params.agentIds,
  });
  return { ...mountMcpOnRobotIds(skillId, params.agentIds), scope: params.scope };
}

function unmountEnterpriseMcp(entry: GovernanceRegistryEntry | null, agentId: string): void {
  if (!entry) {
    return;
  }
  const skillId = executableMcpSkillId(entry);
  if (!skillId) {
    return;
  }
  try {
    removeRobotSkillAsset({ agentId, skillId });
  } catch (err) {
    if (!(err instanceof SkillAssetStoreError)) {
      throw err;
    }
  }
  syncSkillExecutionBinding({ agentId, skillId });
}

function lifecycleFromRegistry(entry: GovernanceRegistryEntry): AssetLifecycle {
  switch (entry.lifecycleState) {
    case "draft":
      return "submitted";
    case "review":
      return "reviewing";
    case "approved":
      return "approved";
    case "active":
      return "published";
    case "deprecated":
      return "deprecated";
    case "retired":
      return "retired";
  }
}

function manifestCategory(manifest: GovernanceManifest): string {
  const value = manifest.categoryId;
  return typeof value === "string" ? value : "";
}

function domainFromManifest(manifest: GovernanceManifest): CapabilityDomain {
  const explicitDomain = exactMember(
    manifest.enterpriseDomain ?? manifest.domain,
    CAPABILITY_DOMAINS,
  );
  if (explicitDomain) {
    return explicitDomain;
  }
  const haystack = [
    manifest.name,
    manifest.skillKey,
    manifest.description,
    manifest.descriptionZh ?? "",
    manifest.source.origin,
    manifestCategory(manifest),
  ]
    .join(" ")
    .toLowerCase();

  if (/(sales|crm|lead|opportun|customer|客户|商机|销售|营销)/i.test(haystack)) {
    return "销售";
  }
  if (/(hr|recruit|interview|resume|employee|招聘|面试|简历|人事|员工)/i.test(haystack)) {
    return "HR";
  }
  if (/(support|ticket|complaint|service|客服|工单|投诉|售后)/i.test(haystack)) {
    return "客服";
  }
  if (
    /(finance|invoice|expense|payment|billing|pdf|xlsx|spreadsheet|财务|发票|报销|费用|账单)/i.test(
      haystack,
    )
  ) {
    return "财务";
  }
  if (/(legal|contract|compliance|policy|audit|law|合同|法务|合规|审计|条款)/i.test(haystack)) {
    return "法务";
  }
  return "数据分析";
}

function applicableScopeFromManifest(manifest: GovernanceManifest): ApplicableScope {
  const raw = manifest.applicableScope;
  if (!isRecord(raw)) {
    return { kind: "enterprise" };
  }
  if (raw.kind === "enterprise") {
    return { kind: "enterprise" };
  }
  if (
    (raw.kind === "department" || raw.kind === "group" || raw.kind === "role") &&
    typeof raw.id === "string" &&
    raw.id.trim() &&
    typeof raw.name === "string" &&
    raw.name.trim()
  ) {
    return {
      kind: raw.kind,
      id: raw.id.trim(),
      name: raw.name.trim(),
    };
  }
  return { kind: "enterprise" };
}

function approvalPayloadFromParams(raw: unknown): {
  applicableScope: ApplicableScope;
  domain: CapabilityDomain;
  executionMode?: EnterpriseAssetExecutionMode;
  needsEnterpriseSecrets?: boolean;
  promoteToIncubation?: boolean;
} | null {
  if (!isRecord(raw)) {
    return null;
  }
  const domain = exactMember(raw.domain, CAPABILITY_DOMAINS);
  if (!domain) {
    return null;
  }
  const scope = applicableScopeFromManifest({
    id: "approval-scope",
    kind: "skill",
    version: "1.0.0",
    skillKey: "approval-scope",
    name: "approval-scope",
    description: "approval-scope",
    source: { kind: "system", origin: "approval", trustTier: "system" },
    risk: { level: "low", network: false, filesystem: false, subprocess: false, secrets: false },
    applicableScope: raw.applicableScope,
  });
  return {
    applicableScope: scope,
    domain,
    ...(raw.executionMode === "assistive" ||
    raw.executionMode === "semi_automatic" ||
    raw.executionMode === "automatic"
      ? { executionMode: raw.executionMode }
      : {}),
    ...(typeof raw.needsEnterpriseSecrets === "boolean"
      ? { needsEnterpriseSecrets: raw.needsEnterpriseSecrets }
      : {}),
    ...(typeof raw.promoteToIncubation === "boolean"
      ? { promoteToIncubation: raw.promoteToIncubation }
      : {}),
  };
}

function distributionScopeFromApplicableScope(scope: ApplicableScope): GovernanceDistributionScope {
  switch (scope.kind) {
    case "department":
      return { departmentIds: [scope.id] };
    case "group":
      return { groupIds: [scope.id] };
    case "role":
      return { roleIds: [scope.id] };
    case "enterprise":
    default:
      return {};
  }
}

function descriptionFromManifest(manifest: GovernanceManifest): string {
  return (
    manifest.descriptionZh?.trim() || manifest.description.trim() || `${manifest.name} 企业能力`
  );
}

function bindingsForCapability(
  ctx: RuntimeProjectionContext,
  capabilityId: string,
): RuntimeCapabilityBinding[] {
  return ctx.bindings.filter((binding) => binding.capabilityId === capabilityId);
}

const monthlyExecutions = monthlyExecutionsFromBindings;

function healthFromBindings(
  entry: GovernanceRegistryEntry,
  bindings: RuntimeCapabilityBinding[],
): { status: EnterpriseHealthStatus; noTelemetry: boolean } {
  if (entry.lifecycleState === "retired") {
    return { status: "已不适合继续推广", noTelemetry: false };
  }
  if (bindings.length === 0) {
    return { status: "效果稳定", noTelemetry: true };
  }
  const hasCalls = bindings.some((binding) => binding.invocationMetrics.calls7d > 0);
  const hasBroken = bindings.some(
    (binding) =>
      binding.bindingState === "disabled" ||
      binding.healthStatus === "unhealthy" ||
      binding.healthStatus === "unavailable",
  );
  if (hasBroken) {
    return { status: "建议重新整理", noTelemetry: !hasCalls };
  }
  const hasDegraded = bindings.some(
    (binding) =>
      binding.bindingState === "degraded" ||
      binding.healthStatus === "degraded" ||
      binding.invocationMetrics.successRate7d < 0.9,
  );
  if (hasDegraded) {
    return { status: "偶尔结果不理想", noTelemetry: !hasCalls };
  }
  return { status: "效果稳定", noTelemetry: !hasCalls };
}

function trendFromMonthlyExecutions(value: number): number[] {
  if (value <= 0) {
    return Array.from({ length: 30 }, () => 0);
  }
  const daily = Math.max(1, Math.round(value / 30));
  return Array.from({ length: 30 }, () => daily);
}

function sourceInfo(params: {
  ctx: RuntimeProjectionContext;
  entry: GovernanceRegistryEntry;
  proposal: GovernanceProposal | undefined;
  bindings: RuntimeCapabilityBinding[];
  agents: RuntimeAgent[];
}) {
  const provenance = resolveContributionProvenance({
    ctx: toAttributionContext(params.ctx),
    submittedBy: params.proposal?.submittedBy,
    proposalStableKey: params.entry.manifest.id,
    proposalEnterpriseId: params.proposal?.enterpriseId,
    bindings: params.bindings.map((binding) => ({ runtimeAgentId: binding.runtimeAgentId })),
  });
  const firstBinding = params.bindings[0];
  return {
    employee: { id: provenance.employeeId, name: provenance.employeeName },
    robot: {
      id: firstBinding?.runtimeAgentId ?? "employee-workbench",
      name: provenance.sourceRobotName,
    },
    task: {
      id: params.proposal?.proposalId ?? params.entry.manifest.id,
      summary: descriptionFromManifest(params.entry.manifest),
    },
  };
}

function reviewHistory(proposal: GovernanceProposal | undefined): ReviewRecord[] {
  if (!proposal?.reviewer) {
    return [];
  }
  const result: ReviewResult =
    proposal.status === "approved" ? "通过" : proposal.status === "rejected" ? "拒绝" : "需修改";
  return [
    {
      id: `${proposal.proposalId}:review`,
      reviewerId: proposal.reviewer.id,
      reviewerName: proposal.reviewer.id,
      timestamp: parseTimestamp(proposal.reviewer.at),
      result,
      opinion: proposal.reviewer.note ?? "已完成企业审核",
    },
  ];
}

function contributionHistory(
  entry: GovernanceRegistryEntry,
  proposal: GovernanceProposal | undefined,
  ctx: RuntimeProjectionContext,
): ContributionRecord[] {
  const provenance = resolveContributionProvenance({
    ctx: toAttributionContext(ctx),
    submittedBy: proposal?.submittedBy,
    proposalStableKey: entry.manifest.id,
    proposalEnterpriseId: proposal?.enterpriseId,
    bindings: bindingsForCapability(ctx, entry.manifest.id),
  });
  return [
    {
      id: proposal?.proposalId ?? `${entry.manifest.id}:created`,
      employeeId: provenance.employeeId,
      employeeName: provenance.employeeName,
      timestamp: parseTimestamp(proposal?.submittedAt ?? entry.createdAt),
      type: "初始提交",
      summary: descriptionFromManifest(entry.manifest).slice(0, 200),
    },
  ];
}

function buildAsset(
  entry: GovernanceRegistryEntry,
  ctx: RuntimeProjectionContext,
  proposalByManifestId: Map<string, GovernanceProposal>,
): EnterpriseCapabilityAsset {
  const proposal =
    proposalByManifestId.get(entry.manifest.id) ??
    listProposals().find((item) => item.proposalId === entry.proposalId);
  const bindings = bindingsForCapability(ctx, entry.manifest.id);
  const domain = domainFromManifest(entry.manifest);
  const monthly = monthlyExecutions(bindings);
  const robotCount = uniqueAgentCount(bindings);
  const health = healthFromBindings(entry, bindings);
  const departmentCoverageCount = robotCount > 0 ? Math.max(1, ctx.scope.tenantId ? 1 : 0) : 0;
  const assetType = resolveEnterpriseAssetType(entry.manifest);

  return {
    id: entry.manifest.id,
    name: entry.manifest.name,
    description: descriptionFromManifest(entry.manifest),
    usageScenarios: [domain],
    applicableScope: applicableScopeFromManifest(entry.manifest),
    domain,
    maturity: effectiveMaturity(entry, bindings),
    healthStatus: health.status,
    healthManualLock: false,
    healthNoTelemetry: health.noTelemetry,
    assetType,
    mcpServerName: resolveMcpServerName(entry.manifest, assetType),
    lifecycle: lifecycleFromRegistry(entry),
    valueSummary: {
      monthlyExecutions: monthly,
      departmentCoverageCount,
      reuseGrowthRate30d: 0,
    },
    credibilityIndicators: {
      verifiedDepartments: robotCount > 0 ? [domain] : [],
      productionUsageDays: Math.max(
        0,
        Math.floor((Date.now() - parseTimestamp(entry.createdAt)) / (24 * 60 * 60 * 1000)),
      ),
    },
    reuseData: {
      robotCount,
      employeeCount: robotCount > 0 ? ctx.scope.employeeCount : 0,
      departmentCount: departmentCoverageCount,
      trend30Days: trendFromMonthlyExecutions(monthly),
      growthPercentage: 0,
    },
    source: sourceInfo({ ctx, entry, proposal, bindings, agents: ctx.agents }),
    contributionHistory: contributionHistory(entry, proposal, ctx),
    reviewHistory: reviewHistory(proposal),
    avatar: null,
    createdAt: parseTimestamp(entry.createdAt),
    updatedAt: parseTimestamp(entry.updatedAt),
  };
}

function toListItem(asset: EnterpriseCapabilityAsset): EnterpriseAssetListItem {
  return {
    id: asset.id,
    name: asset.name,
    description: asset.description,
    usageScenarios: asset.usageScenarios,
    applicableScope: asset.applicableScope,
    domain: asset.domain,
    maturity: asset.maturity,
    healthStatus: asset.healthStatus,
    assetType: asset.assetType,
    mcpServerName: asset.mcpServerName,
    lifecycle: asset.lifecycle,
    valueSummary: asset.valueSummary,
    reuseData: asset.reuseData,
    sourceEmployeeName: asset.source.employee.name,
    avatar: asset.avatar,
  };
}

function proposalMap(): Map<string, GovernanceProposal> {
  return new Map(
    listProposals()
      .filter((proposal) => proposal.resolvedManifestId || proposal.manifest.id)
      .map((proposal) => [proposal.resolvedManifestId ?? proposal.manifest.id, proposal] as const),
  );
}

function allAssets(ctx: RuntimeProjectionContext): EnterpriseCapabilityAsset[] {
  const proposals = proposalMap();
  return listRegistry()
    .filter((entry) => entry.lifecycleState !== "retired")
    .map((entry) => buildAsset(entry, ctx, proposals));
}

function filtersFromParams(params: Record<string, unknown>) {
  const raw = isRecord(params.filters) ? params.filters : {};
  return {
    searchQuery: stringValue(raw.searchQuery) ?? "",
    usageScenario: stringValue(raw.usageScenario),
    applicableTarget: stringValue(raw.applicableTarget),
    domain: exactMember(raw.domain, CAPABILITY_DOMAINS),
    maturity: exactMember(raw.maturity, MATURITY_ORDER),
    // Trimmed free string. Unknown values match no asset. Coercing them to
    // null would skip the filter instead.
    healthStatus: stringValue(raw.healthStatus),
    onlyInstallable: raw.onlyInstallable === true,
  };
}

function catalogFromParams(params: Record<string, unknown>): EnterpriseAssetCatalog {
  const raw = isRecord(params.filters) ? params.filters : {};
  return params.catalog === "mcp" || raw.catalog === "mcp" ? "mcp" : "skills";
}

function sidebarFromParams(params: Record<string, unknown>): SidebarEntry {
  return params.sidebarEntry === "my-installed" || params.sidebarEntry === "my-contributed"
    ? params.sidebarEntry
    : "all";
}

function sortingFromParams(params: Record<string, unknown>): {
  field: AssetSortField;
  direction: SortDirection;
} {
  const raw = isRecord(params.sorting) ? params.sorting : {};
  const field: AssetSortField =
    raw.field === "reuseValue" || raw.field === "createdAt" || raw.field === "maturity"
      ? raw.field
      : "maturity";
  const direction: SortDirection = raw.direction === "asc" ? "asc" : "desc";
  return { field, direction };
}

function sortAssets(
  items: EnterpriseCapabilityAsset[],
  sorting: { field: AssetSortField; direction: SortDirection },
): EnterpriseCapabilityAsset[] {
  const sign = sorting.direction === "asc" ? 1 : -1;
  return items.slice().toSorted((a, b) => {
    if (sorting.field === "createdAt") {
      return (a.createdAt - b.createdAt) * sign;
    }
    if (sorting.field === "reuseValue") {
      return (a.valueSummary.monthlyExecutions - b.valueSummary.monthlyExecutions) * sign;
    }
    return (MATURITY_ORDER.indexOf(a.maturity) - MATURITY_ORDER.indexOf(b.maturity)) * sign;
  });
}

function filterAssets(
  assets: EnterpriseCapabilityAsset[],
  ctx: RuntimeProjectionContext,
  params: Record<string, unknown>,
): EnterpriseCapabilityAsset[] {
  const filters = filtersFromParams(params);
  const catalog = catalogFromParams(params);
  const sidebarEntry = sidebarFromParams(params);
  const q = filters.searchQuery.trim().toLowerCase();
  const installedCapabilityIds = new Set(ctx.bindings.map((binding) => binding.capabilityId));

  return assets.filter((asset) => {
    if (q) {
      const haystack = [asset.name, asset.description, asset.id, asset.mcpServerName ?? ""]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) {
        return false;
      }
    }
    if (filters.domain && asset.domain !== filters.domain) {
      return false;
    }
    if (filters.maturity && asset.maturity !== filters.maturity) {
      return false;
    }
    if (filters.healthStatus && asset.healthStatus !== filters.healthStatus) {
      return false;
    }
    if (filters.usageScenario && !asset.usageScenarios.includes(filters.usageScenario)) {
      return false;
    }
    if (filters.applicableTarget && filters.applicableTarget !== "企业") {
      return false;
    }
    if (
      filters.onlyInstallable &&
      asset.lifecycle !== "published" &&
      asset.lifecycle !== "approved"
    ) {
      return false;
    }
    if (sidebarEntry === "all" && hideRegistryDraftFromPublicCatalog(asset.lifecycle)) {
      return false;
    }
    if (sidebarEntry === "my-installed" && !installedCapabilityIds.has(asset.id)) {
      return false;
    }
    if (sidebarEntry === "my-contributed" && asset.source.employee.name === "平台") {
      return false;
    }
    if (catalog === "mcp") {
      return asset.assetType === "mcp";
    }
    return asset.assetType !== "mcp";
  });
}

function statusFromProposalStatus(status: GovernanceProposal["status"]): ReviewStatus {
  switch (status) {
    case "proposed":
      return "待审核";
    case "under_review":
      return "审核中";
    case "approved":
      return "已通过";
    case "rejected":
      return "已拒绝";
    case "withdrawn":
      return "需修改";
  }
}

function proposalStatusFromReviewResult(
  result: ReviewResult,
): Exclude<GovernanceProposal["status"], "approved"> {
  if (result === "拒绝") {
    return "rejected";
  }
  if (result === "需修改") {
    return "withdrawn";
  }
  return "under_review";
}

function proposalToContributionRecord(ctx: RuntimeProjectionContext, proposal: GovernanceProposal) {
  const provenance = resolveContributionProvenance({
    ctx: toAttributionContext(ctx),
    submittedBy: proposal.submittedBy,
    proposalStableKey: proposal.manifest.id,
    proposalEnterpriseId: proposal.enterpriseId,
    bindings: bindingsForCapability(ctx, proposal.manifest.id),
  });
  return {
    contribution: {
      id: proposal.proposalId,
      employeeId: provenance.employeeId,
      employeeName: provenance.employeeName,
      timestamp: parseTimestamp(proposal.submittedAt),
      type: "初始提交" as const,
      summary: descriptionFromManifest(proposal.manifest).slice(0, 200),
    },
    capabilityId: proposal.resolvedManifestId ?? proposal.manifest.id,
    capabilityName: proposal.manifest.name,
    sourceRobotName: provenance.sourceRobotName,
    reviewStatus: statusFromProposalStatus(proposal.status),
  };
}

function contributionRecordSortField(raw: unknown): ContributionRecordsSortField {
  return raw === "employeeName" || raw === "reviewStatus" ? raw : "submittedAt";
}

function sortDirection(raw: unknown, fallback: SortDirection): SortDirection {
  return raw === "asc" || raw === "desc" ? raw : fallback;
}

function reviewStatusRank(status: ReviewStatus): number {
  switch (status) {
    case "待审核":
      return 1;
    case "审核中":
      return 2;
    case "需修改":
      return 3;
    case "已拒绝":
      return 4;
    case "已通过":
      return 5;
  }
}

function compareContributionRecords(
  a: ReturnType<typeof proposalToContributionRecord>,
  b: ReturnType<typeof proposalToContributionRecord>,
  field: ContributionRecordsSortField,
): number {
  switch (field) {
    case "employeeName":
      return (
        a.contribution.employeeName.localeCompare(b.contribution.employeeName, "zh-CN") ||
        b.contribution.timestamp - a.contribution.timestamp
      );
    case "reviewStatus":
      return (
        reviewStatusRank(a.reviewStatus) - reviewStatusRank(b.reviewStatus) ||
        b.contribution.timestamp - a.contribution.timestamp
      );
    case "submittedAt":
      return a.contribution.timestamp - b.contribution.timestamp;
  }
}

function contributionRecordsSortingFromParams(params: Record<string, unknown>): {
  field: ContributionRecordsSortField;
  direction: SortDirection;
} {
  const raw = isRecord(params.sorting) ? params.sorting : {};
  const field = contributionRecordSortField(raw.field);
  const direction = sortDirection(raw.direction, field === "submittedAt" ? "desc" : "asc");
  return { field, direction };
}

function installStatusFromBinding(binding: RuntimeCapabilityBinding): InstallStatus {
  if (binding.bindingState === "disabled") {
    return "已暂停";
  }
  if (binding.healthStatus === "degraded" || binding.bindingState === "degraded") {
    return "待更新";
  }
  return "正常运行";
}

function installSourceFromBinding(binding: RuntimeCapabilityBinding): InstallSource {
  return binding.bindingType === "tenant-installed" ? "员工自主安装" : "管理员推送";
}

function findSeatForAgent(
  ctx: RuntimeProjectionContext,
  runtimeAgentId: string,
): {
  seat: EnterprisePositionSeat;
  binding: EnterpriseSeatBinding | null;
  user: PlatformAuthUser | null;
} | null {
  if (!ctx.seatStore || !ctx.scope.tenantId) {
    return null;
  }
  const seat =
    Object.values(ctx.seatStore.seats).find(
      (entry) =>
        entry.tenantId === ctx.scope.tenantId &&
        entry.defaultAgentAssetIds.includes(runtimeAgentId),
    ) ?? null;
  if (!seat) {
    return null;
  }
  const binding =
    Object.values(ctx.seatStore.bindings).find(
      (entry) =>
        entry.tenantId === ctx.scope.tenantId &&
        entry.seatId === seat.seatId &&
        entry.bindingStatus === "active",
    ) ?? null;
  const user =
    binding && ctx.scope.platformStore
      ? (ctx.scope.platformStore.users[binding.employeeId] ?? null)
      : null;
  return { seat, binding, user };
}

function resolveDisplayRobotNameForSeat(params: {
  ctx: RuntimeProjectionContext;
  runtimeRobotName: string;
  seat: EnterprisePositionSeat | null;
}): string {
  if (!params.seat) {
    return params.runtimeRobotName;
  }
  const cfgAgents = listAgentsForGateway(params.ctx.scope.cfg).agents;
  const candidate = (params.seat.defaultAgentAssetIds ?? [])
    .map((agentId) => cfgAgents.find((entry) => entry.id === agentId) ?? null)
    .find((entry) => Boolean(entry?.identity?.name?.trim() || entry?.name?.trim()));
  return candidate?.identity?.name?.trim() || candidate?.name?.trim() || params.runtimeRobotName;
}

function relationFromBinding(params: {
  binding: RuntimeCapabilityBinding;
  entry: GovernanceRegistryEntry | null;
  agent: RuntimeAgent | null;
  ctx: RuntimeProjectionContext;
}): InstallRelationEnhanced {
  const source = installSourceFromBinding(params.binding);
  const seatInfo = findSeatForAgent(params.ctx, params.binding.runtimeAgentId);
  const runtimeRobotName = params.agent?.name ?? params.binding.runtimeAgentId;
  return {
    id: params.binding.bindingId,
    capabilityId: params.binding.capabilityId,
    capabilityName: params.entry?.manifest.name ?? params.binding.capabilityId,
    robotId: params.binding.runtimeAgentId,
    robotName: resolveDisplayRobotNameForSeat({
      ctx: params.ctx,
      runtimeRobotName,
      seat: seatInfo?.seat ?? null,
    }),
    robotOwnerEmployeeId: seatInfo?.user?.id ?? seatInfo?.binding?.employeeId ?? null,
    robotOwnerEmployeeName: seatInfo?.user?.displayName ?? null,
    robotOwnerEmployeeEmail: seatInfo?.user?.email ?? null,
    robotPositionId: seatInfo?.seat.seatId ?? null,
    robotPositionTitle: seatInfo?.seat.title ?? null,
    robotTeamLabel: seatInfo?.seat.teamLabel ?? null,
    robotRoleCode: seatInfo?.seat.roleCode ?? null,
    installedAt: params.binding.createdAt,
    source,
    status: installStatusFromBinding(params.binding),
    businessSource: params.entry?.manifest.source.kind === "personal" ? "员工沉淀" : "企业发布",
    usageStats: {
      executions30d: params.binding.invocationMetrics.calls7d * 4,
      successRate: params.binding.invocationMetrics.successRate7d,
    },
  };
}

function listInstallRelations(ctx: RuntimeProjectionContext): InstallRelationEnhanced[] {
  const agents = new Map(ctx.agents.map((agent) => [agent.runtimeAgentId, agent] as const));
  return ctx.bindings
    .filter((binding) => binding.bindingState !== "disabled")
    .map((binding) =>
      relationFromBinding({
        binding,
        entry: findRegistryEntry(binding.capabilityId),
        agent: agents.get(binding.runtimeAgentId) ?? null,
        ctx,
      }),
    )
    .toSorted((a, b) => b.installedAt - a.installedAt);
}

function reviewQueueItem(proposal: GovernanceProposal, ctx: RuntimeProjectionContext) {
  const bindings = bindingsForCapability(ctx, proposal.manifest.id);
  const usageCount = monthlyExecutions(bindings);
  const status = proposal.status === "under_review" ? "审核中" : "待审核";
  const assetType = resolveEnterpriseAssetType(proposal.manifest);
  const provenance = resolveContributionProvenance({
    ctx: toAttributionContext(ctx),
    submittedBy: proposal.submittedBy,
    proposalStableKey: proposal.manifest.id,
    proposalEnterpriseId: proposal.enterpriseId,
    bindings,
  });
  return {
    item: {
      id: proposal.proposalId,
      capabilityId: proposal.resolvedManifestId ?? proposal.manifest.id,
      capabilityName: proposal.manifest.name,
      capabilitySummary: descriptionFromManifest(proposal.manifest),
      usageScenarios: [domainFromManifest(proposal.manifest)],
      sourceEmployee: { id: provenance.employeeId, name: provenance.employeeName },
      sourceRobot: { id: "resolved-source-robot", name: provenance.sourceRobotName },
      sourceTaskSummary: descriptionFromManifest(proposal.manifest),
      usageCount,
      robotCount: uniqueAgentCount(bindings),
      lastUsedAt:
        bindings.length > 0 ? Math.max(...bindings.map((binding) => binding.updatedAt)) : null,
      submittedAt: parseTimestamp(proposal.submittedAt),
      status,
      assetType,
      mcpServerName: resolveMcpServerName(proposal.manifest, assetType),
      enterpriseAssetPackage: enterpriseAssetPackageFromManifest(proposal.manifest),
    },
    assessment: {
      security: {
        sensitiveInfo: proposal.manifest.risk.secrets,
        dangerousOps: proposal.manifest.risk.subprocess,
        externalCalls: proposal.manifest.risk.network,
        permissionRisk: proposal.manifest.risk.filesystem || proposal.manifest.risk.secrets,
      },
      quality: {
        successRate30d:
          bindings.length === 0
            ? 100
            : Math.round(
                (bindings.reduce(
                  (sum, binding) => sum + binding.invocationMetrics.successRate7d,
                  0,
                ) /
                  bindings.length) *
                  100,
              ),
        robotCount: uniqueAgentCount(bindings),
        employeeCount: ctx.scope.employeeCount,
        namingCompliant: proposal.manifest.name.trim().length >= 2,
      },
    },
  };
}

export const enterpriseCapabilityHandlers: GatewayRequestHandlers = {
  "enterprise-capability.stats": async ({ client, respond }) => {
    try {
      const ctx = await prepareRuntimeContext(client);
      const entries = listRegistry().filter((entry) => entry.lifecycleState !== "retired");
      const monthlyUsageCount = ctx.bindings.reduce(
        (sum, binding) => sum + binding.invocationMetrics.calls7d * 4,
        0,
      );
      const telemetryCount = listTelemetry({
        runtimeAgentId: null,
        capabilityId: null,
        window: "30d",
      }).length;
      respond(true, {
        stats: {
          totalCapabilities: entries.length,
          publishedCapabilities: entries.filter((entry) => entry.lifecycleState === "active")
            .length,
          coveredEmployees: ctx.scope.employeeCount,
          coveredRobots: ctx.agents.length,
          monthlyUsageCount,
          changes: {
            totalCapabilities: { value: 0, type: "absolute" },
            publishedCapabilities: { value: 0, type: "absolute" },
            coveredEmployees: { value: 0, type: "percentage" },
            coveredRobots: { value: 0, type: "absolute" },
            monthlyUsageCount: { value: telemetryCount > 0 ? 0 : 0, type: "percentage" },
          },
          updatedAt: Date.now(),
        },
      });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "enterprise-capability.domain-distribution": async ({ client, params, respond }) => {
    try {
      const ctx = await prepareRuntimeContext(client);
      const domainFilter = exactMember(params.domain, CAPABILITY_DOMAINS);
      const assets = allAssets(ctx).filter((asset) =>
        domainFilter ? asset.domain === domainFilter : true,
      );
      const total = Math.max(1, assets.length);
      const domains = (domainFilter ? [domainFilter] : CAPABILITY_DOMAINS).map((domain) => {
        const domainAssets = assets.filter((asset) => asset.domain === domain);
        return {
          domain,
          capabilityCount: domainAssets.length,
          representativeCapabilities: domainAssets.slice(0, 3).map((asset) => asset.name),
          coverageRate: Math.round((domainAssets.length / total) * 100),
        };
      });
      respond(true, { domains });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "enterprise-capability.list": async ({ client, params, respond }) => {
    try {
      const ctx = await prepareRuntimeContext(client);
      const filtered = filterAssets(allAssets(ctx), ctx, params);
      const sorted = sortAssets(filtered, sortingFromParams(params));
      const page = paginate(sorted.map(toListItem), params.pagination);
      respond(true, page);
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "enterprise-capability.detail": async ({ client, params, respond }) => {
    const capabilityId = stringParam(params, "capabilityId");
    if (!capabilityId) {
      respondInvalid(respond, "capabilityId is required");
      return;
    }
    try {
      const ctx = await prepareRuntimeContext(client);
      const entry = findRegistryEntry(capabilityId);
      if (!entry) {
        respondInvalid(respond, `Unknown capability: ${capabilityId}`);
        return;
      }
      respond(true, { capability: buildAsset(entry, ctx, proposalMap()) });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "enterprise-capability.review-queue": async ({ client, params, respond }) => {
    try {
      const ctx = await prepareRuntimeContext(client);
      const filters = isRecord(params.filters) ? params.filters : {};
      const status =
        filters.status === "审核中" || filters.status === "待审核" ? filters.status : null;
      const searchQuery = stringValue(filters.searchQuery)?.toLowerCase() ?? "";
      const tenantId = authoritativeEnterpriseId(ctx.scope);
      const items = listProposalsForAuthoritativeTenant(tenantId)
        .filter((proposal) => proposal.status === "proposed" || proposal.status === "under_review")
        .filter((proposal) =>
          status ? reviewQueueItem(proposal, ctx).item.status === status : true,
        )
        .filter((proposal) => {
          if (!searchQuery) {
            return true;
          }
          return [proposal.manifest.name, proposal.manifest.description, proposal.manifest.skillKey]
            .join(" ")
            .toLowerCase()
            .includes(searchQuery);
        })
        .toSorted((a, b) => parseTimestamp(a.submittedAt) - parseTimestamp(b.submittedAt))
        .map((proposal) => reviewQueueItem(proposal, ctx));
      respond(true, paginate(items, params.pagination));
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "enterprise-capability.review": async ({ client, params, respond }) => {
    const reviewTaskId = stringParam(params, "reviewTaskId");
    const result = oneOf(params.result, ["通过", "拒绝", "需修改"] as const);
    const opinion = stringParam(params, "opinion") ?? "";
    if (!reviewTaskId || !result) {
      respondInvalid(respond, "reviewTaskId and valid result are required");
      return;
    }
    const currentProposal = getProposal(reviewTaskId);
    if (!currentProposal) {
      respondInvalid(respond, `Unknown review task: ${reviewTaskId}`);
      return;
    }
    try {
      const ctx = await prepareRuntimeContext(client);
      const tenantId = authoritativeEnterpriseId(ctx.scope);
      if (!tenantId || currentProposal.enterpriseId !== tenantId) {
        respondInvalid(respond, "proposal is outside the authenticated enterprise");
        return;
      }
    } catch (err) {
      respondUnavailable(respond, err);
      return;
    }
    const approval = result === "通过" ? approvalPayloadFromParams(params.approval) : null;
    if (result === "通过" && !approval) {
      respondInvalid(respond, "approval with applicableScope and domain is required");
      return;
    }
    const reviewerId = "enterprise-admin";
    const basePackage = currentProposal?.manifest
      ? (enterpriseAssetPackageFromManifest(currentProposal.manifest) ??
        defaultEnterpriseAssetPackageFromManifest(currentProposal.manifest))
      : null;
    const proposal =
      result === "通过"
        ? (approveAndRegister(reviewTaskId, reviewerId, opinion, {
            manifestPatch: {
              applicableScope: approval!.applicableScope,
              enterpriseDomain: approval!.domain,
              domain: approval!.domain,
              ...(basePackage
                ? {
                    enterpriseAssetPackage: {
                      ...basePackage,
                      executionMode:
                        approval!.executionMode ?? basePackage.executionMode ?? "assistive",
                      needsEnterpriseSecrets:
                        typeof approval!.needsEnterpriseSecrets === "boolean"
                          ? approval!.needsEnterpriseSecrets
                          : basePackage.needsEnterpriseSecrets,
                      promotionIntent: approval!.promoteToIncubation
                        ? "platform_candidate"
                        : basePackage.promotionIntent,
                    },
                  }
                : {}),
            },
            distributionScope: distributionScopeFromApplicableScope(approval!.applicableScope),
          })?.proposal ?? null)
        : updateProposalStatus(reviewTaskId, proposalStatusFromReviewResult(result), {
            id: reviewerId,
            note: opinion,
          });
    if (!proposal) {
      respondInvalid(respond, `Unknown review task: ${reviewTaskId}`);
      return;
    }
    if (result === "通过" && approval) {
      rematerializeApprovedEnterpriseSkill(proposal.manifest.skillKey, approval.applicableScope);
    }
    const record: ReviewRecord = {
      id: `${reviewTaskId}:review:${Date.now()}`,
      reviewerId,
      reviewerName: "企业管理员",
      timestamp: Date.now(),
      result,
      opinion,
    };
    respond(true, {
      reviewTaskId,
      capabilityId: proposal.resolvedManifestId ?? proposal.manifest.id,
      record,
    });
  },

  "enterprise-capability.install-to-robots": async ({ client, params, respond }) => {
    const capabilityId = stringParam(params, "capabilityId");
    const robotIds = Array.isArray(params.robotIds)
      ? params.robotIds.map(stringValue).filter((value): value is string => Boolean(value))
      : [];
    if (!capabilityId) {
      respondInvalid(respond, "capabilityId is required");
      return;
    }
    if (robotIds.length === 0 || robotIds.length > 20) {
      respondInvalid(respond, "robotIds must contain 1 to 20 robot ids");
      return;
    }
    try {
      const ctx = await prepareRuntimeContext(client);
      const entry = findRegistryEntry(capabilityId);
      if (!entry) {
        respondInvalid(respond, `Unknown capability: ${capabilityId}`);
        return;
      }
      const agents = new Map(ctx.agents.map((agent) => [agent.runtimeAgentId, agent] as const));
      const mcpSkillId = executableMcpSkillId(entry);
      const existingTenantInstalled = new Set(
        ctx.bindings
          .filter(
            (binding) =>
              binding.capabilityId === entry.manifest.id &&
              binding.bindingType === "tenant-installed" &&
              binding.bindingState !== "disabled",
          )
          .map((binding) => binding.runtimeAgentId),
      );
      const successfulRobotIds: string[] = [];
      const failures: { robotId: string; reason: string }[] = [];
      const createdRelations: InstallRelation[] = [];
      for (const robotId of robotIds) {
        const agent = agents.get(robotId);
        if (!agent) {
          failures.push({ robotId, reason: "机器人不可用" });
          continue;
        }
        if (existingTenantInstalled.has(robotId)) {
          failures.push({ robotId, reason: "已安装" });
          continue;
        }
        const binding = upsertBinding({
          runtimeAgentId: agent.runtimeAgentId,
          capabilityId: entry.manifest.id,
          capabilityVersion: entry.manifest.version,
          bindingType: "tenant-installed",
          loadStrategy: "lazy",
          routingPriority: null,
          policy: null,
          fallbackBindingId: null,
        });
        if (mcpSkillId) {
          const mounted = mountMcpOnRobotIds(mcpSkillId, [agent.runtimeAgentId]);
          if (!mounted.mountedRobotIds.includes(agent.runtimeAgentId)) {
            deleteBinding(binding.bindingId);
            failures.push({ robotId, reason: "未能挂到该机器人" });
            continue;
          }
        }
        successfulRobotIds.push(agent.runtimeAgentId);
        createdRelations.push(relationFromBinding({ binding, entry, agent, ctx }));
      }
      respond(true, {
        capabilityId: entry.manifest.id,
        successfulRobotIds,
        failures,
        createdRelations,
      });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "enterprise-capability.push-to-positions": async ({ client, params, respond }) => {
    const capabilityId = stringParam(params, "capabilityId");
    const positionIds = Array.isArray(params.positionIds)
      ? params.positionIds.map(stringValue).filter((value): value is string => Boolean(value))
      : [];
    const uniquePositionIds = [...new Set(positionIds)];
    if (!capabilityId) {
      respondInvalid(respond, "capabilityId is required");
      return;
    }
    if (uniquePositionIds.length === 0 || uniquePositionIds.length > 500) {
      respondInvalid(respond, "positionIds must contain 1 to 500 position ids");
      return;
    }
    try {
      const ctx = await prepareRuntimeContext(client);
      const entry = findRegistryEntry(capabilityId);
      if (!entry) {
        respondInvalid(respond, `Unknown capability: ${capabilityId}`);
        return;
      }
      if (!ctx.scope.tenantId || !ctx.seatStore) {
        respondUnavailable(respond, new Error("Enterprise position store is unavailable"));
        return;
      }
      const nowIso = new Date().toISOString();
      const successfulPositionIds: string[] = [];
      const failures: { positionId: string; reason: string }[] = [];
      const createdGrants: Array<{
        grantId: string;
        capabilityId: string;
        positionId: string;
        positionTitle: string;
        teamLabel: string | null;
        employeeName: string | null;
        roleCode: string | null;
      }> = [];

      for (const positionId of uniquePositionIds) {
        const seat = ctx.seatStore.seats[positionId];
        if (!seat || seat.tenantId !== ctx.scope.tenantId) {
          failures.push({ positionId, reason: "岗位不可用" });
          continue;
        }
        const hadExistingPolicy = Object.values(ctx.seatStore.accessPolicies).some(
          (policy) =>
            policy.tenantId === ctx.scope.tenantId &&
            policy.subjectType === "seat" &&
            policy.subjectId === seat.seatId &&
            policy.resourceType === "capability" &&
            policy.resourceId === entry.manifest.id &&
            policy.action === "execute" &&
            !policy.revokedAt,
        );
        if (hadExistingPolicy) {
          failures.push({ positionId, reason: "已推送" });
          continue;
        }
        const policy = grantEnterpriseAccessPolicy({
          store: ctx.seatStore,
          tenantId: ctx.scope.tenantId,
          subjectType: "seat",
          subjectId: seat.seatId,
          resourceType: "capability",
          resourceId: entry.manifest.id,
          action: "execute",
          nowIso,
        });
        const user = seat.currentEmployeeId
          ? (ctx.scope.platformStore?.users[seat.currentEmployeeId] ?? null)
          : null;
        successfulPositionIds.push(seat.seatId);
        createdGrants.push({
          grantId: policy.policyId,
          capabilityId: entry.manifest.id,
          positionId: seat.seatId,
          positionTitle: seat.title,
          teamLabel: seat.teamLabel ?? null,
          employeeName: user?.displayName ?? user?.email ?? null,
          roleCode: seat.roleCode ?? null,
        });
      }
      if (createdGrants.length > 0) {
        await saveEnterpriseSeatAssetsStore(undefined, ctx.seatStore);
      }
      const targets = robotIdsForPositionPush(ctx, uniquePositionIds);
      const mcpMount = mountEnterpriseMcpForRobots({
        ctx,
        entry,
        agentIds: targets.ids,
        scope: targets.scope,
      });
      respond(true, {
        capabilityId: entry.manifest.id,
        successfulPositionIds,
        failures,
        createdGrants,
        mcpMount,
      });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "enterprise-capability.uninstall": ({ params, respond }) => {
    const installRelationId = stringParam(params, "installRelationId");
    if (!installRelationId) {
      respondInvalid(respond, "installRelationId is required");
      return;
    }
    try {
      const binding = getBinding(installRelationId);
      if (!binding) {
        respond(true, {
          installRelationId,
          capabilityId: "",
          robotId: "",
          succeeded: false,
        });
        return;
      }
      unmountEnterpriseMcp(findRegistryEntry(binding.capabilityId), binding.runtimeAgentId);
      const succeeded = deleteBinding(installRelationId);
      respond(true, {
        installRelationId,
        capabilityId: binding.capabilityId,
        robotId: binding.runtimeAgentId,
        succeeded,
      });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "enterprise-capability.install-management": async ({ client, params, respond }) => {
    try {
      const ctx = await prepareRuntimeContext(client);
      const filters = isRecord(params.filters) ? params.filters : {};
      const capabilityQuery = stringValue(filters.capabilityNameQuery)?.toLowerCase() ?? "";
      const robotQuery = stringValue(filters.robotNameQuery)?.toLowerCase() ?? "";
      const source =
        filters.source === "管理员推送" || filters.source === "员工自主安装"
          ? filters.source
          : null;
      const status =
        filters.status === "正常运行" || filters.status === "已暂停" || filters.status === "待更新"
          ? filters.status
          : null;
      const installedAfter =
        typeof filters.installedAfter === "number" ? filters.installedAfter : null;
      const installedBefore =
        typeof filters.installedBefore === "number" ? filters.installedBefore : null;
      const allRelations = listInstallRelations(ctx);
      const filtered = allRelations.filter((relation) => {
        if (capabilityQuery && !relation.capabilityName.toLowerCase().includes(capabilityQuery)) {
          return false;
        }
        if (robotQuery && !relation.robotName.toLowerCase().includes(robotQuery)) {
          return false;
        }
        if (source && relation.source !== source) {
          return false;
        }
        if (status && relation.status !== status) {
          return false;
        }
        if (installedAfter !== null && relation.installedAt < installedAfter) {
          return false;
        }
        if (installedBefore !== null && relation.installedAt > installedBefore) {
          return false;
        }
        return true;
      });
      const page = paginate(filtered, params.pagination);
      respond(true, {
        ...page,
        summary: {
          adminPushCount: allRelations.filter((relation) => relation.source === "管理员推送")
            .length,
          employeeSelfInstallCount: allRelations.filter(
            (relation) => relation.source === "员工自主安装",
          ).length,
          coveredRobotCount: new Set(allRelations.map((relation) => relation.robotId)).size,
          coveredCapabilityCount: new Set(allRelations.map((relation) => relation.capabilityId))
            .size,
          coveredPositionCount: new Set(
            allRelations
              .map((relation) => relation.robotPositionId)
              .filter((positionId): positionId is string => Boolean(positionId)),
          ).size,
        },
      });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "enterprise-capability.contribution-records": async ({ client, params, respond }) => {
    try {
      const ctx = await prepareRuntimeContext(client);
      const filters = isRecord(params.filters) ? params.filters : {};
      const employeeId = stringValue(filters.employeeId);
      const reviewStatus = stringValue(filters.reviewStatus) as ReviewStatus | null;
      const submittedAfter =
        typeof filters.submittedAfter === "number" ? filters.submittedAfter : null;
      const submittedBefore =
        typeof filters.submittedBefore === "number" ? filters.submittedBefore : null;
      const sorting = contributionRecordsSortingFromParams(params);
      const tenantId = authoritativeEnterpriseId(ctx.scope);
      const items = listProposalsForAuthoritativeTenant(tenantId)
        .map((proposal) => proposalToContributionRecord(ctx, proposal))
        .filter((entry) => (employeeId ? entry.contribution.employeeId === employeeId : true))
        .filter((entry) => (reviewStatus ? entry.reviewStatus === reviewStatus : true))
        .filter((entry) =>
          submittedAfter !== null ? entry.contribution.timestamp >= submittedAfter : true,
        )
        .filter((entry) =>
          submittedBefore !== null ? entry.contribution.timestamp <= submittedBefore : true,
        )
        .toSorted((a, b) => {
          const result = compareContributionRecords(a, b, sorting.field);
          return result * (sorting.direction === "asc" ? 1 : -1);
        });
      respond(true, paginate(items, params.pagination));
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "enterprise-capability.contribution-performance": async ({ client, params, respond }) => {
    try {
      const ctx = await prepareRuntimeContext(client);
      const filters = isRecord(params.filters) ? params.filters : {};
      const sortField =
        filters.sortField === "approvalRate" || filters.sortField === "totalReuseRobots"
          ? filters.sortField
          : "totalContributions";
      const sortDirection: SortDirection = filters.sortDirection === "asc" ? "asc" : "desc";
      const byEmployee = new Map<
        string,
        {
          employeeName: string;
          department: string;
          total: number;
          approved: number;
          reuseRobots: number;
        }
      >();
      const tenantId = authoritativeEnterpriseId(ctx.scope);
      for (const proposal of listProposalsForAuthoritativeTenant(tenantId)) {
        const provenance = resolveContributionProvenance({
          ctx: toAttributionContext(ctx),
          submittedBy: proposal.submittedBy,
          proposalStableKey: proposal.manifest.id,
          proposalEnterpriseId: proposal.enterpriseId,
          bindings: bindingsForCapability(ctx, proposal.manifest.id).map((binding) => ({
            runtimeAgentId: binding.runtimeAgentId,
          })),
        });
        // 「员工贡献绩效」只统计真实员工贡献，平台/系统导入不计入排行。
        if (!provenance.isEmployee) {
          continue;
        }
        const current = byEmployee.get(provenance.employeeId) ?? {
          employeeName: provenance.employeeName,
          department: provenance.department,
          total: 0,
          approved: 0,
          reuseRobots: 0,
        };
        const entry = findRegistryEntry(proposal.resolvedManifestId ?? proposal.manifest.id);
        const bindings = entry ? bindingsForCapability(ctx, entry.manifest.id) : [];
        current.total += 1;
        current.approved += proposal.status === "approved" ? 1 : 0;
        current.reuseRobots += uniqueAgentCount(bindings);
        byEmployee.set(provenance.employeeId, current);
      }
      const items = [...byEmployee.entries()].map(([employeeId, entry]) => ({
        employeeId,
        employeeName: entry.employeeName,
        department: entry.department,
        totalContributions: entry.total,
        approvedCount: entry.approved,
        approvalRate: entry.total === 0 ? 0 : Math.round((entry.approved / entry.total) * 100),
        averageMaturityLevel: 1,
        totalReuseRobots: entry.reuseRobots,
        totalReuseEmployees: entry.reuseRobots > 0 ? ctx.scope.employeeCount : 0,
        averageSuccessRate: 100,
      }));
      const sorted = items.toSorted((a, b) => {
        const left = a[sortField];
        const right = b[sortField];
        return (left - right) * (sortDirection === "asc" ? 1 : -1);
      });
      respond(true, { items: sorted });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "enterprise-capability.certify": async ({ client, params, respond }) => {
    const capabilityId = stringParam(params, "capabilityId");
    if (!capabilityId) {
      respondInvalid(respond, "capabilityId is required");
      return;
    }
    try {
      const ctx = await prepareRuntimeContext(client);
      const entry = findRegistryEntry(capabilityId);
      if (!entry) {
        respondInvalid(respond, `Unknown capability: ${capabilityId}`);
        return;
      }
      // Gate: certification requires the usage-computed maturity to reach at
      // least 稳定使用 (Req 5.9). Certification is an explicit admin decision.
      const autoMaturity = maturityFromUsage(bindingsForCapability(ctx, entry.manifest.id));
      const allowed = MATURITY_ORDER.indexOf(autoMaturity) >= MATURITY_ORDER.indexOf("稳定使用");
      if (!allowed) {
        respond(true, {
          capabilityId: entry.manifest.id,
          succeeded: false,
          rejectionReason: "该能力仍处于初步形成阶段，暂不满足企业认证条件",
        });
        return;
      }
      // Persist the grant on the canonical registry entry so it floors maturity
      // across list/detail/domain projections and unlocks promote-to-standard.
      updateRegistryMaturityGrant(
        entry.manifest.id,
        "企业认证",
        stringValue(client?.user) || undefined,
      );
      respond(true, {
        capabilityId: entry.manifest.id,
        succeeded: true,
        rejectionReason: null,
      });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "enterprise-capability.promote-to-standard": async ({ client, params, respond }) => {
    const capabilityId = stringParam(params, "capabilityId");
    if (!capabilityId) {
      respondInvalid(respond, "capabilityId is required");
      return;
    }
    try {
      const ctx = await prepareRuntimeContext(client);
      const entry = findRegistryEntry(capabilityId);
      if (!entry) {
        respondInvalid(respond, `Unknown capability: ${capabilityId}`);
        return;
      }
      // Gate: 企业标准 requires the capability to already be at 企业认证 (Req 5.10),
      // honoring a prior admin certification grant, not just raw usage.
      const maturity = effectiveMaturity(entry, bindingsForCapability(ctx, entry.manifest.id));
      const allowed = MATURITY_ORDER.indexOf(maturity) >= MATURITY_ORDER.indexOf("企业认证");
      if (!allowed) {
        respond(true, {
          capabilityId: entry.manifest.id,
          succeeded: false,
          rejectionReason: "该能力尚未达到企业认证级别，不能晋升为企业标准",
        });
        return;
      }
      updateRegistryMaturityGrant(
        entry.manifest.id,
        "企业标准",
        stringValue(client?.user) || undefined,
      );
      respond(true, {
        capabilityId: entry.manifest.id,
        succeeded: true,
        rejectionReason: null,
      });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  // Enterprise-scoped read of this enterprise's own platform submissions.
  // This is the single source of truth for the incubation center's "上报记录"
  // tracker: it reads the canonical capability-install-governance store (the
  // same store the sanitization-gated submit-to-platform flow writes to), so
  // the tracker reflects real platform review/publish state.
  "enterprise-capability.platform-submissions": async ({ client, respond }) => {
    try {
      const enterpriseId = await resolveEnterpriseIdFromClient(client);
      const reports = listEnterpriseSubmissions({ enterpriseId })
        .map((submission) => ({
          reportId: submission.submissionId,
          capabilityId: submission.capabilityId,
          capabilityName: submission.capabilityName,
          uploadedAt: submission.submittedAt,
          proposalStatus: mapSubmissionStatusToProposalStatus(submission.status),
        }))
        .toSorted((a, b) => b.uploadedAt - a.uploadedAt);
      respond(true, { reports });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "enterprise-capability.update-health-status": ({ params, respond }) => {
    const capabilityId = stringParam(params, "capabilityId");
    const newStatus = oneOf(params.newStatus, [
      "效果稳定",
      "偶尔结果不理想",
      "建议重新整理",
      "已不适合继续推广",
    ] as const);
    if (!capabilityId || !newStatus) {
      respondInvalid(respond, "capabilityId and valid newStatus are required");
      return;
    }
    respond(true, {
      capabilityId,
      healthStatus: newStatus,
      healthManualLock: params.manualLock === true,
      updatedAt: Date.now(),
    });
  },

  "enterprise-capability.governance-events": ({ params, respond }) => {
    const tenantId = stringParam(params, "tenantId");
    const eventType = oneOf(params.eventType, [
      "install",
      "uninstall",
      "restrict",
      "disable",
      "review-escalation",
      "external-filing",
    ] as const);

    const events = listGovernanceEvents({
      enterpriseId: tenantId ?? undefined,
      type: eventType ?? undefined,
    });

    respond(
      true,
      {
        tenantId: tenantId ?? "default",
        events: events.map((e) => ({
          eventId: e.eventId,
          timestamp: e.timestamp,
          type: e.type,
          capabilityId: e.capabilityId,
          capabilityName: e.capabilityName,
          actorId: e.actorId,
          actorType: e.actorType,
          targetRobotId: e.targetRobotId,
          detail: e.detail,
          severity: e.severity,
        })),
        total: events.length,
      },
      undefined,
    );
  },

  "enterprise-capability.governance-action": ({ params, respond, client }) => {
    const capabilityId = stringParam(params, "capabilityId");
    const action = oneOf(params.action, [
      "restrict",
      "disable",
      "require-review",
      "restore",
      "approve",
    ] as const);
    if (!capabilityId || !action) {
      respondInvalid(respond, "capabilityId and valid action are required");
      return;
    }

    const newGovernanceState =
      action === "restrict"
        ? "restricted"
        : action === "disable"
          ? "disabled"
          : action === "require-review"
            ? "review-required"
            : "none";

    recordGovernanceEvent({
      type:
        action === "restrict" ? "restrict" : action === "disable" ? "disable" : "review-escalation",
      capabilityId,
      capabilityName: stringParam(params, "capabilityName") ?? capabilityId,
      actorId: typeof client?.user === "string" ? client.user : "admin",
      actorType: "admin",
      detail: `管理员执行 ${action} 操作，状态变为 ${newGovernanceState}`,
      severity: action === "disable" ? "high" : "medium",
    });

    respond(
      true,
      {
        capabilityId,
        action,
        succeeded: true,
        previousGovernanceState: "none",
        newGovernanceState,
        appliedAt: Date.now(),
      },
      undefined,
    );
  },

  "enterprise-capability.external-filings": ({ params, respond }) => {
    const tenantId = stringParam(params, "tenantId");
    const stubFilings = [
      {
        filingId: "filing-001",
        capabilityId: "cap-002",
        capabilityName: "Markdown 文档处理",
        source: "external-local",
        filedAt: Date.now() - 86400000,
        filedBy: "employee-2",
        riskLevel: "medium",
        scanStatus: "completed",
        findings: 2,
        enterpriseAcknowledged: false,
      },
      {
        filingId: "filing-002",
        capabilityId: "cap-external-001",
        capabilityName: "本地脚本工具",
        source: "external-local",
        filedAt: Date.now() - 172800000,
        filedBy: "employee-3",
        riskLevel: "high",
        scanStatus: "completed",
        findings: 5,
        enterpriseAcknowledged: true,
      },
    ];

    respond(
      true,
      { tenantId: tenantId ?? "default", filings: stubFilings, total: stubFilings.length },
      undefined,
    );
  },

  "enterprise-capability.sanitization-preview": async ({ params, respond, client }) => {
    const capabilityId = stringParam(params, "capabilityId");
    if (!capabilityId) {
      respondInvalid(respond, "capabilityId is required");
      return;
    }

    const enterpriseId = await resolveEnterpriseIdFromClient(client);
    const session = ensureSanitizationSession(capabilityId, enterpriseId);

    // Seed findings if this is the first preview for this capability
    // P0-5 完整脱敏：包含 originalValue 用于 replacement 追踪
    if (session.findings.length === 0) {
      const seededFindings = [
        {
          id: "f-1",
          category: "company-name",
          severity: "medium" as const,
          description: "发现公司名 'OpenBot Inc.'",
          count: 3,
          resolved: false,
          originalValue: "OpenBot Inc.",
        },
        {
          id: "f-2",
          category: "customer-data",
          severity: "high" as const,
          description: "发现客户邮箱地址",
          count: 2,
          resolved: false,
          originalValue: "customer@example.com",
        },
        {
          id: "f-3",
          category: "internal-endpoint",
          severity: "medium" as const,
          description: "发现内部 API 端点",
          count: 1,
          resolved: false,
          originalValue: "https://internal-api.company.local",
        },
        {
          id: "f-4",
          category: "secret",
          severity: "critical" as const,
          description: "发现潜在凭证字符串",
          count: 1,
          resolved: false,
          originalValue: "sk-abc123xyz789",
        },
        {
          id: "f-5",
          category: "internal-kb",
          severity: "low" as const,
          description: "发现内部知识库引用",
          count: 4,
          resolved: false,
          originalValue: "KB-2024-001",
        },
        {
          id: "f-6",
          category: "employee-label",
          severity: "low" as const,
          description: "发现员工/部门标签",
          count: 5,
          resolved: false,
          originalValue: "Engineering Team",
        },
      ];
      updateSanitizationSession(capabilityId, {
        status: "in-progress",
        findings: seededFindings,
        overallCompleteness: 0.0,
      });
    }

    const refreshed = getSanitizationSession(capabilityId)!;
    const unresolved = refreshed.findings.filter((f) => !f.resolved);

    respond(
      true,
      {
        capabilityId,
        overallCompleteness: refreshed.overallCompleteness,
        totalFindings: refreshed.findings.length,
        unresolvedFindings: unresolved.length,
        findings: refreshed.findings,
        canProceed: unresolved.length === 0,
        message:
          unresolved.length === 0
            ? "脱敏检查已通过，可提交平台"
            : `脱敏检查发现 ${unresolved.length} 个未处理问题，需完成后方可提交平台`,
      },
      undefined,
    );
  },

  "enterprise-capability.sanitization-confirm": ({ params, respond, client }) => {
    const capabilityId = stringParam(params, "capabilityId");
    const replacements = params.replacements;
    if (!capabilityId) {
      respondInvalid(respond, "capabilityId is required");
      return;
    }

    const session = getSanitizationSession(capabilityId);
    if (!session) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "sanitization session not found"),
      );
      return;
    }

    // P0-5 完整脱敏：逐项处理 resolution，必须提供每个 finding 的 replacement
    const now = Date.now();
    const user = typeof client?.user === "string" ? client.user : "unknown";

    // Validate resolutions input
    const inputResolutions = Array.isArray(replacements) ? replacements : [];
    const unresolvedFindings = session.findings.filter((f) => !f.resolved);

    if (unresolvedFindings.length === 0) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "没有待处理的 finding，无需确认"),
      );
      return;
    }

    // 逐项校验：每个未处理的 finding 必须有对应的 resolution
    type ResolutionInput = {
      findingId: string;
      replacement: string;
      replacementType: "redact" | "tokenize" | "hash" | "substitute";
    };
    const resolutionMap = new Map(
      (inputResolutions as ResolutionInput[]).map((r) => [r.findingId, r]),
    );

    for (const finding of unresolvedFindings) {
      if (!resolutionMap.has(finding.id)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `finding ${finding.id} (${finding.category}) 缺少 resolution，必须逐项处理`,
          ),
        );
        return;
      }
      const res = resolutionMap.get(finding.id)!;
      if (!res.replacement || !res.replacementType) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `finding ${finding.id} 必须提供 replacement 和 replacementType`,
          ),
        );
        return;
      }
    }

    // 逐项应用 resolution
    const resolvedFindings = session.findings.map((f) => {
      if (f.resolved) {
        return f;
      }
      const res = resolutionMap.get(f.id);
      return {
        ...f,
        resolved: true,
        resolvedAt: now,
        resolvedBy: user,
        replacement: res?.replacement,
        replacementType: res?.replacementType,
      };
    });

    // 创建 sanitized package provenance（含完整 resolution 记录）
    const resolutions = resolvedFindings
      .filter((f) => f.resolved && f.resolvedAt === now)
      .map((f) => ({
        findingId: f.id,
        category: f.category,
        severity: f.severity,
        originalValue: f.originalValue,
        replacement: f.replacement ?? "[REDACTED]",
        replacementType: f.replacementType ?? "redact",
        operator: f.resolvedBy ?? user,
        time: f.resolvedAt ?? now,
      }));

    // 计算 artifact hash（模拟内容哈希）
    const manifestContent = JSON.stringify(resolutions);
    const contentHash = `sha256-${Buffer.from(manifestContent).toString("base64").slice(0, 16)}`;
    const manifestHash = `sha256-${Buffer.from(manifestContent).toString("base64").slice(16, 32)}`;

    const sanitizedPackage = createSanitizedPackage({
      capabilityId,
      enterpriseId: session.enterpriseId,
      createdAt: now,
      createdBy: user,
      resolutions,
      artifact: {
        contentHash,
        sizeBytes: manifestContent.length,
        manifestHash,
      },
    });

    updateSanitizationSession(capabilityId, {
      status: "complete",
      findings: resolvedFindings,
      overallCompleteness: 1.0,
      completedAt: now,
      confirmedBy: user,
      sanitizedPackageId: sanitizedPackage.packageId,
    });

    respond(
      true,
      {
        capabilityId,
        sanitizationState: "complete",
        sanitizedPackageId: sanitizedPackage.packageId,
        appliedReplacements: resolutions.length,
        artifactHash: contentHash,
        verifiedAt: now,
        canSubmitToPlatform: true,
      },
      undefined,
    );
  },

  "enterprise-capability.submit-to-platform": ({ params, respond }) => {
    const capabilityId = stringParam(params, "capabilityId");
    if (!capabilityId) {
      respondInvalid(respond, "capabilityId is required");
      return;
    }

    // P0-5 完整脱敏：enforce sanitization gate + sanitized package provenance
    const gate = canSubmitToPlatform(capabilityId);
    if (!gate.allowed) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `cannot submit to platform: ${gate.reason ?? "sanitization incomplete"}`,
        ),
      );
      return;
    }

    const session = getSanitizationSession(capabilityId);
    const submissionId = `sub-${Date.now()}-${capabilityId}`;

    // 必须携带并校验 sanitized package provenance
    if (!gate.sanitizedPackageId) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "sanitized package provenance required for platform submission",
        ),
      );
      return;
    }

    const sanitizedPackage = getSanitizedPackage(gate.sanitizedPackageId);
    if (!sanitizedPackage) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "sanitized package not found, cannot submit"),
      );
      return;
    }

    // P0-6: write to shared submission store with sanitized package provenance
    createEnterpriseSubmission({
      submissionId,
      capabilityId,
      capabilityName: stringParam(params, "capabilityName") ?? capabilityId,
      enterpriseId: session?.enterpriseId ?? "default",
      enterpriseName: stringParam(params, "enterpriseName") ?? "未知企业",
      sanitized: true,
      sanitizationFindings: session?.findings.length ?? 0,
      sourceProvenance: "enterprise-sanitization",
      sanitizedPackageId: gate.sanitizedPackageId,
    });

    respond(
      true,
      {
        capabilityId,
        submissionId,
        sanitizedPackageId: gate.sanitizedPackageId,
        artifactHash: sanitizedPackage.artifact.contentHash,
        status: "submitted",
        submittedAt: Date.now(),
        message: "企业资产已提交至平台审核队列（含脱敏产物元数据）",
      },
      undefined,
    );
  },
};
