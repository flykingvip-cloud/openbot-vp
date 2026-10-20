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

export type SkillLifecycleState =
  | "draft"
  | "private"
  | "reviewing"
  | "approved"
  | "published"
  | "deprecated"
  | "retired"
  | "rejected";

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
};

export type SkillHealth = {
  status: SkillHealthStatus;
  successRate: number;
  avgLatency: number;
  lastVerifiedAt: number | null;
  failureReasons: string[];
};

export type SkillDependencyGraph = {
  installedRobots: Array<{ agentId: string; name: string }>;
  sharedGroups: Array<{ groupId: string; name: string }>;
  dependentSkills: Array<{ skillId: string; name: string }>;
  enterpriseConsumers: Array<{ consumerId: string; name: string; type: string }>;
};

export type EmployeeSkillSummary = {
  id: string;
  profile: EmployeeSkillProfile;
  lifecycle: SkillLifecycleState;
  health: SkillHealth;
  sourceRobot: { id: string; name: string } | null;
  usageCount: number;
  lastUsedAt: number | null;
};

export type EmployeeSkillVersionSummary = {
  version: string;
  createdAt: number;
  summary: string;
  profile: EmployeeSkillProfile;
};

export type EmployeeSkillDetail = EmployeeSkillSummary & {
  dependencyGraph: SkillDependencyGraph;
  versions: EmployeeSkillVersionSummary[];
};

export const SKILL_RUNTIME_FIELD_NAMES = [
  "runtimeDefinition",
  "skillRuntimeDefinition",
  "prompts",
  "workflow",
  "tools",
  "memoryStrategy",
  "routingHints",
  "dependencies",
  "modelPreferences",
  "executionPolicies",
  "capabilities",
  "providers",
  "toolBinding",
  "mcpBinding",
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boundedRate(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }
  return Math.max(0, Math.min(1, value));
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => stringValue(entry).trim()).filter(Boolean)
    : [];
}

function normalizeVisibility(value: unknown): SkillVisibility {
  return value === "group" || value === "enterprise" ? value : "private";
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

/** 我的资产只收可执行能力；知识文档不进入整理面板。 */
export function toOrganizableAssetType(
  value: string | null | undefined,
): Exclude<AssetType, "knowledge"> {
  const normalized = normalizeAssetType(value);
  return normalized === "knowledge" ? "capability" : normalized;
}

export function normalizeSkillLifecycleState(value: unknown): SkillLifecycleState {
  switch (value) {
    case "private":
    case "reviewing":
    case "approved":
    case "published":
    case "deprecated":
    case "retired":
    case "rejected":
      return value;
    default:
      return "draft";
  }
}

function normalizeHealthStatus(value: unknown): SkillHealthStatus {
  return value === "warning" || value === "broken" ? value : "healthy";
}

export function sanitizeEmployeeSkillProfile(value: unknown): EmployeeSkillProfile {
  const record = asRecord(value) ?? {};
  return {
    id: stringValue(record.id),
    name: stringValue(record.name).trim(),
    summary: stringValue(record.summary).trim(),
    assetType: normalizeAssetType(record.assetType),
    usageExamples: stringArray(record.usageExamples),
    inputDescription: stringValue(record.inputDescription).trim(),
    outputDescription: stringValue(record.outputDescription).trim(),
    tags: stringArray(record.tags),
    category: stringValue(record.category).trim(),
    avatar: stringValue(record.avatar).trim(),
    visibility: normalizeVisibility(record.visibility),
  };
}

export function sanitizeSkillHealth(value: unknown): SkillHealth {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeHealthStatus(record.status),
    successRate: boundedRate(record.successRate),
    avgLatency: Math.max(0, optionalNumber(record.avgLatency) ?? 0),
    lastVerifiedAt: optionalNumber(record.lastVerifiedAt),
    failureReasons: stringArray(record.failureReasons),
  };
}

function normalizeNamedList<T extends Record<string, string>>(
  value: unknown,
  mapEntry: (record: Record<string, unknown>) => T | null,
): T[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (asRecord(entry) ? mapEntry(asRecord(entry)!) : null))
    .filter(Boolean) as T[];
}

export function sanitizeSkillDependencyGraph(value: unknown): SkillDependencyGraph {
  const record = asRecord(value) ?? {};
  return {
    installedRobots: normalizeNamedList(record.installedRobots, (entry) => {
      const agentId = stringValue(entry.agentId).trim();
      const name = stringValue(entry.name).trim();
      return agentId && name ? { agentId, name } : null;
    }),
    sharedGroups: normalizeNamedList(record.sharedGroups, (entry) => {
      const groupId = stringValue(entry.groupId).trim();
      const name = stringValue(entry.name).trim();
      return groupId && name ? { groupId, name } : null;
    }),
    dependentSkills: normalizeNamedList(record.dependentSkills, (entry) => {
      const skillId = stringValue(entry.skillId).trim();
      const name = stringValue(entry.name).trim();
      return skillId && name ? { skillId, name } : null;
    }),
    enterpriseConsumers: normalizeNamedList(record.enterpriseConsumers, (entry) => {
      const consumerId = stringValue(entry.consumerId).trim();
      const name = stringValue(entry.name).trim();
      const type = stringValue(entry.type).trim();
      return consumerId && name ? { consumerId, name, type } : null;
    }),
  };
}

function sanitizeSourceRobot(value: unknown): EmployeeSkillSummary["sourceRobot"] {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const id = stringValue(record.id).trim();
  const name = stringValue(record.name).trim();
  return id && name ? { id, name } : null;
}

export function sanitizeEmployeeSkillSummary(value: unknown): EmployeeSkillSummary {
  const record = asRecord(value) ?? {};
  const profile = sanitizeEmployeeSkillProfile(record.profile ?? record);
  return {
    id: stringValue(record.id, profile.id).trim() || profile.id,
    profile,
    lifecycle: normalizeSkillLifecycleState(record.lifecycle),
    health: sanitizeSkillHealth(record.health),
    sourceRobot: sanitizeSourceRobot(record.sourceRobot),
    usageCount: Math.max(0, optionalNumber(record.usageCount) ?? 0),
    lastUsedAt: optionalNumber(record.lastUsedAt),
  };
}

function sanitizeSkillVersion(value: unknown): EmployeeSkillVersionSummary {
  const record = asRecord(value) ?? {};
  return {
    version: stringValue(record.version).trim(),
    createdAt: optionalNumber(record.createdAt) ?? 0,
    summary: stringValue(record.summary).trim(),
    profile: sanitizeEmployeeSkillProfile(record.profile),
  };
}

export function sanitizeEmployeeSkillDetail(value: unknown): EmployeeSkillDetail {
  const record = asRecord(value) ?? {};
  return {
    ...sanitizeEmployeeSkillSummary(record),
    dependencyGraph: sanitizeSkillDependencyGraph(record.dependencyGraph),
    versions: Array.isArray(record.versions) ? record.versions.map(sanitizeSkillVersion) : [],
  };
}

export function containsSkillRuntimeField(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsSkillRuntimeField);
  }
  const record = asRecord(value);
  if (!record) {
    return false;
  }
  return Object.entries(record).some(([key, nested]) => {
    if ((SKILL_RUNTIME_FIELD_NAMES as readonly string[]).includes(key)) {
      return true;
    }
    return containsSkillRuntimeField(nested);
  });
}
