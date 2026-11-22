import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../utils.js";
import { evaluateAssetContentReadiness } from "./asset-admission.js";
import { inferOrganizableAssetClassification } from "./asset-classification.js";
import { isRecord, numberValue } from "./records.js";
import {
  defaultProvidersForVerbs,
  packSkillIsNative,
  packSkillRequiresSecret,
  resolveVerbsForSkill,
  sanitizeCapabilityProviders,
  sanitizeCapabilityVerbs,
  type SkillCapabilityProvider,
} from "./skill-capability-contract.js";

export type { SkillCapabilityProvider, SkillProviderKind } from "./skill-capability-contract.js";

export type SkillVisibility = "private" | "group" | "enterprise";
export type AssetType =
  | "prompt"
  | "template"
  | "workflow"
  | "knowledge"
  | "agent"
  | "capability"
  | "tool"
  | "mcp";

export type ToolAssetBinding = {
  toolIds: string[];
};

export type McpAssetBinding = {
  serverName: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  toolAllowlist?: string[];
};
export type SkillLifecycleState =
  | "draft"
  | "private"
  | "reviewing"
  | "approved"
  | "published"
  | "deprecated"
  | "rejected"
  | "retired";
export type SkillHealthStatus = "healthy" | "warning" | "broken";

export type EmployeeSkillProfile = {
  id: string;
  name: string;
  summary: string;
  assetType: AssetType;
  usageExamples: string[];
  inputDescription: string;
  outputDescription: string;
  tags: string[];
  category: string;
  avatar: string;
  visibility: SkillVisibility;
};

export type SkillRuntimeDefinition = {
  prompts: string[];
  workflow: unknown;
  tools: string[];
  memoryStrategy: unknown;
  routingHints: unknown;
  dependencies: string[];
  modelPreferences: unknown;
  executionPolicies: unknown;
  /** Capability verbs this skill can fulfill (runtime-only; stripped from employee UI). */
  capabilities: string[];
  /** How each verb is fulfilled. Never shown on employee surfaces. */
  providers: SkillCapabilityProvider[];
  /** First-class Tool asset: catalog ids to grant on install. */
  toolBinding?: ToolAssetBinding;
  /** First-class MCP asset: server bind used by mcporter on install. */
  mcpBinding?: McpAssetBinding;
};

export type SkillHealth = {
  status: SkillHealthStatus;
  successRate: number;
  avgLatency: number;
  lastVerifiedAt: number | null;
  failureReasons: string[];
};

/**
 * Reference to the real first-class artifact behind a captured deliverable (a produced workspace
 * file or a published link), so 成果中心 can open the faithful preview instead of re-rendering the
 * captured text. Set at capture time from an explicit <<DELIVERABLE file=/url=>> declaration.
 */
export type DeliverableArtifactRef = {
  previewKind: "file" | "published";
  /** Bare filename for a produced workspace file (previewKind "file"). */
  filename?: string;
  /** Published/external URL (previewKind "published"). */
  url?: string;
  /** Best-effort mime type for the file. */
  mimeType?: string;
};

export type EmployeeSkillSummary = {
  id: string;
  profile: EmployeeSkillProfile;
  lifecycle: SkillLifecycleState;
  health: SkillHealth;
  sourceRobot: { id: string; name: string } | null;
  /** Trusted owner user id for personal knowledge authorization. */
  ownerUserId?: string | null;
  usageCount: number;
  lastUsedAt: number | null;
  version: string;
  versionCount: number;
  sourceLineageId?: string;
  deliverableArtifact?: DeliverableArtifactRef;
};

export type EmployeeSkillVersionSummary = {
  version: string;
  createdAt: number;
  summary: string;
  profile: EmployeeSkillProfile;
  /** Pinned runtime definition for this version (required for real pin/rollback). */
  runtimeDefinition?: SkillRuntimeDefinition;
};

export type SkillVersionDiff = {
  skillId: string;
  fromVersion: string;
  toVersion: string;
  changedFields: Array<{
    field: keyof EmployeeSkillProfile;
    before: unknown;
    after: unknown;
  }>;
};

export type SkillRollback = {
  skillId: string;
  rolledBackFrom: string;
  rolledBackTo: string;
  newVersion: string;
  summary: string;
};

export type SkillMigration = {
  skillId: string;
  targetVersion: string;
  impact: RuntimeDependencyImpact;
  planSteps: string[];
};

export type SkillHealthRepairSuggestion = {
  skillId: string;
  healthStatus: SkillHealthStatus;
  suggestions: string[];
};

export type SkillDependencySummaryResult = {
  skillId: string;
  installedRobotCount: number;
  sharedGroupCount: number;
  dependentSkillCount: number;
  enterpriseConsumerCount: number;
  hasAnyConsumer: boolean;
};

export type ApplicableReviewScope =
  | { kind: "enterprise" }
  | { kind: "department"; id: string; name: string }
  | { kind: "group"; id: string; name: string }
  | { kind: "role"; id: string; name: string };

export type SkillReviewRecord = {
  skillId: string;
  submittedAt: number;
  reviewer: { id: string; name: string } | null;
  applicableScope: ApplicableReviewScope;
  security: unknown;
  quality: unknown;
  decision: "approved" | "rejected" | null;
  rejectionReason: string | null;
  improvementSuggestions: string[];
};

export type SkillAutofillSuggestion = {
  category?: string;
  tags?: string[];
  inputDescription?: string;
  outputDescription?: string;
  usageExamples?: string[];
  avatar?: string;
  summaryRefinement?: string;
};

export type SkillAutofillJob = {
  jobId: string;
  skillId: string;
  status: "pending" | "running" | "succeeded" | "empty" | "failed";
  suggestion: SkillAutofillSuggestion | null;
  enhancementSources: Array<{
    similarSkillId: string;
    similarSkillName: string;
    sharedTags: string[];
    sharedCategory: string | null;
  }>;
  updatedAt: number;
};

export type SkillClassificationSuggestion = {
  skillId: string;
  suggestedCategory: string | null;
  suggestedTags: string[];
};

export type SkillRecommendationEntry = {
  skillId: string;
  name: string;
  summary: string;
  category: string;
  tags: string[];
  source: "enterprise" | "shared";
  sourceLabel: string;
  health: SkillHealthStatus;
  usageCount: number;
};

export type SkillDependencyGraph = {
  installedRobots: Array<{ agentId: string; name: string }>;
  sharedGroups: Array<{ groupId: string; name: string }>;
  dependentSkills: Array<{ skillId: string; name: string }>;
  enterpriseConsumers: Array<{ consumerId: string; name: string; type: string }>;
};

export type EmployeeSkillDetail = EmployeeSkillSummary & {
  dependencyGraph: SkillDependencyGraph;
  versions: EmployeeSkillVersionSummary[];
};

export type RuntimeDependencyImpact = {
  skillId: string;
  skillName: string;
  installedRobotCount: number;
  sharedGroupCount: number;
  dependentSkillCount: number;
  enterpriseConsumerCount: number;
  requiresMigrationPlan: boolean;
  impactSummary: string;
};

export type RuntimeDependencyTopologyNode = {
  id: string;
  label: string;
  type: "skill" | "robot" | "group" | "consumer";
};

export type RuntimeDependencyTopologyEdge = {
  from: string;
  to: string;
  type: "installed_on" | "shared_to" | "depends_on" | "consumed_by";
};

export type RuntimeDependencyTopology = {
  nodes: RuntimeDependencyTopologyNode[];
  edges: RuntimeDependencyTopologyEdge[];
  impacts: RuntimeDependencyImpact[];
};

export type RobotSkillEntry = EmployeeSkillSummary & {
  enabled: boolean;
  installedVersion: string;
  latestVersion: string | null;
  /** Relation-level last invocation timestamp (authoritative for this robot). */
  lastInvokedAt: number | null;
};

export type SkillShareAttribution = {
  shareId: string;
  skillId: string;
  groupId: string;
  sharedBy: {
    userId: string | null;
    agentId: string | null;
    displayName: string;
  };
  sharedAt: number;
};

type StoredSkill = Omit<EmployeeSkillSummary, "versionCount"> & {
  runtimeDefinition: SkillRuntimeDefinition;
  version: string;
  versions: EmployeeSkillVersionSummary[];
  sharedGroups: Array<{ groupId: string; name: string }>;
  enterpriseConsumers: Array<{ consumerId: string; name: string; type: string }>;
  createdAt: number;
  updatedAt: number;
};

type RobotSkillRelation = {
  id: string;
  agentId: string;
  skillId: string;
  enabled: boolean;
  installedVersion: string;
  lastInvokedAt: number | null;
  usageCount: number;
  createdAt: number;
};

type SkillAssetStore = {
  skills: StoredSkill[];
  robotRelations: RobotSkillRelation[];
  reviews?: Record<string, SkillReviewRecord>;
  shareAttributions?: SkillShareAttribution[];
};

export type ExtractedSkillPreview = {
  suggestedName: string;
  suggestedSummary: string;
  confidence: number;
  detectedAt: number;
  profile: EmployeeSkillProfile;
};

export type SaveSkillAssetParams = {
  sourceAgentId?: string | null;
  contextId?: string | null;
  lifecycle?: SkillLifecycleState;
  skillId?: string;
  /** Owning user for personal knowledge ACL. */
  ownerUserId?: string | null;
  profile: unknown;
  /** Host-only pattern publisher hint; concrete tool/MCP bindings still take precedence. */
  classificationPolicy?: "approved-pattern-capability";
  runtimeDefinition?: unknown;
  targetGroupId?: string | null;
  enterpriseConsumers?: unknown;
  /** Optional reference to the real produced artifact (file/published link) behind this deliverable. */
  deliverableArtifact?: DeliverableArtifactRef;
  /**
   * When false, do not create an enabled robot relation even if sourceAgentId is set.
   * Required for draft/candidate publish so skills cannot enter runtime without install.
   * Default: true when sourceAgentId is present.
   */
  autoInstallEnabled?: boolean;
};

/** Normalize a deliverable artifact ref for storage (basename-only file, http(s)-only url). */
function sanitizeDeliverableArtifactRef(value: unknown): DeliverableArtifactRef | null {
  if (!isRecord(value)) {
    return null;
  }
  const previewKind = stringValue(value.previewKind);
  if (previewKind === "file") {
    const raw = stringValue(value.filename);
    const filename = raw.split(/[\\/]/).pop()?.trim().slice(0, 200) ?? "";
    if (!filename || filename === "." || filename === "..") {
      return null;
    }
    const mimeType = stringValue(value.mimeType);
    return { previewKind: "file", filename, ...(mimeType ? { mimeType } : {}) };
  }
  if (previewKind === "published") {
    const url = stringValue(value.url);
    if (!/^https?:\/\//i.test(url)) {
      return null;
    }
    return { previewKind: "published", url: url.slice(0, 2000) };
  }
  return null;
}

export class SkillAssetStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillAssetStoreError";
  }
}

const STORE_DIR = path.join(CONFIG_DIR, "skill-assets");
const STORE_FILE = path.join(STORE_DIR, "store.json");
const HEALTH_WINDOWS_FILE = path.join(STORE_DIR, "health-windows.json");

/** Mutation hook for execution-binding sync (registered by skill-execution-binding; avoids import cycles). */
export type SkillRelationMutationEvent = {
  op: "install" | "toggle" | "upgrade" | "remove" | "save" | "delete";
  agentId: string;
  skillId: string;
};

/**
 * Projection signal returned by a relation hook.
 * Kept structural here so the store does not import the execution-binding module.
 */
export type SkillRelationProjectionSignal = {
  action: "materialised" | "removed" | "skipped";
  reason?: string;
  skillName?: string;
  materialisedPath?: string;
};

export type SkillRelationMutationHookResult = {
  projection?: SkillRelationProjectionSignal;
};

type SkillRelationMutationHook = (
  event: SkillRelationMutationEvent,
) => SkillRelationMutationHookResult | void;

const skillRelationMutationHooks: SkillRelationMutationHook[] = [];
const SKILL_RELATION_REPORTS = Symbol("openbot.skillRelationMutationReports");

export function registerSkillRelationMutationHook(hook: SkillRelationMutationHook): () => void {
  skillRelationMutationHooks.push(hook);
  return () => {
    const index = skillRelationMutationHooks.indexOf(hook);
    if (index >= 0) {
      skillRelationMutationHooks.splice(index, 1);
    }
  };
}

function emitSkillRelationMutation(
  event: SkillRelationMutationEvent,
): SkillRelationMutationHookResult[] {
  const reports: SkillRelationMutationHookResult[] = [];
  for (const hook of skillRelationMutationHooks) {
    try {
      const result = hook(event);
      if (result && typeof result === "object") {
        reports.push(result);
      }
    } catch {
      // hooks must not break asset mutations; keep the failure readable
      reports.push({ projection: { action: "skipped", reason: "hook-error" } });
    }
  }
  return reports;
}

function stampRelationReports<T extends object>(
  value: T,
  reports: SkillRelationMutationHookResult[],
): T {
  Object.defineProperty(value, SKILL_RELATION_REPORTS, {
    value: reports,
    enumerable: false,
    configurable: true,
  });
  return value;
}

export function readSkillRelationMutationReports(value: object): SkillRelationMutationHookResult[] {
  const reports = (value as { [SKILL_RELATION_REPORTS]?: SkillRelationMutationHookResult[] })[
    SKILL_RELATION_REPORTS
  ];
  return Array.isArray(reports) ? reports : [];
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => stringValue(entry)).filter(Boolean);
}

function numberOrNull(value: unknown): number | null {
  return numberValue(value);
}

function normalizeVisibility(value: unknown): SkillVisibility {
  if (value === "group" || value === "enterprise") {
    return value;
  }
  return "private";
}

function normalizeAssetType(value: unknown): AssetType {
  switch (value) {
    case "prompt":
    case "template":
    case "workflow":
    case "knowledge":
    case "agent":
    case "tool":
    case "mcp":
      return value;
    default:
      return "capability";
  }
}

function normalizeLifecycle(value: unknown): SkillLifecycleState {
  if (
    value === "private" ||
    value === "reviewing" ||
    value === "approved" ||
    value === "published" ||
    value === "deprecated" ||
    value === "rejected" ||
    value === "retired"
  ) {
    return value;
  }
  return "draft";
}

function normalizeHealthStatus(value: unknown): SkillHealthStatus {
  if (value === "warning" || value === "broken") {
    return value;
  }
  return "healthy";
}

function boundedRate(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }
  return Math.max(0, Math.min(1, value));
}

function createSkillId(): string {
  return `skill_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function createRelationId(agentId: string, skillId: string): string {
  return `rel_${agentId}_${skillId}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function defaultHealth(): SkillHealth {
  return {
    status: "healthy",
    successRate: 1,
    avgLatency: 0,
    lastVerifiedAt: null,
    failureReasons: [],
  };
}

function sanitizeProfile(value: unknown, fallbackId = ""): EmployeeSkillProfile {
  const record = isRecord(value) ? value : {};
  return {
    id: stringValue(record.id, fallbackId),
    name: stringValue(record.name),
    summary: stringValue(record.summary),
    assetType: normalizeAssetType(record.assetType),
    usageExamples: stringArray(record.usageExamples),
    inputDescription: stringValue(record.inputDescription),
    outputDescription: stringValue(record.outputDescription),
    tags: stringArray(record.tags),
    category: stringValue(record.category),
    avatar: stringValue(record.avatar),
    visibility: normalizeVisibility(record.visibility),
  };
}

function completeRuntimeContract(
  runtime: SkillRuntimeDefinition,
  profile: { id: string; name: string; summary: string; tags: string[] },
): SkillRuntimeDefinition {
  const capabilities =
    runtime.capabilities.length > 0
      ? runtime.capabilities
      : resolveVerbsForSkill({
          skillId: profile.id,
          skillKey: profile.id,
          name: profile.name,
          summary: profile.summary,
          tags: profile.tags,
        });
  const providers =
    runtime.providers.length > 0
      ? runtime.providers
      : defaultProvidersForVerbs(capabilities, {
          secrets: packSkillRequiresSecret(profile.id),
          native: packSkillIsNative(profile.id),
        });
  return { ...runtime, capabilities, providers };
}

function sanitizeToolAssetBinding(value: unknown): ToolAssetBinding | undefined {
  const record = isRecord(value) ? value : {};
  const toolIds = stringArray(record.toolIds);
  return toolIds.length > 0 ? { toolIds } : undefined;
}

function sanitizeMcpAssetBinding(value: unknown): McpAssetBinding | undefined {
  const record = isRecord(value) ? value : null;
  if (!record) {
    return undefined;
  }
  const serverName = stringValue(record.serverName).trim();
  const command = stringValue(record.command).trim();
  const url = stringValue(record.url).trim();
  if (!serverName || (!command && !url)) {
    return undefined;
  }
  const args = stringArray(record.args);
  const toolAllowlist = stringArray(record.toolAllowlist);
  return {
    serverName,
    transport: url && !command ? "http" : "stdio",
    ...(command ? { command } : {}),
    ...(args.length > 0 ? { args } : {}),
    ...(url ? { url } : {}),
    ...(toolAllowlist.length > 0 ? { toolAllowlist } : {}),
  };
}

function sanitizeRuntimeDefinition(
  value: unknown,
  contextId?: string | null,
): SkillRuntimeDefinition {
  const record = isRecord(value) ? value : {};
  const prompts = stringArray(record.prompts);
  const toolBinding = sanitizeToolAssetBinding(record.toolBinding);
  const declaredTools = stringArray(record.tools);
  const tools = [...new Set([...declaredTools, ...(toolBinding?.toolIds ?? [])])];
  return {
    prompts:
      prompts.length > 0
        ? prompts
        : [`Reusable pattern extracted from ${contextId ?? "current context"}.`],
    workflow: record.workflow ?? null,
    tools,
    memoryStrategy: record.memoryStrategy ?? null,
    routingHints: record.routingHints ?? null,
    dependencies: stringArray(record.dependencies),
    modelPreferences: record.modelPreferences ?? null,
    executionPolicies: record.executionPolicies ?? null,
    capabilities: sanitizeCapabilityVerbs(record.capabilities),
    providers: sanitizeCapabilityProviders(record.providers),
    ...(toolBinding ? { toolBinding } : {}),
    ...(sanitizeMcpAssetBinding(record.mcpBinding)
      ? { mcpBinding: sanitizeMcpAssetBinding(record.mcpBinding) }
      : {}),
  };
}

function sanitizeHealth(value: unknown): SkillHealth {
  const record = isRecord(value) ? value : {};
  return {
    status: normalizeHealthStatus(record.status),
    successRate: boundedRate(record.successRate),
    avgLatency: Math.max(0, numberOrNull(record.avgLatency) ?? 0),
    lastVerifiedAt: numberOrNull(record.lastVerifiedAt),
    failureReasons: stringArray(record.failureReasons),
  };
}

function repairSuggestionForReason(reason: string): string | null {
  const normalized = reason.toLocaleLowerCase();
  if (
    normalized.includes("input") ||
    normalized.includes("format") ||
    normalized.includes("输入")
  ) {
    return "建议更换输入方式";
  }
  if (
    normalized.includes("scenario") ||
    normalized.includes("ambiguous") ||
    normalized.includes("场景")
  ) {
    return "建议调整使用场景";
  }
  if (
    normalized.includes("timeout") ||
    normalized.includes("latency") ||
    normalized.includes("busy") ||
    normalized.includes("超时")
  ) {
    return "建议稍后整理";
  }
  return null;
}

function uniqueSuggestions(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function repairSuggestionsForHealth(health: SkillHealth): string[] {
  if (health.status === "healthy") {
    return [];
  }
  const suggestions = uniqueSuggestions(
    health.failureReasons
      .map(repairSuggestionForReason)
      .filter((entry): entry is string => !!entry),
  );
  if (suggestions.length > 0) {
    return suggestions;
  }
  return health.status === "broken" ? ["建议稍后整理"] : ["建议调整使用场景"];
}

function sanitizeVersion(value: unknown): EmployeeSkillVersionSummary | null {
  const record = isRecord(value) ? value : null;
  if (!record) {
    return null;
  }
  const version = stringValue(record.version);
  if (!version) {
    return null;
  }
  return {
    version,
    createdAt: numberOrNull(record.createdAt) ?? 0,
    summary: stringValue(record.summary),
    profile: sanitizeProfile(record.profile),
    ...(record.runtimeDefinition !== undefined
      ? { runtimeDefinition: sanitizeRuntimeDefinition(record.runtimeDefinition) }
      : {}),
  };
}

function sanitizeSharedGroups(value: unknown): Array<{ groupId: string; name: string }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }
      const groupId = stringValue(entry.groupId);
      const name = stringValue(entry.name, groupId);
      return groupId ? { groupId, name } : null;
    })
    .filter((entry): entry is { groupId: string; name: string } => entry !== null);
}

function sanitizeEnterpriseConsumers(
  value: unknown,
): Array<{ consumerId: string; name: string; type: string }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }
      const consumerId = stringValue(entry.consumerId);
      const name = stringValue(entry.name, consumerId);
      const type = stringValue(entry.type, "enterprise");
      return consumerId ? { consumerId, name, type } : null;
    })
    .filter((entry): entry is { consumerId: string; name: string; type: string } => entry !== null);
}

function sanitizeStoredSkill(value: unknown): StoredSkill | null {
  const record = isRecord(value) ? value : null;
  if (!record) {
    return null;
  }
  const id = stringValue(record.id);
  if (!id) {
    return null;
  }
  const profile = sanitizeProfile(record.profile, id);
  const sourceRobotRecord = isRecord(record.sourceRobot) ? record.sourceRobot : null;
  const sourceRobotId = stringValue(sourceRobotRecord?.id);
  const sourceRobotName = stringValue(sourceRobotRecord?.name, sourceRobotId);
  const versions = Array.isArray(record.versions)
    ? record.versions
        .map(sanitizeVersion)
        .filter((entry): entry is EmployeeSkillVersionSummary => entry !== null)
    : [];
  return {
    id,
    profile: { ...profile, id },
    lifecycle: normalizeLifecycle(record.lifecycle),
    health: sanitizeHealth(record.health),
    sourceRobot: sourceRobotId ? { id: sourceRobotId, name: sourceRobotName } : null,
    ownerUserId: stringValue(record.ownerUserId) || null,
    usageCount: Math.max(0, numberOrNull(record.usageCount) ?? 0),
    lastUsedAt: numberOrNull(record.lastUsedAt),
    runtimeDefinition: completeRuntimeContract(
      sanitizeRuntimeDefinition(record.runtimeDefinition),
      { ...profile, id },
    ),
    version: stringValue(record.version, "1.0.0"),
    ...(stringValue(record.sourceLineageId)
      ? { sourceLineageId: stringValue(record.sourceLineageId) }
      : {}),
    ...(sanitizeDeliverableArtifactRef(record.deliverableArtifact)
      ? { deliverableArtifact: sanitizeDeliverableArtifactRef(record.deliverableArtifact)! }
      : {}),
    versions,
    sharedGroups: sanitizeSharedGroups(record.sharedGroups),
    enterpriseConsumers: sanitizeEnterpriseConsumers(record.enterpriseConsumers),
    createdAt: numberOrNull(record.createdAt) ?? 0,
    updatedAt: numberOrNull(record.updatedAt) ?? 0,
  };
}

function sanitizeRelation(value: unknown): RobotSkillRelation | null {
  const record = isRecord(value) ? value : null;
  if (!record) {
    return null;
  }
  const agentId = stringValue(record.agentId);
  const skillId = stringValue(record.skillId);
  if (!agentId || !skillId) {
    return null;
  }
  return {
    id: stringValue(record.id, createRelationId(agentId, skillId)),
    agentId,
    skillId,
    enabled: record.enabled !== false,
    installedVersion: stringValue(record.installedVersion, "1.0.0"),
    lastInvokedAt: numberOrNull(record.lastInvokedAt),
    usageCount: Math.max(0, numberOrNull(record.usageCount) ?? 0),
    createdAt: numberOrNull(record.createdAt) ?? 0,
  };
}

function emptyStore(): SkillAssetStore {
  return { skills: [], robotRelations: [], reviews: {}, shareAttributions: [] };
}

function readStore(): SkillAssetStore {
  try {
    if (!fs.existsSync(STORE_FILE)) {
      return emptyStore();
    }
    const raw = fs.readFileSync(STORE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const record = isRecord(parsed) ? parsed : {};
    return {
      skills: Array.isArray(record.skills)
        ? record.skills
            .map(sanitizeStoredSkill)
            .filter((entry): entry is StoredSkill => entry !== null)
        : [],
      robotRelations: Array.isArray(record.robotRelations)
        ? record.robotRelations
            .map(sanitizeRelation)
            .filter((entry): entry is RobotSkillRelation => entry !== null)
        : [],
      reviews: isRecord(record.reviews)
        ? (record.reviews as Record<string, SkillReviewRecord>)
        : {},
      shareAttributions: Array.isArray(record.shareAttributions)
        ? (record.shareAttributions as SkillShareAttribution[])
        : [],
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(store: SkillAssetStore): void {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  fs.writeFileSync(STORE_FILE, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
}

function findSkill(store: SkillAssetStore, skillId: string): StoredSkill {
  const skill = store.skills.find((entry) => entry.id === skillId);
  if (!skill) {
    throw new SkillAssetStoreError(`skill ${skillId} not found`);
  }
  return skill;
}

function findRelation(
  store: SkillAssetStore,
  agentId: string,
  skillId: string,
): RobotSkillRelation {
  const relation = store.robotRelations.find(
    (entry) => entry.agentId === agentId && entry.skillId === skillId,
  );
  if (!relation) {
    throw new SkillAssetStoreError(`skill ${skillId} is not installed on robot ${agentId}`);
  }
  return relation;
}

function resolveInitialLifecycle(
  visibility: SkillVisibility,
  lifecycle: SkillLifecycleState | undefined,
): SkillLifecycleState {
  // Trusted callers (registry materialize, tests) pass an explicit lifecycle.
  // Visibility only supplies a default when lifecycle is omitted.
  if (lifecycle) {
    return normalizeLifecycle(lifecycle);
  }
  if (visibility === "enterprise") {
    return "reviewing";
  }
  if (visibility === "group") {
    return "published";
  }
  return "draft";
}

function nextPatchVersion(version: string): string {
  const parts = version.split(".").map((part) => Number.parseInt(part, 10));
  const [major, minor, patch] = [
    Number.isFinite(parts[0]) ? parts[0] : 1,
    Number.isFinite(parts[1]) ? parts[1] : 0,
    Number.isFinite(parts[2]) ? parts[2] : 0,
  ];
  return `${major}.${minor}.${patch + 1}`;
}

function findVersion(skill: StoredSkill, version: string): EmployeeSkillVersionSummary {
  const entry = skill.versions.find((candidate) => candidate.version === version);
  if (!entry) {
    throw new SkillAssetStoreError(`version ${version} not found for skill ${skill.id}`);
  }
  return entry;
}

function diffProfiles(
  before: EmployeeSkillProfile,
  after: EmployeeSkillProfile,
): SkillVersionDiff["changedFields"] {
  const fields: Array<keyof EmployeeSkillProfile> = [
    "name",
    "summary",
    "assetType",
    "usageExamples",
    "inputDescription",
    "outputDescription",
    "tags",
    "category",
    "avatar",
    "visibility",
  ];
  const changedFields: SkillVersionDiff["changedFields"] = [];
  for (const field of fields) {
    const left = before[field];
    const right = after[field];
    if (JSON.stringify(left) !== JSON.stringify(right)) {
      changedFields.push({ field, before: left, after: right });
    }
  }
  return changedFields;
}

function projectSummary(skill: StoredSkill): EmployeeSkillSummary {
  return {
    id: skill.id,
    profile: skill.profile,
    lifecycle: skill.lifecycle,
    health: skill.health,
    sourceRobot: skill.sourceRobot,
    ownerUserId: skill.ownerUserId ?? null,
    usageCount: skill.usageCount,
    lastUsedAt: skill.lastUsedAt,
    version: skill.version,
    versionCount: skill.versions.length,
    ...(skill.sourceLineageId ? { sourceLineageId: skill.sourceLineageId } : {}),
    ...(skill.deliverableArtifact ? { deliverableArtifact: skill.deliverableArtifact } : {}),
  };
}

function buildDependencyGraph(skill: StoredSkill, store: SkillAssetStore): SkillDependencyGraph {
  return {
    installedRobots: store.robotRelations
      .filter((relation) => relation.skillId === skill.id)
      .map((relation) => ({ agentId: relation.agentId, name: relation.agentId })),
    sharedGroups: skill.sharedGroups,
    dependentSkills: store.skills
      .filter(
        (entry) => entry.id !== skill.id && entry.runtimeDefinition.dependencies.includes(skill.id),
      )
      .map((entry) => ({ skillId: entry.id, name: entry.profile.name })),
    enterpriseConsumers: skill.enterpriseConsumers,
  };
}

function assessDependencyImpact(
  skill: StoredSkill,
  graph: SkillDependencyGraph,
): RuntimeDependencyImpact {
  const totalImpactedObjects =
    graph.installedRobots.length +
    graph.sharedGroups.length +
    graph.dependentSkills.length +
    graph.enterpriseConsumers.length;

  return {
    skillId: skill.id,
    skillName: skill.profile.name,
    installedRobotCount: graph.installedRobots.length,
    sharedGroupCount: graph.sharedGroups.length,
    dependentSkillCount: graph.dependentSkills.length,
    enterpriseConsumerCount: graph.enterpriseConsumers.length,
    requiresMigrationPlan: graph.dependentSkills.length > 0 || graph.enterpriseConsumers.length > 0,
    impactSummary:
      totalImpactedObjects > 0
        ? `影响 ${totalImpactedObjects} 个对象，需要评估变更窗口。`
        : "暂无运行依赖，可以低风险调整。",
  };
}

function addTopologyNode(
  nodes: Map<string, RuntimeDependencyTopologyNode>,
  node: RuntimeDependencyTopologyNode,
): void {
  nodes.set(node.id, node);
}

function buildTopologyForSkills(
  skills: StoredSkill[],
  store: SkillAssetStore,
): RuntimeDependencyTopology {
  const nodes = new Map<string, RuntimeDependencyTopologyNode>();
  const edges: RuntimeDependencyTopologyEdge[] = [];
  const impacts: RuntimeDependencyImpact[] = [];

  for (const skill of skills) {
    const graph = buildDependencyGraph(skill, store);
    addTopologyNode(nodes, {
      id: skill.id,
      label: skill.profile.name,
      type: "skill",
    });
    impacts.push(assessDependencyImpact(skill, graph));

    for (const robot of graph.installedRobots) {
      addTopologyNode(nodes, { id: robot.agentId, label: robot.name, type: "robot" });
      edges.push({ from: skill.id, to: robot.agentId, type: "installed_on" });
    }

    for (const group of graph.sharedGroups) {
      addTopologyNode(nodes, { id: group.groupId, label: group.name, type: "group" });
      edges.push({ from: skill.id, to: group.groupId, type: "shared_to" });
    }

    for (const dependentSkill of graph.dependentSkills) {
      addTopologyNode(nodes, {
        id: dependentSkill.skillId,
        label: dependentSkill.name,
        type: "skill",
      });
      edges.push({ from: dependentSkill.skillId, to: skill.id, type: "depends_on" });
    }

    for (const consumer of graph.enterpriseConsumers) {
      addTopologyNode(nodes, { id: consumer.consumerId, label: consumer.name, type: "consumer" });
      edges.push({ from: skill.id, to: consumer.consumerId, type: "consumed_by" });
    }
  }

  return {
    nodes: [...nodes.values()],
    edges,
    impacts,
  };
}

function projectDetail(skill: StoredSkill, store: SkillAssetStore): EmployeeSkillDetail {
  return {
    ...projectSummary(skill),
    dependencyGraph: buildDependencyGraph(skill, store),
    // Never leak runtimeDefinition into employee-facing version history.
    versions: skill.versions.map((entry) => ({
      version: entry.version,
      createdAt: entry.createdAt,
      summary: entry.summary,
      profile: entry.profile,
    })),
  };
}

function projectRobotSkill(skill: StoredSkill, relation: RobotSkillRelation): RobotSkillEntry {
  return {
    ...projectSummary(skill),
    // Prefer relation counters for this robot install.
    usageCount: relation.usageCount,
    lastUsedAt: relation.lastInvokedAt,
    enabled: relation.enabled,
    installedVersion: relation.installedVersion,
    latestVersion: skill.version,
    lastInvokedAt: relation.lastInvokedAt,
  };
}

export function extractSkillPreview(params: {
  agentId: string;
  contextId?: string | null;
}): ExtractedSkillPreview {
  const contextLabel = params.contextId?.trim() || "当前工作";
  const profile = sanitizeProfile({
    id: "",
    name: `${contextLabel}复用流程`,
    summary: "将机器人当前稳定工作方式沉淀为个人可复用技能。",
    visibility: "private",
  });
  return {
    suggestedName: profile.name,
    suggestedSummary: profile.summary,
    confidence: 0.72,
    detectedAt: Date.now(),
    profile,
  };
}

export function saveSkillAsset(params: SaveSkillAssetParams): {
  skillId: string;
  detail: EmployeeSkillDetail;
} {
  const sourceAgentId = stringValue(params.sourceAgentId);
  const now = Date.now();
  const store = readStore();
  const requestedSkillId = stringValue(params.skillId);
  const skillId = requestedSkillId || createSkillId();
  if (requestedSkillId && store.skills.some((entry) => entry.id === requestedSkillId)) {
    throw new SkillAssetStoreError(`skill ${requestedSkillId} already exists`);
  }
  const rawProfile = sanitizeProfile(params.profile, skillId);
  const sanitizedRuntime = sanitizeRuntimeDefinition(params.runtimeDefinition, params.contextId);
  const classified =
    rawProfile.assetType === "knowledge"
      ? null
      : inferOrganizableAssetClassification({
          name: rawProfile.name,
          summary: rawProfile.summary,
          category: rawProfile.category,
          tags: rawProfile.tags,
          contextId: params.contextId,
          runtimeDefinition: sanitizedRuntime,
        });
  const classifiedAssetType =
    params.classificationPolicy === "approved-pattern-capability" &&
    rawProfile.assetType === "capability" &&
    classified?.assetType !== "tool" &&
    classified?.assetType !== "mcp"
      ? "capability"
      : classified?.assetType;
  const profile = {
    ...rawProfile,
    id: skillId,
    ...(classifiedAssetType ? { assetType: classifiedAssetType } : {}),
  };
  if (!profile.name || !profile.summary) {
    throw new SkillAssetStoreError("skill name and summary are required");
  }
  const ownerUserId = stringValue(params.ownerUserId) || null;
  const runtimeDefinition = completeRuntimeContract(
    {
      ...sanitizedRuntime,
      ...(classified?.toolBinding
        ? { tools: classified.toolBinding.toolIds, toolBinding: classified.toolBinding }
        : {}),
      ...(classified?.mcpBinding ? { mcpBinding: classified.mcpBinding } : {}),
    },
    profile,
  );
  const skill: StoredSkill = {
    id: skillId,
    profile,
    lifecycle: resolveInitialLifecycle(profile.visibility, params.lifecycle),
    health: defaultHealth(),
    sourceRobot: sourceAgentId ? { id: sourceAgentId, name: sourceAgentId } : null,
    ownerUserId,
    usageCount: 0,
    lastUsedAt: null,
    runtimeDefinition,
    version: "1.0.0",
    ...(params.contextId?.trim() ? { sourceLineageId: params.contextId.trim() } : {}),
    ...(sanitizeDeliverableArtifactRef(params.deliverableArtifact)
      ? { deliverableArtifact: sanitizeDeliverableArtifactRef(params.deliverableArtifact)! }
      : {}),
    versions: [
      {
        version: "1.0.0",
        createdAt: now,
        summary: "Initial save",
        profile,
        runtimeDefinition,
      },
    ],
    sharedGroups:
      profile.visibility === "group" && params.targetGroupId
        ? [{ groupId: params.targetGroupId, name: params.targetGroupId }]
        : [],
    enterpriseConsumers: sanitizeEnterpriseConsumers(params.enterpriseConsumers),
    createdAt: now,
    updatedAt: now,
  };
  store.skills.push(skill);
  // Source-robot relation is allowed for draft (quick-save / req 6.7). Execution
  // binding still skips draft/reviewing so they do not inject into agent runtime.
  const mayAutoInstall =
    Boolean(sourceAgentId) &&
    params.autoInstallEnabled !== false &&
    (skill.lifecycle === "draft" ||
      skill.lifecycle === "private" ||
      skill.lifecycle === "approved" ||
      skill.lifecycle === "published");
  if (sourceAgentId && mayAutoInstall) {
    const relation: RobotSkillRelation = {
      id: createRelationId(sourceAgentId, skillId),
      agentId: sourceAgentId,
      skillId,
      enabled: true,
      installedVersion: skill.version,
      lastInvokedAt: null,
      usageCount: 0,
      createdAt: now,
    };
    store.robotRelations.push(relation);
  }
  writeStore(store);
  if (sourceAgentId && mayAutoInstall) {
    emitSkillRelationMutation({ op: "save", agentId: sourceAgentId, skillId });
  }
  return { skillId, detail: projectDetail(skill, store) };
}

/** Increment the patch segment of a semver-ish version string ("1.0.0" -> "1.0.1"). */
function bumpPatchVersion(version: string): string {
  const parts = version.split(".");
  if (parts.length !== 3) {
    return "1.0.1";
  }
  const patch = Number.parseInt(parts[2] ?? "0", 10);
  const next = Number.isFinite(patch) ? patch + 1 : 1;
  return `${parts[0]}.${parts[1]}.${next}`;
}

/**
 * Update an already-captured deliverable IN PLACE with its latest revision (content / summary /
 * title / artifact reference), bumping the version and refreshing timestamps. Used by the
 * deliverable auto-capture "latest-wins" dedup so revisions of one logical deliverable collapse
 * into a single 成果 entry (the newest version) instead of accumulating one row per revision.
 * Returns false when the skill no longer exists.
 */
export function updateCapturedDeliverable(params: {
  skillId: string;
  title?: string;
  summary: string;
  content: string;
  deliverableArtifact?: DeliverableArtifactRef;
}): boolean {
  const store = readStore();
  const skill = store.skills.find((entry) => entry.id === params.skillId);
  if (!skill) {
    return false;
  }
  const now = Date.now();
  const nextVersion = bumpPatchVersion(skill.version);
  const nextTitle = params.title?.trim() || skill.profile.name;
  skill.profile = {
    ...skill.profile,
    name: nextTitle,
    summary: params.summary,
    outputDescription: params.content,
  };
  const artifact = sanitizeDeliverableArtifactRef(params.deliverableArtifact);
  if (artifact) {
    skill.deliverableArtifact = artifact;
  }
  skill.version = nextVersion;
  skill.versions.push({
    version: nextVersion,
    createdAt: now,
    summary: "Deliverable updated (latest revision)",
    profile: { ...skill.profile },
  });
  skill.updatedAt = now;
  skill.lastUsedAt = now;
  writeStore(store);
  return true;
}

export function listPersonalSkillAssets(filter?: {
  /** When set, only return assets owned by this user (fail-closed for personal ACL). */
  ownerUserId?: string | null;
}): EmployeeSkillSummary[] {
  const ownerUserId = filter?.ownerUserId?.trim() || null;
  return readStore()
    .skills.toSorted((left, right) => right.updatedAt - left.updatedAt)
    .filter((skill) => {
      if (!ownerUserId) {
        return true;
      }
      return (skill.ownerUserId?.trim() || null) === ownerUserId;
    })
    .map(projectSummary);
}

export function getPersonalSkillAssetDetail(skillId: string): EmployeeSkillDetail {
  const store = readStore();
  return projectDetail(findSkill(store, skillId), store);
}

export function listSkillVersionHistory(skillId: string): EmployeeSkillVersionSummary[] {
  const store = readStore();
  return findSkill(store, skillId).versions.map((entry) => ({
    version: entry.version,
    createdAt: entry.createdAt,
    summary: entry.summary,
    profile: { ...entry.profile },
  }));
}

export function diffSkillVersions(params: {
  skillId: string;
  fromVersion: string;
  toVersion: string;
}): SkillVersionDiff {
  const store = readStore();
  const skill = findSkill(store, params.skillId);
  const from = findVersion(skill, params.fromVersion);
  const to = findVersion(skill, params.toVersion);
  return {
    skillId: skill.id,
    fromVersion: from.version,
    toVersion: to.version,
    changedFields: diffProfiles(from.profile, to.profile),
  };
}

export function rollbackSkillVersion(params: {
  skillId: string;
  targetVersion: string;
  summary?: string;
}): { rollback: SkillRollback; detail: EmployeeSkillDetail } {
  const store = readStore();
  const skill = findSkill(store, params.skillId);
  const target = findVersion(skill, params.targetVersion);
  const previousVersion = skill.version;
  const now = Date.now();
  const newVersion = nextPatchVersion(skill.version);
  const profile = { ...target.profile, id: skill.id };
  // Restore runtime from the target version pin when present; otherwise keep current runtime.
  const restoredRuntime =
    target.runtimeDefinition ?? sanitizeRuntimeDefinition(skill.runtimeDefinition);
  skill.profile = profile;
  skill.runtimeDefinition = restoredRuntime;
  skill.version = newVersion;
  skill.updatedAt = now;
  const summary = stringValue(params.summary, "最近更新 · 恢复了较早的能力说明");
  skill.versions.push({
    version: newVersion,
    createdAt: now,
    summary,
    profile,
    runtimeDefinition: restoredRuntime,
  });
  // Rollback creates a new head version; robots pinned via installedVersion must follow it.
  for (const relation of store.robotRelations.filter((entry) => entry.skillId === skill.id)) {
    relation.installedVersion = newVersion;
  }
  writeStore(store);
  // Refresh materialisations for robots pinned to this skill (version pin / rollback).
  for (const relation of store.robotRelations.filter((entry) => entry.skillId === skill.id)) {
    emitSkillRelationMutation({
      op: "upgrade",
      agentId: relation.agentId,
      skillId: skill.id,
    });
  }
  return {
    rollback: {
      skillId: skill.id,
      rolledBackFrom: previousVersion,
      rolledBackTo: target.version,
      newVersion,
      summary,
    },
    detail: projectDetail(skill, store),
  };
}

export function planSkillMigration(params: {
  skillId: string;
  targetVersion?: string | null;
}): SkillMigration {
  const store = readStore();
  const skill = findSkill(store, params.skillId);
  const targetVersion = stringValue(params.targetVersion, skill.version);
  const impact = assessDependencyImpact(skill, buildDependencyGraph(skill, store));
  const planSteps = [
    "确认影响范围",
    impact.requiresMigrationPlan ? "通知下游负责人" : "记录低风险变更",
    impact.installedRobotCount > 0 ? "安排机器人灰度更新" : "无需机器人侧更新",
    impact.enterpriseConsumerCount > 0 ? "确认企业消费方变更窗口" : "无需企业消费方协调",
  ];
  return {
    skillId: skill.id,
    targetVersion,
    impact,
    planSteps,
  };
}

export function suggestSkillHealthRepair(skillId: string): SkillHealthRepairSuggestion {
  const store = readStore();
  const skill = findSkill(store, skillId);
  return {
    skillId: skill.id,
    healthStatus: skill.health.status,
    suggestions: repairSuggestionsForHealth(skill.health),
  };
}

export function recordSkillHealthTelemetry(params: {
  skillId: string;
  successRate: number;
  avgLatency?: number | null;
  failureReasons?: string[];
}): EmployeeSkillDetail {
  const store = readStore();
  const skill = findSkill(store, params.skillId);
  const successRate = boundedRate(params.successRate);
  const failureReasons = params.failureReasons ?? [];
  const status: SkillHealthStatus =
    successRate >= 0.95 && failureReasons.length === 0
      ? "healthy"
      : successRate < 0.5
        ? "broken"
        : "warning";
  skill.health = {
    status,
    successRate,
    avgLatency: Math.max(0, params.avgLatency ?? skill.health.avgLatency),
    lastVerifiedAt: Date.now(),
    failureReasons,
  };
  skill.updatedAt = Date.now();
  writeStore(store);
  return projectDetail(skill, store);
}

export function getRuntimeDependencyGraph(skillId: string): SkillDependencyGraph {
  const store = readStore();
  return buildDependencyGraph(findSkill(store, skillId), store);
}

export function assessRuntimeDependencyImpact(skillId: string): RuntimeDependencyImpact {
  const store = readStore();
  const skill = findSkill(store, skillId);
  return assessDependencyImpact(skill, buildDependencyGraph(skill, store));
}

export function queryRuntimeDependencyTopology(
  params: {
    skillId?: string | null;
  } = {},
): RuntimeDependencyTopology {
  const store = readStore();
  const skillId = stringValue(params.skillId);
  const skills = skillId ? [findSkill(store, skillId)] : store.skills;
  return buildTopologyForSkills(skills, store);
}

export function registerEnterpriseSkillConsumer(params: {
  skillId: string;
  consumerId: string;
  name?: string;
  type?: string;
}): EmployeeSkillDetail {
  const store = readStore();
  const skill = findSkill(store, params.skillId);
  const consumerId = stringValue(params.consumerId);
  if (!consumerId) {
    throw new SkillAssetStoreError("consumerId is required");
  }
  const name = stringValue(params.name, consumerId);
  const type = stringValue(params.type, "enterprise");
  const existing = skill.enterpriseConsumers.find((entry) => entry.consumerId === consumerId);
  if (existing) {
    existing.name = name;
    existing.type = type;
  } else {
    skill.enterpriseConsumers.push({ consumerId, name, type });
  }
  skill.updatedAt = Date.now();
  writeStore(store);
  return projectDetail(skill, store);
}

/**
 * 硬门槛：只有完成规范内容填充（价值身份内容不缺失、不占位）的资产，才能进入孵化通道
 * （共享到协作小组 / 提交企业）。拦截 顾氏医案.pdf 这类只有文件名、正文未解析的上传件。
 */
function assertContentReadyForIncubation(skill: StoredSkill, action: string): void {
  const readiness = evaluateAssetContentReadiness(skill.profile);
  if (readiness.admissible) {
    return;
  }
  const blocking = readiness.gaps.filter((gap) => gap.severity === "block").map((gap) => gap.label);
  const detail =
    blocking.length > 0
      ? `缺少${[...new Set(blocking)].join("、")}`
      : (readiness.reasons[0] ?? "内容不完整");
  throw new SkillAssetStoreError(`${action}前需完成规范内容填充：${detail}`);
}

export function editPersonalSkillAsset(params: {
  skillId: string;
  profile: unknown;
  summary?: string;
}): EmployeeSkillDetail {
  const store = readStore();
  const skill = findSkill(store, params.skillId);
  const patch = sanitizeProfile(params.profile, skill.id);
  const profile: EmployeeSkillProfile = {
    ...skill.profile,
    ...patch,
    id: skill.id,
    visibility: patch.visibility,
  };
  if (!profile.name || !profile.summary) {
    throw new SkillAssetStoreError("skill name and summary are required");
  }
  const now = Date.now();
  const version = nextPatchVersion(skill.version);
  skill.profile = profile;
  skill.version = version;
  skill.updatedAt = now;
  skill.versions.push({
    version,
    createdAt: now,
    summary: stringValue(params.summary, "Profile updated"),
    profile,
    // Pin current runtime with this version so installedVersion can replay it.
    runtimeDefinition: sanitizeRuntimeDefinition(skill.runtimeDefinition),
  });
  writeStore(store);
  return projectDetail(skill, store);
}

export function sharePersonalSkillToGroup(params: {
  skillId: string;
  groupId: string;
  sharedBy?: { userId?: string | null; agentId?: string | null; displayName?: string } | null;
}): EmployeeSkillDetail {
  const store = readStore();
  const groupId = stringValue(params.groupId);
  if (!groupId) {
    throw new SkillAssetStoreError("groupId is required");
  }
  const skill = findSkill(store, params.skillId);
  assertContentReadyForIncubation(skill, "共享到协作小组");
  skill.profile = { ...skill.profile, visibility: "group" };
  skill.lifecycle = "published";
  skill.updatedAt = Date.now();
  if (!skill.sharedGroups.some((entry) => entry.groupId === groupId)) {
    skill.sharedGroups.push({ groupId, name: groupId });
  }

  // 记录分享归因
  const sharedBy = params.sharedBy ?? null;
  const shareAttribution: SkillShareAttribution = {
    shareId: `share_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    skillId: skill.id,
    groupId,
    sharedBy: {
      userId: stringValue(sharedBy?.userId) || null,
      agentId: stringValue(sharedBy?.agentId) || null,
      displayName: stringValue(sharedBy?.displayName, "未知分享者"),
    },
    sharedAt: Date.now(),
  };
  if (!store.shareAttributions) {
    store.shareAttributions = [];
  }
  store.shareAttributions.push(shareAttribution);

  writeStore(store);
  return projectDetail(skill, store);
}

export function listGroupSharedSkills(groupId: string): Array<
  EmployeeSkillSummary & {
    shareAttribution: SkillShareAttribution | null;
  }
> {
  const store = readStore();
  const normalizedGroupId = stringValue(groupId);
  if (!normalizedGroupId) {
    return [];
  }

  const sharedSkills = store.skills.filter((skill) =>
    skill.sharedGroups.some((group) => group.groupId === normalizedGroupId),
  );

  return sharedSkills.map((skill) => {
    const attribution =
      store.shareAttributions?.find(
        (attr) => attr.skillId === skill.id && attr.groupId === normalizedGroupId,
      ) ?? null;
    return {
      ...projectSummary(skill),
      shareAttribution: attribution,
    };
  });
}

export function getSkillShareAttributions(skillId: string): SkillShareAttribution[] {
  const store = readStore();
  return store.shareAttributions?.filter((attr) => attr.skillId === skillId) ?? [];
}

/** Store write only. New RPCs must call submitSkillToEnterpriseReview. */
export function submitPersonalSkillToEnterprise(skillId: string): EmployeeSkillDetail {
  const store = readStore();
  const skill = findSkill(store, skillId);
  assertContentReadyForIncubation(skill, "提交企业");
  // Employee "save → submit enterprise" may still be draft; finalize to private first
  // (same gate as finalizeDraftSkill) so the review transition stays draft→private→reviewing.
  if (skill.lifecycle === "draft") {
    skill.lifecycle = "private";
  }
  skill.profile = { ...skill.profile, visibility: "enterprise" };
  skill.lifecycle = "reviewing";
  skill.updatedAt = Date.now();
  const installedAgents = store.robotRelations
    .filter((relation) => relation.skillId === skill.id && relation.enabled)
    .map((relation) => relation.agentId);
  writeStore(store);
  for (const agentId of installedAgents) {
    emitSkillRelationMutation({ op: "install", agentId, skillId });
  }
  return projectDetail(skill, store);
}

export function deletePersonalSkillAsset(skillId: string): { ok: true } {
  const store = readStore();
  findSkill(store, skillId);
  const affectedAgents = store.robotRelations
    .filter((relation) => relation.skillId === skillId)
    .map((relation) => relation.agentId);
  store.skills = store.skills.filter((skill) => skill.id !== skillId);
  store.robotRelations = store.robotRelations.filter((relation) => relation.skillId !== skillId);
  writeStore(store);
  for (const agentId of affectedAgents) {
    emitSkillRelationMutation({ op: "delete", agentId, skillId });
  }
  return { ok: true };
}

export function listRobotSkillAssets(agentId: string): RobotSkillEntry[] {
  const store = readStore();
  const bySkillId = new Map(store.skills.map((skill) => [skill.id, skill]));
  return store.robotRelations
    .filter((relation) => relation.agentId === agentId)
    .map((relation) => {
      const skill = bySkillId.get(relation.skillId);
      return skill ? projectRobotSkill(skill, relation) : null;
    })
    .filter((entry): entry is RobotSkillEntry => entry !== null);
}

export function toggleRobotSkillAsset(params: {
  agentId: string;
  skillId: string;
  enabled: boolean;
}): RobotSkillEntry {
  const store = readStore();
  const skill = findSkill(store, params.skillId);
  const relation = findRelation(store, params.agentId, params.skillId);
  relation.enabled = params.enabled;
  writeStore(store);
  emitSkillRelationMutation({
    op: "toggle",
    agentId: params.agentId,
    skillId: params.skillId,
  });
  return projectRobotSkill(skill, relation);
}

export function upgradeRobotSkillAsset(params: {
  agentId: string;
  skillId: string;
}): RobotSkillEntry {
  const store = readStore();
  const skill = findSkill(store, params.skillId);
  const relation = findRelation(store, params.agentId, params.skillId);
  relation.installedVersion = skill.version;
  writeStore(store);
  emitSkillRelationMutation({
    op: "upgrade",
    agentId: params.agentId,
    skillId: params.skillId,
  });
  return projectRobotSkill(skill, relation);
}

export function removeRobotSkillAsset(params: { agentId: string; skillId: string }): { ok: true } {
  const store = readStore();
  const before = store.robotRelations.length;
  store.robotRelations = store.robotRelations.filter(
    (relation) => relation.agentId !== params.agentId || relation.skillId !== params.skillId,
  );
  if (store.robotRelations.length === before) {
    throw new SkillAssetStoreError(
      `skill ${params.skillId} is not installed on robot ${params.agentId}`,
    );
  }
  writeStore(store);
  const reports = emitSkillRelationMutation({
    op: "remove",
    agentId: params.agentId,
    skillId: params.skillId,
  });
  return stampRelationReports({ ok: true as const }, reports);
}

export function installSkillToRobotAsset(params: {
  agentId: string;
  skillId: string;
}): RobotSkillEntry {
  const store = readStore();
  const skill = findSkill(store, params.skillId);
  let relation = store.robotRelations.find(
    (entry) => entry.agentId === params.agentId && entry.skillId === params.skillId,
  );
  if (!relation) {
    relation = {
      id: createRelationId(params.agentId, params.skillId),
      agentId: params.agentId,
      skillId: params.skillId,
      enabled: true,
      installedVersion: skill.version,
      lastInvokedAt: null,
      usageCount: 0,
      createdAt: Date.now(),
    };
    store.robotRelations.push(relation);
  } else {
    relation.enabled = true;
    relation.installedVersion = skill.version;
  }
  writeStore(store);
  const reports = emitSkillRelationMutation({
    op: "install",
    agentId: params.agentId,
    skillId: params.skillId,
  });
  return stampRelationReports(projectRobotSkill(skill, relation), reports);
}

/**
 * Binding-layer read: returns profile + runtimeDefinition for materialisation.
 * When `version` is provided, pins to that version's profile/runtime when present.
 * Employee UI projections still strip runtime fields.
 */
export function getSkillRuntimeDefinitionForBinding(
  skillId: string,
  opts?: { version?: string | null },
): {
  lifecycle: SkillLifecycleState;
  profile: EmployeeSkillProfile;
  runtimeDefinition: SkillRuntimeDefinition;
  version: string;
} {
  const store = readStore();
  const skill = findSkill(store, skillId);
  const pinVersion = opts?.version?.trim();
  if (pinVersion) {
    const pinned = skill.versions.find((entry) => entry.version === pinVersion);
    if (pinned) {
      return {
        lifecycle: skill.lifecycle,
        profile: { ...pinned.profile, id: skill.id },
        runtimeDefinition: pinned.runtimeDefinition
          ? sanitizeRuntimeDefinition(pinned.runtimeDefinition)
          : skill.runtimeDefinition,
        version: pinVersion,
      };
    }
  }
  return {
    lifecycle: skill.lifecycle,
    profile: skill.profile,
    runtimeDefinition: skill.runtimeDefinition,
    version: skill.version,
  };
}

/**
 * Atomically bump robot skill usage counters after a real invocation.
 */
export function recordRobotSkillInvocationStats(params: {
  agentId: string;
  skillId: string;
  atMs?: number;
}): RobotSkillEntry {
  const store = readStore();
  const skill = findSkill(store, params.skillId);
  const relation = findRelation(store, params.agentId, params.skillId);
  const atMs = params.atMs ?? Date.now();
  relation.usageCount += 1;
  relation.lastInvokedAt = atMs;
  skill.usageCount += 1;
  skill.lastUsedAt = atMs;
  skill.updatedAt = atMs;
  writeStore(store);
  return projectRobotSkill(skill, relation);
}

// ── Dependency summary (G4) ─────────────────────────────────────────────────

export function getRuntimeDependencySummary(skillId: string): SkillDependencySummaryResult {
  const store = readStore();
  const skill = findSkill(store, skillId);
  const graph = buildDependencyGraph(skill, store);
  const installedRobotCount = graph.installedRobots.length;
  const sharedGroupCount = graph.sharedGroups.length;
  const dependentSkillCount = graph.dependentSkills.length;
  const enterpriseConsumerCount = graph.enterpriseConsumers.length;
  return {
    skillId: skill.id,
    installedRobotCount,
    sharedGroupCount,
    dependentSkillCount,
    enterpriseConsumerCount,
    hasAnyConsumer:
      installedRobotCount > 0 ||
      sharedGroupCount > 0 ||
      dependentSkillCount > 0 ||
      enterpriseConsumerCount > 0,
  };
}

/** Maps the internal dependency graph to the client snapshot shape (id/name + enterprise consumer kind). */
export function getRuntimeDependencyGraphSnapshot(skillId: string): {
  skillId: string;
  installedRobots: Array<{ id: string; name: string }>;
  sharedGroups: Array<{ id: string; name: string }>;
  dependentSkills: Array<{ id: string; name: string }>;
  enterpriseConsumers: Array<{ kind: string; id: string | null; label: string }>;
} {
  const store = readStore();
  const skill = findSkill(store, skillId);
  const graph = buildDependencyGraph(skill, store);
  return {
    skillId: skill.id,
    installedRobots: graph.installedRobots.map((r) => ({ id: r.agentId, name: r.name })),
    sharedGroups: graph.sharedGroups.map((g) => ({ id: g.groupId, name: g.name })),
    dependentSkills: graph.dependentSkills.map((s) => ({ id: s.skillId, name: s.name })),
    enterpriseConsumers: graph.enterpriseConsumers.map((c) => ({
      kind:
        c.type === "department" || c.type === "group" || c.type === "role" ? c.type : "enterprise",
      id: c.consumerId || null,
      label: c.name,
    })),
  };
}

// ── Health sample aggregation (G1) ──────────────────────────────────────────

const HEALTH_WINDOW_MS = 24 * 60 * 60 * 1000;
const HEALTH_WINDOW_MAX_SAMPLES = 50;

type HealthSample = {
  outcome: "success" | "failure";
  latencyMs: number;
  failureReason?: string;
  timestamp: number;
};

/** In-process cache; authority is HEALTH_WINDOWS_FILE (survives restart). */
const healthSampleWindows = new Map<string, HealthSample[]>();
let healthWindowsLoaded = false;

function loadHealthWindowsFromDisk(): void {
  if (healthWindowsLoaded) {
    return;
  }
  healthWindowsLoaded = true;
  try {
    if (!fs.existsSync(HEALTH_WINDOWS_FILE)) {
      return;
    }
    const raw = JSON.parse(fs.readFileSync(HEALTH_WINDOWS_FILE, "utf-8")) as unknown;
    if (!isRecord(raw)) {
      return;
    }
    const now = Date.now();
    const windowStart = now - HEALTH_WINDOW_MS;
    for (const [skillId, value] of Object.entries(raw)) {
      if (!Array.isArray(value)) {
        continue;
      }
      const samples: HealthSample[] = [];
      for (const entry of value) {
        if (!isRecord(entry)) {
          continue;
        }
        const timestamp = numberOrNull(entry.timestamp);
        if (timestamp == null || timestamp < windowStart) {
          continue;
        }
        samples.push({
          outcome: entry.outcome === "failure" ? "failure" : "success",
          latencyMs: Math.max(0, numberOrNull(entry.latencyMs) ?? 0),
          failureReason: typeof entry.failureReason === "string" ? entry.failureReason : undefined,
          timestamp,
        });
      }
      const trimmed = samples.slice(-HEALTH_WINDOW_MAX_SAMPLES);
      if (trimmed.length > 0) {
        healthSampleWindows.set(skillId, trimmed);
      }
    }
  } catch {
    // corrupt file → empty windows
  }
}

function persistHealthWindowsToDisk(): void {
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    const payload: Record<string, HealthSample[]> = {};
    for (const [skillId, samples] of healthSampleWindows.entries()) {
      payload[skillId] = samples;
    }
    fs.writeFileSync(HEALTH_WINDOWS_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  } catch {
    // best-effort persistence
  }
}

/**
 * Records a single skill-health telemetry sample and folds the rolling window into the
 * persisted SkillHealth via the existing `recordSkillHealthTelemetry`. Returns the updated detail.
 * Rolling window is also written to disk so Gateway restart can restore sample counts.
 */
export function recordSkillHealthSample(params: {
  skillId: string;
  /** When set, samples are partitioned by agentId+skillId (avoids cross-robot pollution). */
  agentId?: string | null;
  outcome: "success" | "failure";
  latencyMs?: number;
  failureReason?: string;
  timestamp?: number;
}): EmployeeSkillDetail {
  loadHealthWindowsFromDisk();
  const skillId = stringValue(params.skillId);
  if (!skillId) {
    throw new SkillAssetStoreError("skillId is required");
  }
  const agentId = stringValue(params.agentId ?? "");
  const windowKey = agentId ? `agent:${agentId}|skill:${skillId}` : skillId;
  const now = params.timestamp ?? Date.now();
  const windowStart = now - HEALTH_WINDOW_MS;
  const samples = (healthSampleWindows.get(windowKey) ?? []).filter(
    (s) => s.timestamp >= windowStart,
  );
  const sample: HealthSample = {
    outcome: params.outcome === "failure" ? "failure" : "success",
    latencyMs: Math.max(0, params.latencyMs ?? 0),
    failureReason: params.failureReason,
    timestamp: now,
  };
  samples.push(sample);
  while (samples.length > HEALTH_WINDOW_MAX_SAMPLES) {
    samples.shift();
  }
  healthSampleWindows.set(windowKey, samples);
  persistHealthWindowsToDisk();

  // Global skill.health = aggregate of all agent-scoped windows for this skill
  // (never last-writer-wins from a single agent).
  const aggregateSamples = collectAgentScopedHealthSamples(skillId, windowStart);
  if (aggregateSamples.length === 0) {
    aggregateSamples.push(...samples);
  }
  while (aggregateSamples.length > HEALTH_WINDOW_MAX_SAMPLES) {
    aggregateSamples.shift();
  }
  healthSampleWindows.set(skillId, aggregateSamples);
  persistHealthWindowsToDisk();

  const total = aggregateSamples.length;
  const successCount = aggregateSamples.filter((s) => s.outcome === "success").length;
  const successRate = total > 0 ? successCount / total : 1;
  const avgLatency =
    total > 0 ? aggregateSamples.reduce((sum, s) => sum + s.latencyMs, 0) / total : 0;
  const failureReasons = uniqueSuggestions(
    aggregateSamples.map((s) => s.failureReason ?? "").filter(Boolean),
  );
  return recordSkillHealthTelemetry({ skillId, successRate, avgLatency, failureReasons });
}

/** Merge all agent:<id>|skill:<skillId> windows for global skill health. */
function collectAgentScopedHealthSamples(skillId: string, windowStart: number): HealthSample[] {
  const suffix = `|skill:${skillId}`;
  const merged: HealthSample[] = [];
  for (const [key, samples] of healthSampleWindows.entries()) {
    if (!key.startsWith("agent:") || !key.endsWith(suffix)) {
      continue;
    }
    for (const s of samples) {
      if (s.timestamp >= windowStart) {
        merged.push(s);
      }
    }
  }
  merged.sort((a, b) => a.timestamp - b.timestamp);
  return merged;
}

/** Test helper: clear in-memory health window cache (does not delete disk file unless path gone). */
export function resetSkillHealthWindowsCacheForTests(): void {
  healthSampleWindows.clear();
  healthWindowsLoaded = false;
}

// ── Draft lifecycle (G3) ─────────────────────────────────────────────────────

/** draft → private (员工确认完成整理). Re-syncs execution bindings for installed robots. */
export function finalizeDraftSkill(skillId: string): EmployeeSkillDetail {
  const store = readStore();
  const skill = findSkill(store, skillId);
  if (skill.lifecycle !== "draft") {
    throw new SkillAssetStoreError(`skill ${skillId} is not in draft state`);
  }
  skill.lifecycle = "private";
  skill.updatedAt = Date.now();
  writeStore(store);
  // Promotion to a runnable lifecycle: re-materialise any existing robot relations.
  for (const relation of store.robotRelations) {
    if (relation.skillId === skillId && relation.enabled) {
      emitSkillRelationMutation({
        op: "install",
        agentId: relation.agentId,
        skillId,
      });
    }
  }
  return projectDetail(skill, store);
}

/** Applies accepted autofill suggestion fields onto the employee profile (business-layer only). */
export function acceptSkillAutofill(params: {
  skillId: string;
  suggestion: SkillAutofillSuggestion;
  acceptFields: string[];
  acceptSummaryRefinement?: boolean;
}): EmployeeSkillDetail {
  const store = readStore();
  const skill = findSkill(store, params.skillId);
  const accept = new Set(params.acceptFields);
  const s = params.suggestion ?? {};
  const profile = { ...skill.profile };
  if (accept.has("category") && s.category) {
    profile.category = s.category;
  }
  if (accept.has("tags") && Array.isArray(s.tags)) {
    profile.tags = s.tags;
  }
  if (accept.has("inputDescription") && s.inputDescription) {
    profile.inputDescription = s.inputDescription;
  }
  if (accept.has("outputDescription") && s.outputDescription) {
    profile.outputDescription = s.outputDescription;
  }
  if (accept.has("usageExamples") && Array.isArray(s.usageExamples)) {
    profile.usageExamples = s.usageExamples;
  }
  if (accept.has("avatar") && s.avatar) {
    profile.avatar = s.avatar;
  }
  // summary refinement only applies when the employee explicitly accepts it
  if (params.acceptSummaryRefinement && s.summaryRefinement) {
    profile.summary = s.summaryRefinement;
  }
  skill.profile = profile;
  skill.updatedAt = Date.now();
  writeStore(store);
  return projectDetail(skill, store);
}

// ── Autofill job (G2) ────────────────────────────────────────────────────────

const autofillJobs = new Map<string, SkillAutofillJob>();

function deriveAutofillSuggestion(
  skill: StoredSkill,
  store: SkillAssetStore,
): { suggestion: SkillAutofillSuggestion | null; sources: SkillAutofillJob["enhancementSources"] } {
  // Reuse tags/category patterns from similar skills (same source robot or overlapping tags).
  const peers = store.skills.filter((entry) => entry.id !== skill.id);
  const sources: SkillAutofillJob["enhancementSources"] = [];
  const suggestion: SkillAutofillSuggestion = {};
  if (!skill.profile.category) {
    const peerWithCategory = peers.find((p) => p.profile.category);
    if (peerWithCategory) {
      suggestion.category = peerWithCategory.profile.category;
      sources.push({
        similarSkillId: peerWithCategory.id,
        similarSkillName: peerWithCategory.profile.name,
        sharedTags: [],
        sharedCategory: peerWithCategory.profile.category,
      });
    }
  }
  if (skill.profile.tags.length === 0) {
    const peerWithTags = peers.find((p) => p.profile.tags.length > 0);
    if (peerWithTags) {
      suggestion.tags = peerWithTags.profile.tags.slice(0, 3);
    }
  }
  if (!skill.profile.inputDescription) {
    suggestion.inputDescription = "按能力说明提供业务素材";
  }
  if (!skill.profile.outputDescription) {
    suggestion.outputDescription = "输出结构化处理结果";
  }
  if (skill.profile.usageExamples.length === 0) {
    suggestion.usageExamples = ["在日常重复任务中复用该能力"];
  }
  if (Object.keys(suggestion).length === 0) {
    return { suggestion: null, sources };
  }
  return { suggestion, sources };
}

/** Synchronously computes an autofill suggestion and stores it as a completed job. */
export function startSkillAutofill(skillId: string): SkillAutofillJob {
  const store = readStore();
  const skill = findSkill(store, skillId);
  const { suggestion, sources } = deriveAutofillSuggestion(skill, store);
  const job: SkillAutofillJob = {
    jobId: `autofill_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    skillId,
    status: suggestion ? "succeeded" : "empty",
    suggestion,
    enhancementSources: sources,
    updatedAt: Date.now(),
  };
  autofillJobs.set(skillId, job);
  return job;
}

export function getSkillAutofillResult(skillId: string): SkillAutofillJob {
  const existing = autofillJobs.get(skillId);
  if (existing) {
    return existing;
  }
  // Lazily compute if not started yet so the client always gets a usable result.
  return startSkillAutofill(skillId);
}

// ── Auto-classify (G5) ───────────────────────────────────────────────────────

export function listSkillClassificationSuggestions(): SkillClassificationSuggestion[] {
  const store = readStore();
  const categories = uniqueSuggestions(store.skills.map((s) => s.profile.category).filter(Boolean));
  const suggestions: SkillClassificationSuggestion[] = [];
  for (const skill of store.skills) {
    const needsCategory = !skill.profile.category && categories.length > 0;
    const needsTags = skill.profile.tags.length === 0;
    if (!needsCategory && !needsTags) {
      continue;
    }
    suggestions.push({
      skillId: skill.id,
      suggestedCategory: needsCategory ? (categories[0] ?? null) : null,
      suggestedTags: needsTags ? ["待归类"] : [],
    });
  }
  return suggestions;
}

export function acceptSkillClassification(params: {
  skillId: string;
  acceptCategory?: string | null;
  acceptTags?: string[];
}): EmployeeSkillDetail {
  const store = readStore();
  const skill = findSkill(store, params.skillId);
  const profile = { ...skill.profile };
  const category = stringValue(params.acceptCategory);
  if (category) {
    profile.category = category;
  }
  if (Array.isArray(params.acceptTags) && params.acceptTags.length > 0) {
    profile.tags = uniqueSuggestions([...profile.tags, ...stringArray(params.acceptTags)]);
  }
  skill.profile = profile;
  skill.updatedAt = Date.now();
  writeStore(store);
  return projectDetail(skill, store);
}

// ── Recommendations (G5) ─────────────────────────────────────────────────────

/**
 * Enterprise public catalog. Private drafts stay out even if a registry row exists.
 * Group-shared published skills remain recommendable. Review is not publication.
 */
export function includeInEnterprisePublicCatalog(skill: {
  lifecycle: SkillLifecycleState;
  visibility: SkillVisibility;
}): boolean {
  if (skill.lifecycle === "draft" || skill.visibility === "private") {
    return false;
  }
  return skill.lifecycle === "approved" || skill.lifecycle === "published";
}

/** Recommends installable published / group-shared skills not yet installed on the given robot. */
export function listSkillRecommendations(agentId: string): SkillRecommendationEntry[] {
  const store = readStore();
  const installedSkillIds = new Set(
    store.robotRelations.filter((r) => r.agentId === agentId).map((r) => r.skillId),
  );
  return store.skills
    .filter((skill) => !installedSkillIds.has(skill.id))
    .filter((skill) => skill.lifecycle === "published" || skill.sharedGroups.length > 0)
    .filter((skill) =>
      includeInEnterprisePublicCatalog({
        lifecycle: skill.lifecycle,
        visibility: skill.profile.visibility,
      }),
    )
    .map((skill) => {
      const source: "enterprise" | "shared" =
        skill.profile.visibility === "enterprise" ? "enterprise" : "shared";
      return {
        skillId: skill.id,
        name: skill.profile.name,
        summary: skill.profile.summary,
        category: skill.profile.category,
        tags: skill.profile.tags,
        source,
        sourceLabel: source === "enterprise" ? "企业资产库" : "共享推荐",
        health: skill.health.status,
        usageCount: skill.usageCount,
      };
    });
}

// ── Enterprise review lifecycle (G5) ─────────────────────────────────────────

function normalizeReviewScope(value: unknown): ApplicableReviewScope {
  if (!isRecord(value)) {
    return { kind: "enterprise" };
  }
  const kind = value.kind;
  if (kind === "department" || kind === "group" || kind === "role") {
    return {
      kind,
      id: stringValue(value.id),
      name: stringValue(value.name, stringValue(value.id)),
    };
  }
  return { kind: "enterprise" };
}

/** Store write only. New RPCs must call submitSkillToEnterpriseReview. */
export function submitSkillForReview(params: {
  skillId: string;
  scope: unknown;
}): SkillReviewRecord {
  const store = readStore();
  const skill = findSkill(store, params.skillId);
  if (skill.lifecycle === "draft") {
    throw new SkillAssetStoreError("draft skills cannot be submitted to enterprise review");
  }
  skill.profile = { ...skill.profile, visibility: "enterprise" };
  skill.lifecycle = "reviewing";
  skill.updatedAt = Date.now();
  const record: SkillReviewRecord = {
    skillId: skill.id,
    submittedAt: Date.now(),
    reviewer: null,
    applicableScope: normalizeReviewScope(params.scope),
    security: null,
    quality: null,
    decision: null,
    rejectionReason: null,
    improvementSuggestions: [],
  };
  store.reviews = { ...store.reviews, [skill.id]: record };
  const installedAgents = store.robotRelations
    .filter((relation) => relation.skillId === skill.id && relation.enabled)
    .map((relation) => relation.agentId);
  writeStore(store);
  for (const agentId of installedAgents) {
    emitSkillRelationMutation({ op: "install", agentId, skillId: skill.id });
  }
  return record;
}

export function getSkillReviewRecord(skillId: string): SkillReviewRecord | null {
  const store = readStore();
  return store.reviews?.[skillId] ?? null;
}

/** approved → published with applicable scope (G5). */
export function publishSkillReview(params: {
  skillId: string;
  scope: unknown;
}): EmployeeSkillDetail {
  const store = readStore();
  const skill = findSkill(store, params.skillId);
  skill.lifecycle = "published";
  skill.profile = { ...skill.profile, visibility: "enterprise" };
  skill.updatedAt = Date.now();
  const existing = store.reviews?.[skill.id];
  if (existing) {
    existing.decision = "approved";
    existing.applicableScope = normalizeReviewScope(params.scope);
    store.reviews = { ...store.reviews, [skill.id]: existing };
  }
  const installedAgents = store.robotRelations
    .filter((relation) => relation.skillId === skill.id && relation.enabled)
    .map((relation) => relation.agentId);
  writeStore(store);
  for (const agentId of installedAgents) {
    emitSkillRelationMutation({ op: "install", agentId, skillId: skill.id });
  }
  return projectDetail(skill, store);
}

/** published → deprecated (G5). */
export function deprecateSkillReview(skillId: string): EmployeeSkillDetail {
  const store = readStore();
  const skill = findSkill(store, skillId);
  skill.lifecycle = "deprecated";
  skill.updatedAt = Date.now();
  writeStore(store);
  return projectDetail(skill, store);
}

/** deprecated → retired (G5). */
export function retireSkillReview(skillId: string): EmployeeSkillDetail {
  const store = readStore();
  const skill = findSkill(store, skillId);
  skill.lifecycle = "retired";
  skill.updatedAt = Date.now();
  writeStore(store);
  return projectDetail(skill, store);
}

/**
 * Evolution adapter rollback only. Restores lifecycle without copying skill body.
 * Does not publish, install, or rewrite versions.
 */
export function restoreSkillLifecycleState(
  skillId: string,
  lifecycle: SkillLifecycleState,
): EmployeeSkillDetail {
  const store = readStore();
  const skill = findSkill(store, skillId);
  skill.lifecycle = lifecycle;
  skill.updatedAt = Date.now();
  writeStore(store);
  return projectDetail(skill, store);
}

/**
 * Evolution adapter rollback only. Restores this robot's installation relation.
 * Does not rewrite skill content or other robots' pins.
 */
export function restoreRobotSkillInstallation(params: {
  agentId: string;
  skillId: string;
  installed: boolean;
  installedVersion?: string;
  enabled?: boolean;
}): void {
  const store = readStore();
  findSkill(store, params.skillId);
  const index = store.robotRelations.findIndex(
    (entry) => entry.agentId === params.agentId && entry.skillId === params.skillId,
  );
  if (!params.installed) {
    if (index >= 0) {
      store.robotRelations.splice(index, 1);
      writeStore(store);
      emitSkillRelationMutation({
        op: "remove",
        agentId: params.agentId,
        skillId: params.skillId,
      });
    }
    return;
  }
  const skill = findSkill(store, params.skillId);
  if (index >= 0) {
    const relation = store.robotRelations[index];
    relation.enabled = params.enabled ?? relation.enabled;
    relation.installedVersion = params.installedVersion ?? relation.installedVersion;
  } else {
    store.robotRelations.push({
      id: createRelationId(params.agentId, params.skillId),
      agentId: params.agentId,
      skillId: params.skillId,
      enabled: params.enabled ?? true,
      installedVersion: params.installedVersion ?? skill.version,
      lastInvokedAt: null,
      usageCount: 0,
      createdAt: Date.now(),
    });
  }
  writeStore(store);
  emitSkillRelationMutation({
    op: "install",
    agentId: params.agentId,
    skillId: params.skillId,
  });
}
