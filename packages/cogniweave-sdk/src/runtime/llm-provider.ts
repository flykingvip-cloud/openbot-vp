import type {
  DistillationQuality,
  DistillationResult,
  EngineConfig,
  Scope,
  SourceType,
  TaskFrame,
} from "../models.js";
import { mergePreferFilledDistillation, readDistillationResult } from "./distillation-shape.js";
import { asStringArray, isRecord } from "./json-values.js";
import type {
  LlmDistillationProvider,
  LlmDistillationProviderInput,
  LlmTaskFramingProvider,
  LlmTaskFramingProviderInput,
} from "./strategies.js";

function asSourceType(value: unknown): SourceType | undefined {
  const allowed: SourceType[] = ["chat", "tool_log", "document", "diff", "agent_run", "external"];
  if (typeof value !== "string") {
    return undefined;
  }
  return allowed.includes(value as SourceType) ? (value as SourceType) : undefined;
}

function coerceTaskFrame(raw: unknown, fallbackScope: Scope): TaskFrame | null {
  const payload = isRecord(raw) && isRecord(raw.taskFrame) ? raw.taskFrame : raw;
  if (!isRecord(payload)) {
    return null;
  }
  const taskType = typeof payload.taskType === "string" ? payload.taskType : "";
  if (!taskType) {
    return null;
  }

  const scopePayload = isRecord(payload.scope) ? payload.scope : {};
  const scope: Scope = {
    workspaceId:
      typeof scopePayload.workspaceId === "string" && scopePayload.workspaceId.trim().length > 0
        ? scopePayload.workspaceId
        : fallbackScope.workspaceId,
    projectId:
      typeof scopePayload.projectId === "string" && scopePayload.projectId.trim().length > 0
        ? scopePayload.projectId
        : fallbackScope.projectId,
    agentId:
      typeof scopePayload.agentId === "string" && scopePayload.agentId.trim().length > 0
        ? scopePayload.agentId
        : fallbackScope.agentId,
    visibility: scopePayload.visibility === "shared" ? "shared" : fallbackScope.visibility,
  };

  return {
    id:
      typeof payload.id === "string" && payload.id.trim().length > 0
        ? payload.id
        : `tf_llm_${Date.now().toString(36)}`,
    taskType,
    scope,
    goals: asStringArray(payload.goals),
    problems: asStringArray(payload.problems),
    scenarioTags: asStringArray(payload.scenarioTags),
    constraints: asStringArray(payload.constraints),
    entities: asStringArray(payload.entities),
    requiredAtomTypes: asStringArray(payload.requiredAtomTypes),
    riskLevel: typeof payload.riskLevel === "string" ? payload.riskLevel : undefined,
    priority: typeof payload.priority === "string" ? payload.priority : undefined,
    timeHorizon: typeof payload.timeHorizon === "string" ? payload.timeHorizon : undefined,
    provenance: isRecord(payload.provenance)
      ? {
          sourceType: asSourceType(payload.provenance.sourceType),
          sourceSessionId:
            typeof payload.provenance.sourceSessionId === "string"
              ? payload.provenance.sourceSessionId
              : undefined,
          sourceTurnRange:
            Array.isArray(payload.provenance.sourceTurnRange) &&
            payload.provenance.sourceTurnRange.length === 2 &&
            typeof payload.provenance.sourceTurnRange[0] === "number" &&
            typeof payload.provenance.sourceTurnRange[1] === "number"
              ? [payload.provenance.sourceTurnRange[0], payload.provenance.sourceTurnRange[1]]
              : undefined,
          hintsApplied: asStringArray(payload.provenance.hintsApplied),
        }
      : undefined,
  };
}

function coerceDistillationResult(raw: unknown): DistillationResult | null {
  const payload = readDistillationResult(raw);
  if (!payload) {
    return null;
  }
  return {
    ...payload,
    quality: coerceDistillationQuality(payload.quality, "llm_single_call"),
  };
}

function normalizeStageDecisions(value: unknown): DistillationQuality["stageDecisions"] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized: DistillationQuality["stageDecisions"] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.stage !== "string") {
      continue;
    }
    normalized.push({
      stage: entry.stage,
      llmResponded: entry.llmResponded === true,
      usedLlmOutput: entry.usedLlmOutput === true,
      fallbackToRule: entry.fallbackToRule === true,
    });
  }
  return normalized;
}

function clampRatio(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function inferFallbackRateFromDecisions(
  stageDecisions: DistillationQuality["stageDecisions"],
): number {
  if (stageDecisions.length === 0) {
    return 0;
  }
  const fallbackCount = stageDecisions.filter((decision) => decision.fallbackToRule).length;
  return fallbackCount / stageDecisions.length;
}

function inferCoverageFromDecisions(
  stageDecisions: DistillationQuality["stageDecisions"],
  profile: DistillationQuality["profile"],
): number {
  if (stageDecisions.length === 0) {
    return profile === "rule_based" ? 1 : 0;
  }
  const responded = stageDecisions.filter((decision) => decision.llmResponded).length;
  return responded / stageDecisions.length;
}

function coerceDistillationQuality(
  raw: unknown,
  fallbackProfile: DistillationQuality["profile"],
): DistillationQuality {
  if (!isRecord(raw)) {
    const stageDecisions =
      fallbackProfile === "rule_based"
        ? [
            {
              stage: "event",
              llmResponded: false,
              usedLlmOutput: false,
              fallbackToRule: false,
            },
            {
              stage: "context",
              llmResponded: false,
              usedLlmOutput: false,
              fallbackToRule: false,
            },
            {
              stage: "atoms",
              llmResponded: false,
              usedLlmOutput: false,
              fallbackToRule: false,
            },
            {
              stage: "relations",
              llmResponded: false,
              usedLlmOutput: false,
              fallbackToRule: false,
            },
          ]
        : [
            {
              stage: "single_call",
              llmResponded: true,
              usedLlmOutput: true,
              fallbackToRule: false,
            },
          ];
    return {
      profile: fallbackProfile,
      stageCoverage: inferCoverageFromDecisions(stageDecisions, fallbackProfile),
      stageFallbackRate: inferFallbackRateFromDecisions(stageDecisions),
      stageDecisions,
    };
  }

  const profile =
    raw.profile === "rule_based" ||
    raw.profile === "llm_single_call" ||
    raw.profile === "llm_multi_call"
      ? raw.profile
      : fallbackProfile;
  const stageDecisions = normalizeStageDecisions(raw.stageDecisions);

  return {
    profile,
    stageCoverage: clampRatio(
      typeof raw.stageCoverage === "number"
        ? raw.stageCoverage
        : inferCoverageFromDecisions(stageDecisions, profile),
      inferCoverageFromDecisions(stageDecisions, profile),
    ),
    stageFallbackRate: clampRatio(
      typeof raw.stageFallbackRate === "number"
        ? raw.stageFallbackRate
        : inferFallbackRateFromDecisions(stageDecisions),
      inferFallbackRateFromDecisions(stageDecisions),
    ),
    stageDecisions,
  };
}

function mergeDistillationResults(
  current: DistillationResult,
  incoming: DistillationResult,
): DistillationResult {
  const mergedStageDecisions = new Map<string, DistillationQuality["stageDecisions"][number]>();
  for (const decision of current.quality.stageDecisions) {
    mergedStageDecisions.set(decision.stage, decision);
  }
  for (const decision of incoming.quality.stageDecisions) {
    mergedStageDecisions.set(decision.stage, decision);
  }
  const stageDecisions = [...mergedStageDecisions.values()];

  return mergePreferFilledDistillation(current, incoming, {
    profile:
      incoming.quality.profile === "llm_multi_call"
        ? "llm_multi_call"
        : current.quality.profile === "llm_multi_call"
          ? "llm_multi_call"
          : incoming.quality.profile,
    stageCoverage: inferCoverageFromDecisions(stageDecisions, incoming.quality.profile),
    stageFallbackRate: inferFallbackRateFromDecisions(stageDecisions),
    stageDecisions,
  });
}

async function requestDistillation(
  options: {
    endpoint: string;
    apiKey?: string;
    model?: string;
    timeoutMs: number;
  },
  input: LlmDistillationProviderInput,
  extraMetadata?: Record<string, string>,
): Promise<DistillationResult | null> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(options.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
      },
      body: JSON.stringify({
        rawInput: input.rawInput,
        scope: input.scope,
        sourceType: input.sourceType,
        sourceSessionId: input.sourceSessionId,
        sourceTurnRange: input.sourceTurnRange,
        metadata: {
          ...(input.metadata ?? {}),
          ...(extraMetadata ?? {}),
        },
        forceRebuild: input.forceRebuild === true,
        ...(options.model ? { model: options.model } : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    return coerceDistillationResult(payload);
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export interface HttpTaskFramingProviderOptions {
  endpoint: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

export class HttpTaskFramingProvider implements LlmTaskFramingProvider {
  private readonly endpoint: string;
  private readonly apiKey?: string;
  private readonly model?: string;
  private readonly timeoutMs: number;

  constructor(options: HttpTaskFramingProviderOptions) {
    this.endpoint = options.endpoint;
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 3000;
  }

  async frame(input: LlmTaskFramingProviderInput): Promise<TaskFrame | null> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          rawInput: input.rawInput,
          scope: input.scope,
          hints: input.hints ?? {},
          ...(this.model ? { model: this.model } : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        return null;
      }

      const payload = await response.json();
      return coerceTaskFrame(payload, input.scope);
    } catch {
      return null;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}

export interface HttpDistillationProviderOptions {
  endpoint: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

export class HttpDistillationProvider implements LlmDistillationProvider {
  private readonly endpoint: string;
  private readonly apiKey?: string;
  private readonly model?: string;
  private readonly timeoutMs: number;

  constructor(options: HttpDistillationProviderOptions) {
    this.endpoint = options.endpoint;
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 6000;
  }

  async distill(input: LlmDistillationProviderInput): Promise<DistillationResult | null> {
    const result = await requestDistillation(
      {
        endpoint: this.endpoint,
        apiKey: this.apiKey,
        model: this.model,
        timeoutMs: this.timeoutMs,
      },
      input,
    );
    if (!result) {
      return null;
    }
    return {
      ...result,
      quality: coerceDistillationQuality(result.quality, "llm_single_call"),
    };
  }
}

export interface MultiCallHttpDistillationProviderOptions extends HttpDistillationProviderOptions {
  stages?: string[];
}

const DEFAULT_DISTILLATION_STAGES = ["event", "context", "atoms", "relations"] as const;

export class MultiCallHttpDistillationProvider implements LlmDistillationProvider {
  private readonly endpoint: string;
  private readonly apiKey?: string;
  private readonly model?: string;
  private readonly timeoutMs: number;
  private readonly stages: string[];

  constructor(options: MultiCallHttpDistillationProviderOptions) {
    this.endpoint = options.endpoint;
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 6000;
    this.stages =
      options.stages && options.stages.length > 0
        ? options.stages
        : [...DEFAULT_DISTILLATION_STAGES];
  }

  async distill(input: LlmDistillationProviderInput): Promise<DistillationResult | null> {
    let merged: DistillationResult | null = null;
    const stageDecisions: DistillationQuality["stageDecisions"] = [];
    for (const stage of this.stages) {
      const stageResult = await requestDistillation(
        {
          endpoint: this.endpoint,
          apiKey: this.apiKey,
          model: this.model,
          timeoutMs: this.timeoutMs,
        },
        input,
        {
          __distill_profile: "multi_call",
          __distill_stage: stage,
        },
      );
      if (!stageResult) {
        stageDecisions.push({
          stage,
          llmResponded: false,
          usedLlmOutput: false,
          fallbackToRule: true,
        });
        continue;
      }
      stageDecisions.push({
        stage,
        llmResponded: true,
        usedLlmOutput: true,
        fallbackToRule: false,
      });
      merged = merged ? mergeDistillationResults(merged, stageResult) : stageResult;
    }
    if (!merged) {
      return null;
    }
    const stageCoverage = inferCoverageFromDecisions(stageDecisions, "llm_multi_call");
    return {
      ...merged,
      quality: {
        profile: "llm_multi_call",
        stageCoverage,
        stageFallbackRate: inferFallbackRateFromDecisions(stageDecisions),
        stageDecisions,
      },
    };
  }
}

export function createHttpTaskFramingProvider(
  config: EngineConfig,
): LlmTaskFramingProvider | undefined {
  if (config.enableLlmTaskFraming === false) {
    return undefined;
  }
  if (!config.llmTaskFramingEndpoint) {
    return undefined;
  }
  return new HttpTaskFramingProvider({
    endpoint: config.llmTaskFramingEndpoint,
    apiKey: config.llmTaskFramingApiKey,
    model: config.llmTaskFramingModel,
    timeoutMs: config.llmRequestTimeoutMs,
  });
}

export function createHttpDistillationProvider(
  config: EngineConfig,
): LlmDistillationProvider | undefined {
  if (config.enableLlmDistillation === false) {
    return undefined;
  }
  if (!config.llmDistillationEndpoint) {
    return undefined;
  }
  const common = {
    endpoint: config.llmDistillationEndpoint,
    apiKey: config.llmDistillationApiKey,
    model: config.llmDistillationModel,
    timeoutMs: config.llmRequestTimeoutMs,
  };
  if (config.llmDistillationProfile === "multi_call") {
    return new MultiCallHttpDistillationProvider({
      ...common,
      stages: config.llmDistillationStages,
    });
  }
  return new HttpDistillationProvider(common);
}
