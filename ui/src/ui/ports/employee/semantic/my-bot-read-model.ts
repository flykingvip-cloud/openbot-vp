/**
 * Employee My Bots read model — Phase 0 contract.
 *
 * Scope: system settings →「我的机器人」only.
 * Must NOT carry enterprise mesh fields (totalCost, runtimeHosts, token budgets, …).
 *
 * Spec: docs/design/robot-workspace-and-mesh-boundary-plan-2026-08-02.md §7.1
 */

export type MyBotBriefStatus = "online" | "degraded" | "offline" | "unknown";

export type MyBotCapabilitySource = "personal" | "group" | "enterprise" | "marketplace";

export type MyBotGrowthSource = "personal" | "group" | "skill_upgrade";

export type MyBotIdentityProjection = {
  name: string;
  avatar: string | null;
  positioning: string | null;
  intro: string | null;
  role: string | null;
  personaTraits: string | null;
  model: string | null;
  status: MyBotBriefStatus;
  createdAt: string | null;
};

export type MyBotCapabilityDomainId =
  | "research"
  | "content"
  | "data"
  | "collab"
  | "tools"
  | "general";

export type MyBotCapabilityProjection = {
  name: string;
  /** 1–5 proficiency stars */
  stars: number;
  source: MyBotCapabilitySource;
  relationId: string;
  callCount?: number;
  description?: string | null;
  domain?: string | null;
  lastImprovedAt?: string | null;
};

/** Duty / evidence vector across the five radar axes (excludes general). */
export type MyBotDomainVector = Record<Exclude<MyBotCapabilityDomainId, "general">, number>;

export type MyBotIdentityAffinityScore = {
  id: string;
  label: string;
  score: number;
};

export type MyBotIdentityAffinity = {
  primary: MyBotIdentityAffinityScore | null;
  secondary: MyBotIdentityAffinityScore | null;
  scores: MyBotIdentityAffinityScore[];
  evidenceCallTotal: number;
  lowConfidence: boolean;
};

export type MyBotPersonaProjection = {
  id: string;
  label: string;
  description?: string;
};

export type MyBotGrowthGapView = {
  key: string;
  label: string;
  kind: string;
  status: string;
};

export type MyBotGrowthRecommendationView = {
  kind: string;
  reason: string;
  canSkip: boolean;
  gaps: MyBotGrowthGapView[];
  target?: {
    module?: string;
    tab?: string;
    recommendedSkillKeys?: string[];
    focusComposer?: boolean;
    prefill?: string;
  };
};

export type MyBotGrowthReportView = {
  periodDays: number;
  tasksCompleted: number;
  hoursSavedEstimate?: number | null;
  toolInvocations: number;
  taskSuccessRate?: number | null;
  toolSuccessRate?: number | null;
  humanTakeoverRate?: number | null;
  businessImpact: Array<{ key: string; value: number; unit?: string; description: string }>;
  topInsights?: string[];
  suggestedWorkflows?: string[];
};

export type MyBotGrowthCompleteness = {
  identity: number;
  capability: number;
  performance: number;
  suggestion: number;
};

export type MyBotWorkingStyleProjection = {
  learned: boolean;
  style: {
    outputFormat: string;
    reportingCadence: string;
    decisionPreference: string;
    riskPreference: string;
    communicationTone: string;
  };
  evidence: {
    tasksTotal: number;
    minSamplesForLearning: number;
    minSamplesForAutonomous: number;
    learningEligible: boolean;
    autonomousEligible: boolean;
  };
  updatedAtMs: number | null;
  lastChange: {
    changedAtMs: number;
    effectStatus: string | null;
    rolledBack: boolean;
  } | null;
};

export type MyBotGrowthTaskRef = {
  kind: string;
  id: string;
  title: string;
};

export type MyBotGrowthEventProjection = {
  text: string;
  at?: string;
  source?: MyBotGrowthSource;
  taskRef?: MyBotGrowthTaskRef;
  capabilityRef?: string;
};

export type MyBotGrowthProjection = {
  level: number;
  recentEvents: MyBotGrowthEventProjection[];
  sources: MyBotGrowthSource[];
  sourceCounts?: Partial<Record<MyBotGrowthSource, number>>;
  /** P2 档案：配置成熟度分。 */
  activationScore?: number;
  /** P2 档案：实战表现分；无数据为 null。 */
  operationalScore?: number | null;
  falseReady?: boolean;
  dimensions?: {
    identity: number;
    capability: number;
    knowledge: number;
    habits: number;
    alignment?: number;
  };
  completeness?: MyBotGrowthCompleteness;
  capabilityGaps?: MyBotGrowthGapView[];
  recommendation?: MyBotGrowthRecommendationView | null;
  growthReport?: MyBotGrowthReportView | null;
  funnel?: {
    hasSessionOpened: boolean;
    hasIdentityCompleted: boolean;
    hasFirstSkillInstalled: boolean;
    hasFirstMissionSent: boolean;
    hasFirstMissionSuccess: boolean;
    preludeDismissed: boolean;
  } | null;
  /** P2.1：Working DNA / 经验偏好沉淀。 */
  workingStyle?: MyBotWorkingStyleProjection | null;
};

export type MyBotCollaborationProjection = {
  groupId: string;
  title: string;
  sessionKey: string;
};

export type MyBotDataProjection = {
  memorySize?: number;
  longTermCount?: number;
  kbCount?: number;
  recentLearning: Array<{ text: string; at?: string }>;
};

/** Which My Bot blocks are populated in the current response (Gateway Phase 0+). */
export type MyBotBlocksComplete = {
  identity: boolean;
  capabilities: boolean;
  personas: boolean;
  growth: boolean;
  collaborations: boolean;
  data: boolean;
};

/** Full six-block projection returned by robot.workspace.get (Phase 2 fills blocks). */
export type MyBotProjection = {
  agentId: string;
  identity: MyBotIdentityProjection;
  capabilities: MyBotCapabilityProjection[];
  /** Persona ≠ Capability; ≠ operational identity grants. */
  personas: MyBotPersonaProjection[];
  growth: MyBotGrowthProjection;
  /** Read-only participation list; group editing belongs to groups tab. */
  collaborations: MyBotCollaborationProjection[];
  data: MyBotDataProjection;
  /**
   * Optional Gateway delivery metadata (aligned with robot.workspace.get).
   * `phase: 0` means Identity shell only; other blocks fill in later phases.
   */
  phase?: number;
  blocksComplete?: MyBotBlocksComplete;
};

/** List-row summary for robots tab (lazy; detail loads via robot.workspace.get). */
export type MyBotListSummary = {
  agentId: string;
  sessionKey: string;
  name: string;
  emoji: string | null;
  source: "owned" | "participating";
  lastActiveAt: number | null;
  briefStatus: MyBotBriefStatus;
  detailAvailable: boolean;
  capabilityCount?: number;
  growthLevel?: number;
  participatingGroupCount?: number;
};

/** Enterprise / mesh fields that must never appear on employee My Bot projections. */
export const MY_BOT_FORBIDDEN_MESH_KEYS = [
  "totalCost",
  "totalTokens",
  "runtimeHosts",
  "runtimeHost",
  "budgetLimit",
  "budgetStatus",
  "budgetUsedRatio",
  "governanceStatus",
  "costAttributionStatus",
] as const;

export type MyBotForbiddenMeshKey = (typeof MY_BOT_FORBIDDEN_MESH_KEYS)[number];

export function createEmptyMyBotProjection(agentId: string, name?: string): MyBotProjection {
  return {
    agentId,
    identity: {
      name: name?.trim() || agentId,
      avatar: null,
      positioning: null,
      intro: null,
      role: null,
      personaTraits: null,
      model: null,
      status: "unknown",
      createdAt: null,
    },
    capabilities: [],
    personas: [],
    growth: {
      level: 0,
      recentEvents: [],
      sources: [],
      activationScore: 0,
      operationalScore: null,
      falseReady: false,
      dimensions: { identity: 0, capability: 0, knowledge: 0, habits: 0 },
      completeness: { identity: 0, capability: 0, performance: 0, suggestion: 0 },
      capabilityGaps: [],
      recommendation: null,
      growthReport: null,
      funnel: null,
      workingStyle: null,
    },
    collaborations: [],
    data: { recentLearning: [] },
    phase: 0,
    blocksComplete: {
      identity: false,
      capabilities: false,
      personas: false,
      growth: false,
      collaborations: false,
      data: false,
    },
  };
}

/** Map skill health successRate (0–1) → 1–5 stars (plan §7.4 default). */
export function mapSuccessRateToStars(successRate: number | null | undefined): number {
  if (typeof successRate !== "number" || !Number.isFinite(successRate)) {
    return 1;
  }
  const clamped = Math.max(0, Math.min(1, successRate));
  return Math.max(1, Math.min(5, Math.round(clamped * 5)));
}

const DOMAIN_AXIS_IDS = ["research", "content", "data", "collab", "tools"] as const;

const DOMAIN_AXIS_PATTERNS: Record<(typeof DOMAIN_AXIS_IDS)[number], RegExp[]> = {
  research: [/市场|竞品|行业|研究|分析|调研|情报|战略|顾问/],
  content: [/ppt|pptx|写作|报告|文案|文档|生成|摘要|润色|内容/i],
  data: [/数据|统计|指标|表格|报表|量化|excel|csv/i],
  collab: [/协作|会议|纪要|沟通|群组|团队|排期|秘书/],
  tools: [/工具|自动化|api|脚本|执行|工作流|workflow/i],
};

const IDENTITY_TEMPLATES: Array<{
  id: string;
  label: string;
  weights: MyBotDomainVector;
}> = [
  {
    id: "analyst",
    label: "分析研究型",
    weights: { research: 1, content: 0.25, data: 0.45, collab: 0.15, tools: 0.2 },
  },
  {
    id: "content",
    label: "内容产出型",
    weights: { research: 0.25, content: 1, data: 0.2, collab: 0.25, tools: 0.2 },
  },
  {
    id: "data",
    label: "数据统计型",
    weights: { research: 0.35, content: 0.2, data: 1, collab: 0.15, tools: 0.35 },
  },
  {
    id: "collab",
    label: "协作沟通型",
    weights: { research: 0.15, content: 0.3, data: 0.15, collab: 1, tools: 0.25 },
  },
  {
    id: "tools",
    label: "工具执行型",
    weights: { research: 0.15, content: 0.15, data: 0.3, collab: 0.2, tools: 1 },
  },
];

function emptyDomainVector(): MyBotDomainVector {
  return { research: 0, content: 0, data: 0, collab: 0, tools: 0 };
}

function normalizeDomainVector(input: MyBotDomainVector): MyBotDomainVector {
  const max = Math.max(...DOMAIN_AXIS_IDS.map((id) => input[id]), 0);
  if (max <= 0) {
    return emptyDomainVector();
  }
  const out = emptyDomainVector();
  for (const id of DOMAIN_AXIS_IDS) {
    out[id] = input[id] / max;
  }
  return out;
}

function cosineSimilarity(a: MyBotDomainVector, b: MyBotDomainVector): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const id of DOMAIN_AXIS_IDS) {
    dot += a[id] * b[id];
    normA += a[id] * a[id];
    normB += b[id] * b[id];
  }
  if (normA <= 0 || normB <= 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function resolveMyBotCapabilityDomain(input: {
  name?: string | null;
  domain?: string | null;
  description?: string | null;
}): MyBotCapabilityDomainId {
  const raw = input.domain?.trim();
  if (
    raw === "research" ||
    raw === "content" ||
    raw === "data" ||
    raw === "collab" ||
    raw === "tools" ||
    raw === "general"
  ) {
    return raw;
  }
  const haystack = [input.name, input.description]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ");
  for (const id of DOMAIN_AXIS_IDS) {
    if (DOMAIN_AXIS_PATTERNS[id].some((pattern) => pattern.test(haystack))) {
      return id;
    }
  }
  return "general";
}

export function selectMasteredCapabilities(
  caps: MyBotCapabilityProjection[],
): MyBotCapabilityProjection[] {
  const hasCounts = caps.some((cap) => typeof cap.callCount === "number");
  if (!hasCounts) {
    return caps;
  }
  return caps.filter((cap) => (cap.callCount ?? 0) >= 1);
}

export function selectPendingCapabilities(
  caps: MyBotCapabilityProjection[],
): MyBotCapabilityProjection[] {
  const hasCounts = caps.some((cap) => typeof cap.callCount === "number");
  if (!hasCounts) {
    return [];
  }
  return caps.filter((cap) => (cap.callCount ?? 0) < 1);
}

export function buildCapabilityDomainCallVector(
  caps: MyBotCapabilityProjection[],
): MyBotDomainVector {
  const raw = emptyDomainVector();
  for (const cap of selectMasteredCapabilities(caps)) {
    const domain = resolveMyBotCapabilityDomain(cap);
    if (domain === "general") {
      continue;
    }
    const calls = Math.max(
      0,
      typeof cap.callCount === "number" && Number.isFinite(cap.callCount)
        ? cap.callCount
        : Math.max(1, cap.stars),
    );
    raw[domain] += Math.log1p(calls);
  }
  return normalizeDomainVector(raw);
}

export function buildInstalledDomainPreviewVector(
  caps: MyBotCapabilityProjection[],
): MyBotDomainVector {
  const raw = emptyDomainVector();
  for (const cap of caps) {
    const domain = resolveMyBotCapabilityDomain(cap);
    if (domain === "general") {
      continue;
    }
    const calls =
      typeof cap.callCount === "number" && Number.isFinite(cap.callCount)
        ? Math.max(0, cap.callCount)
        : 0;
    raw[domain] += calls >= 1 ? Math.log1p(calls) : 0.45;
  }
  return normalizeDomainVector(raw);
}

export function buildDutyDomainVector(input: {
  positioning?: string | null;
  role?: string | null;
  intro?: string | null;
}): MyBotDomainVector {
  const haystack = [input.positioning, input.role, input.intro]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ");
  const raw = emptyDomainVector();
  if (!haystack) {
    applySoftDutyPrior(raw);
    return normalizeDomainVector(raw);
  }
  for (const id of DOMAIN_AXIS_IDS) {
    if (DOMAIN_AXIS_PATTERNS[id].some((pattern) => pattern.test(haystack))) {
      raw[id] += 1;
    }
  }
  if (DOMAIN_AXIS_IDS.every((id) => raw[id] === 0)) {
    applySoftDutyPrior(raw);
  }
  return normalizeDomainVector(raw);
}

function applySoftDutyPrior(raw: MyBotDomainVector) {
  for (const id of DOMAIN_AXIS_IDS) {
    raw[id] = 0.2;
  }
}

export function computeMyBotIdentityAffinity(input: {
  identity: Pick<MyBotIdentityProjection, "positioning" | "role" | "intro">;
  capabilities: MyBotCapabilityProjection[];
}): MyBotIdentityAffinity {
  const mastered = selectMasteredCapabilities(input.capabilities);
  const pending = selectPendingCapabilities(input.capabilities);
  const evidenceCallTotal = mastered.reduce((sum, cap) => {
    if (typeof cap.callCount === "number" && Number.isFinite(cap.callCount)) {
      return sum + Math.max(0, cap.callCount);
    }
    return sum + 1;
  }, 0);
  const duty = buildDutyDomainVector(input.identity);
  const evidence = buildCapabilityDomainCallVector(input.capabilities);
  const installedHint = buildInstalledDomainPreviewVector(
    pending.length > 0 ? pending : input.capabilities,
  );
  const blended = emptyDomainVector();
  const evidenceWeight = evidenceCallTotal > 0 ? 0.65 : 0;
  const installedWeight = evidenceCallTotal > 0 ? 0 : pending.length > 0 ? 0.45 : 0;
  const dutyWeight = Math.max(0, 1 - evidenceWeight - installedWeight);
  for (const id of DOMAIN_AXIS_IDS) {
    blended[id] =
      duty[id] * dutyWeight + evidence[id] * evidenceWeight + installedHint[id] * installedWeight;
  }
  const normalized = normalizeDomainVector(blended);
  const scores = IDENTITY_TEMPLATES.map((template) => ({
    id: template.id,
    label: template.label,
    score: Math.round(cosineSimilarity(normalized, template.weights) * 100),
  })).toSorted((a, b) => b.score - a.score || a.label.localeCompare(b.label, "zh"));

  const lowConfidence =
    evidenceCallTotal < 3 &&
    !trimOptional(input.identity.positioning) &&
    !trimOptional(input.identity.role) &&
    pending.length === 0;

  return {
    primary: scores[0] && scores[0].score > 0 ? scores[0] : null,
    secondary:
      scores[1]?.score > 0 && scores[1].score >= (scores[0]?.score ?? 0) * 0.75
        ? scores[1]
        : scores[1]?.score > 0
          ? scores[1]
          : null,
    scores,
    evidenceCallTotal,
    lowConfidence,
  };
}

function trimOptional(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Runtime detail for employees is capped at three brief states (plan §3.5).
 * Channel / host / GPU detail belongs on mesh Operations only.
 */
export function toMyBotBriefStatus(input: {
  online?: boolean | null;
  degraded?: boolean | null;
  ready?: boolean | null;
}): MyBotBriefStatus {
  if (input.degraded === true) {
    return "degraded";
  }
  if (input.online === true || input.ready === true) {
    return "online";
  }
  if (input.online === false || input.ready === false) {
    return "offline";
  }
  return "unknown";
}

export function assertNoMeshFieldsOnMyBotProjection(
  value: unknown,
): asserts value is MyBotProjection {
  if (!value || typeof value !== "object") {
    throw new Error("MyBotProjection must be an object");
  }
  const record = value as Record<string, unknown>;
  for (const key of MY_BOT_FORBIDDEN_MESH_KEYS) {
    if (key in record) {
      throw new Error(`MyBotProjection must not include mesh field: ${key}`);
    }
  }
  if (record.identity && typeof record.identity === "object") {
    for (const key of MY_BOT_FORBIDDEN_MESH_KEYS) {
      if (key in (record.identity as Record<string, unknown>)) {
        throw new Error(`MyBotProjection.identity must not include mesh field: ${key}`);
      }
    }
  }
}
