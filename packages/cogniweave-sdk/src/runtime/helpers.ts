import { createHash, randomUUID } from "node:crypto";
import { withAtomV2Defaults } from "../domain/atom-v2.js";
import {
  computeDedupKey,
  computeEntityKey,
  computeEventKey,
  computeIngestionChecksum,
  computeProblemKey,
  computeScenarioKey,
  normalizeClaim,
  normalizeTrigger,
} from "../keys.js";
import type {
  DistillationKeys,
  DistillationResult,
  EngineConfig,
  EventSkeleton,
  EvidenceRecord,
  MemoryAtom,
  MemoryAtomClaim,
  PackageAnswer,
  ProblemRecord,
  RelationRecord,
  Scope,
  ScopeInput,
  ScenarioRecord,
  SourceType,
  TaskFrame,
  TaskType,
  WritePlan,
} from "../models.js";
import { resolveScope } from "../scope.js";
import { asStringArray } from "./json-values.js";

function tokenize(text: string): string[] {
  return normalizeClaim(text)
    .split("_")
    .map((token) => token.trim())
    .filter(Boolean);
}

function stableId(prefix: string, source: string): string {
  return `${prefix}_${createHash("sha256").update(source).digest("hex").slice(0, 16)}`;
}

export function extractText(rawInput: string | Record<string, unknown>): string {
  if (typeof rawInput === "string") {
    return rawInput;
  }
  return JSON.stringify(rawInput);
}

export function createId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

interface RawEventChunk {
  text: string;
  turns: number[];
  toolCalls: string[];
  metadata: Record<string, string>;
}

interface ContextFrame {
  problems: string[];
  signals: string[];
  environment: string[];
  entities: string[];
  scenarios: string[];
  constraints: string[];
}

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
}

function normalizeTagList(values: string[]): string[] {
  return [...new Set(values.map((value) => normalizeClaim(value)).filter(Boolean))].sort();
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function buildTurnRange(range?: [number, number]): number[] {
  if (!range) {
    return [];
  }
  const [start, end] = range;
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) {
    return [];
  }
  const turns: number[] = [];
  for (let index = start; index <= end; index += 1) {
    turns.push(index);
  }
  return turns;
}

function segmentRawInput(input: {
  rawInput: string | Record<string, unknown>;
  sourceType: SourceType;
  sourceSessionId?: string;
  sourceTurnRange?: [number, number];
  metadata?: Record<string, string>;
}): RawEventChunk {
  const turns = buildTurnRange(input.sourceTurnRange);
  if (typeof input.rawInput === "string") {
    return {
      text: input.rawInput,
      turns,
      toolCalls: [],
      metadata: {
        sourceType: input.sourceType,
        sourceSessionId: input.sourceSessionId ?? "",
        ...input.metadata,
      },
    };
  }

  const payload = input.rawInput;
  const textCandidates = [
    typeof payload.text === "string" ? payload.text : "",
    typeof payload.content === "string" ? payload.content : "",
    typeof payload.message === "string" ? payload.message : "",
    typeof payload.diff === "string" ? payload.diff : "",
  ].filter(Boolean);
  const payloadTurns = asNumberArray(payload.turns);

  return {
    text: textCandidates[0] ?? extractText(payload),
    turns: payloadTurns.length > 0 ? payloadTurns : turns,
    toolCalls: asStringArray(payload.tool_calls ?? payload.toolCalls),
    metadata: {
      sourceType: input.sourceType,
      sourceSessionId: input.sourceSessionId ?? "",
      ...input.metadata,
    },
  };
}

export function inferTaskType(text: string, hintTaskType?: string): TaskType {
  if (hintTaskType) {
    return hintTaskType;
  }

  const haystack = text.toLowerCase();
  if (/support|ticket|customer|客服|客户|工单|支持|偏好|沟通/.test(haystack)) {
    return "support";
  }
  if (/research|investigate|compare|survey|研究|调研|分析|对比|模式/.test(haystack)) {
    return "research";
  }
  if (/plan|roadmap|milestone|next step|计划|规划|方案|里程碑|回滚|灰度|发布/.test(haystack)) {
    return "planning";
  }
  if (/negotiate|pricing|deal|renewal|谈判|报价|续约/.test(haystack)) {
    return "negotiation";
  }
  if (/write|draft|article|copy|写作|撰写|文案|文章|草稿/.test(haystack)) {
    return "writing";
  }
  if (/operations|runbook|playbook|alert|oncall|运维|运行|值班|告警|手册/.test(haystack)) {
    return "operations";
  }
  if (
    /debug|error|fail|latency|throughput|incident|timeout|retry|queue|bug|drop|调试|故障|报错|错误|延迟|超时|吞吐|阻塞|重试|幂等|重复执行|同步/.test(
      haystack,
    )
  ) {
    return "debugging";
  }
  return "operations";
}

function extractEntities(
  text: string,
  scope: Scope,
): Array<{ id: string; name: string; entityType: string; tags: string[]; scope: Scope }> {
  const candidates = [
    {
      pattern: /external api|third[- ]party api/,
      name: "external_api",
      entityType: "service",
      tags: ["external"],
    },
    {
      pattern: /worker pipeline|pipeline/,
      name: "worker_pipeline",
      entityType: "system",
      tags: ["pipeline"],
    },
    { pattern: /queue|job queue/, name: "queue", entityType: "component", tags: ["queue"] },
    { pattern: /database|db/, name: "database", entityType: "service", tags: ["storage"] },
    { pattern: /cache/, name: "cache", entityType: "service", tags: ["cache"] },
  ];

  return candidates
    .filter((candidate) => candidate.pattern.test(text.toLowerCase()))
    .map((candidate) => ({
      id: createId("ent"),
      name: candidate.name,
      entityType: candidate.entityType,
      tags: candidate.tags,
      scope,
    }));
}

function extractScenarios(text: string, scope: Scope): ScenarioRecord[] {
  const scenarios: ScenarioRecord[] = [];
  const haystack = text.toLowerCase();

  if (/high latency|slow|timeout|external api very slow/.test(haystack)) {
    scenarios.push({
      id: createId("scn"),
      name: "high_latency_environment",
      tags: ["latency", "performance"],
      summary: "External latency is elevated and impacts execution flow.",
      scope,
      provenance: { sourceEventIds: [], evidenceRefs: [] },
    });
  }

  if (/throughput drop|throughput下降|吞吐下降/.test(text)) {
    scenarios.push({
      id: createId("scn"),
      name: "throughput_drop",
      tags: ["throughput", "degradation"],
      summary: "Observed throughput degradation under current workload.",
      scope,
      provenance: { sourceEventIds: [], evidenceRefs: [] },
    });
  }

  return scenarios.map((scenario) => ({
    ...scenario,
    scenarioKey: computeScenarioKey(scenario),
  }));
}

function extractProblems(text: string, scope: Scope): ProblemRecord[] {
  const problems: ProblemRecord[] = [];
  const haystack = text.toLowerCase();

  if (/throughput drop|吞吐下降/.test(text)) {
    problems.push({
      id: createId("prb"),
      statement: "throughput drop",
      normalizedStatement: "throughput_drop",
      tags: ["throughput", "performance"],
      scope,
      provenance: { sourceEventIds: [], evidenceRefs: [] },
    });
  }

  if (/retry|重试/.test(text) && /sync|同步/.test(text)) {
    problems.push({
      id: createId("prb"),
      statement: "synchronous retries under latency",
      normalizedStatement: "sync_retry_under_latency",
      tags: ["retry", "latency"],
      scope,
      provenance: { sourceEventIds: [], evidenceRefs: [] },
    });
  }

  if (
    (/重复执行|幂等|idempotent/.test(text) && /sync|同步/.test(text)) ||
    /retry safety/.test(haystack)
  ) {
    problems.push({
      id: createId("prb"),
      statement: "retry safety and idempotency guard",
      normalizedStatement: "retry_safety_idempotency_guard",
      tags: ["retry", "idempotency", "correctness"],
      scope,
      provenance: { sourceEventIds: [], evidenceRefs: [] },
    });
  }

  if (/告警|alert/.test(text) && /误报|false[- ]?positive/.test(haystack)) {
    problems.push({
      id: createId("prb"),
      statement: "alert false positive noise",
      normalizedStatement: "alert_false_positive_noise",
      tags: ["alerting", "noise"],
      scope,
      provenance: { sourceEventIds: [], evidenceRefs: [] },
    });
  }

  if (/偏好|preference/.test(text) && /客户|customer/.test(haystack)) {
    problems.push({
      id: createId("prb"),
      statement: "customer communication preference alignment",
      normalizedStatement: "customer_preference_alignment",
      tags: ["support", "preference"],
      scope,
      provenance: { sourceEventIds: [], evidenceRefs: [] },
    });
  }

  return problems.map((problem) => ({
    ...problem,
    problemKey: computeProblemKey(problem),
  }));
}

function inferGoal(text: string): string {
  if (/throughput drop|吞吐下降/.test(text)) {
    return "restore throughput";
  }
  if (/slow|latency|timeout/.test(text.toLowerCase())) {
    return "stabilize system behavior under latency";
  }
  return text.split(/[.?!。！？]/, 1)[0]?.trim() || "understand and respond to the task";
}

function inferConstraints(text: string): string[] {
  const constraints: string[] = [];
  const haystack = text.toLowerCase();
  if (/correctness|正确性|idempotent|幂等|重复执行/.test(text)) {
    constraints.push("maintain_correctness");
  }
  if (/without downtime|不停机|不中断/.test(text)) {
    constraints.push("no_downtime");
  }
  if (/latency|延迟|超时/.test(haystack)) {
    constraints.push("external_latency_present");
  }
  if (/rollback|回滚/.test(haystack)) {
    constraints.push("rollback_ready");
  }
  return constraints;
}

function inferSignals(text: string): string[] {
  const signals: string[] = [];
  const haystack = text.toLowerCase();
  if (/latency|slow|timeout|延迟|超时/.test(haystack)) {
    signals.push("high_latency");
  }
  if (/throughput drop|throughput下降|吞吐下降/.test(text)) {
    signals.push("throughput_drop");
  }
  if (/sync|同步/.test(text) && /retry|重试/.test(text)) {
    signals.push("sync_retry_risk");
  }
  if (/idempotent|幂等|重复执行/.test(text)) {
    signals.push("idempotency_risk");
  }
  if (/alert|告警/.test(haystack) && /false[- ]?positive|误报/.test(haystack)) {
    signals.push("alert_noise");
  }
  return normalizeTagList(signals);
}

function inferEnvironment(text: string): string[] {
  const environment: string[] = [];
  const haystack = text.toLowerCase();
  if (/external api|third[- ]party api/.test(haystack)) {
    environment.push("external_api");
  }
  if (/worker pipeline|pipeline/.test(haystack)) {
    environment.push("worker_pipeline");
  }
  if (/queue/.test(haystack)) {
    environment.push("queue");
  }
  return normalizeTagList(environment);
}

function buildContextFrame(text: string, scope: Scope): ContextFrame {
  return {
    problems: normalizeTagList(
      extractProblems(text, scope).map((problem) => problem.normalizedStatement),
    ),
    signals: inferSignals(text),
    environment: inferEnvironment(text),
    entities: normalizeTagList(extractEntities(text, scope).map((entity) => entity.name)),
    scenarios: normalizeTagList(extractScenarios(text, scope).map((scenario) => scenario.name)),
    constraints: normalizeTagList(inferConstraints(text)),
  };
}

function buildEvidence(
  rawInput: string | Record<string, unknown>,
  scope: Scope,
  sourceType: SourceType,
  sourceSessionId?: string,
  sourceTurnRange?: [number, number],
  metadata?: Record<string, string>,
): EvidenceRecord[] {
  const text = extractText(rawInput);
  const checksum = computeIngestionChecksum(rawInput, metadata);
  const evidenceId = stableId(
    "evd",
    [scope.workspaceId, scope.projectId, scope.agentId, checksum].join("|"),
  );
  return [
    {
      id: evidenceId,
      type: sourceType,
      uri: sourceSessionId ? `${sourceType}://${sourceSessionId}` : `${sourceType}://local`,
      snippet: text.slice(0, 280),
      timestamp: new Date().toISOString(),
      trustScore: 0.5,
      scope,
      checksum,
      locator: {
        turnRange: sourceTurnRange,
        messageIds: [],
        toolCallIds: [],
      },
    },
  ];
}

function buildAtomClaim(statement: string): MemoryAtomClaim {
  return {
    type: "causal",
    statement,
  };
}

function buildAtoms(
  text: string,
  scope: Scope,
  evidenceRefs: string[],
  eventId: string,
): MemoryAtom[] {
  const atoms: MemoryAtom[] = [];
  const haystack = text.toLowerCase();

  if (/sync|同步/.test(text) && /latency|slow|timeout|延迟|超时/.test(haystack)) {
    atoms.push({
      id: createId("atm"),
      atomType: "failure_pattern",
      scope,
      claim: buildAtomClaim(
        "Synchronous calls under high latency can amplify blocking and reduce throughput.",
      ),
      trigger: {
        conditions: ["high_latency", "sync_call"],
        contextTags: ["performance", "io_bound"],
      },
      applicability: {
        include: ["io_bound_system"],
        exclude: [],
      },
      provenance: {
        sourceEventIds: [eventId],
        evidenceRefs,
      },
      versioning: { version: 1 },
      state: { status: "active", conflictsWith: [] },
      metrics: { confidence: 0.7, reuseCount: 0 },
    });
  }

  if (/retry|重试/.test(text) && /sync|同步/.test(text)) {
    atoms.push({
      id: createId("atm"),
      atomType: "anti_pattern",
      scope,
      claim: buildAtomClaim(
        "Synchronous retry loops should be avoided when upstream latency is already elevated.",
      ),
      trigger: {
        conditions: ["sync_retry", "high_latency"],
        contextTags: ["reliability"],
      },
      applicability: {
        include: ["worker_pipeline"],
        exclude: [],
      },
      provenance: {
        sourceEventIds: [eventId],
        evidenceRefs,
      },
      versioning: { version: 1 },
      state: { status: "active", conflictsWith: [] },
      metrics: { confidence: 0.72, reuseCount: 0 },
    });
  }

  if (
    /async|异步|batch|批处理/.test(text) ||
    /是否应该加同步重试|应该如何处理|如何处理|怎么处理/.test(text)
  ) {
    atoms.push({
      id: createId("atm"),
      atomType: "strategy",
      scope,
      claim: buildAtomClaim(
        "Prefer asynchronous buffering or batching instead of synchronous retries when latency is high.",
      ),
      trigger: {
        conditions: ["high_latency"],
        contextTags: ["mitigation"],
      },
      action: { recommendation: "async_buffering" },
      applicability: {
        include: ["external_api", "worker_pipeline"],
        exclude: [],
      },
      provenance: {
        sourceEventIds: [eventId],
        evidenceRefs,
      },
      versioning: { version: 1 },
      state: { status: "active", conflictsWith: [] },
      metrics: { confidence: 0.68, reuseCount: 0 },
    });
  }

  if (
    /sync|同步/.test(text) &&
    (/retry|重试/.test(text) || /idempotent|幂等|重复执行/.test(text))
  ) {
    atoms.push({
      id: createId("atm"),
      atomType: "constraint",
      scope,
      claim: {
        type: "policy",
        statement: "Require idempotency safeguards before enabling retry-based recovery paths.",
      },
      trigger: {
        conditions: ["retry_enabled", "state_mutation_possible"],
        contextTags: ["correctness"],
      },
      applicability: {
        include: ["api_integration", "worker_pipeline"],
        exclude: [],
      },
      provenance: {
        sourceEventIds: [eventId],
        evidenceRefs,
      },
      versioning: { version: 1 },
      state: { status: "active", conflictsWith: [] },
      metrics: { confidence: 0.74, reuseCount: 0 },
    });
    if (/idempotent|幂等|重复执行/.test(text)) {
      atoms.push({
        id: createId("atm"),
        atomType: "heuristic",
        scope,
        claim: {
          type: "heuristic",
          statement:
            "Introduce idempotency keys and dedup guards before enabling asynchronous retry flows.",
        },
        trigger: {
          conditions: ["async_migration", "duplicate_execution_risk"],
          contextTags: ["migration", "correctness"],
        },
        applicability: {
          include: ["api_integration", "worker_pipeline"],
          exclude: [],
        },
        provenance: {
          sourceEventIds: [eventId],
          evidenceRefs,
        },
        versioning: { version: 1 },
        state: { status: "active", conflictsWith: [] },
        metrics: { confidence: 0.7, reuseCount: 0 },
      });
    }
  }

  if (/灰度|发布|release|cutover/.test(text.toLowerCase())) {
    atoms.push({
      id: createId("atm"),
      atomType: "strategy",
      scope,
      claim: buildAtomClaim(
        "Use staged rollout with explicit rollback checkpoints for production changes.",
      ),
      trigger: {
        conditions: ["release_change", "production_risk"],
        contextTags: ["planning", "reliability"],
      },
      action: { recommendation: "staged_rollout_with_gates" },
      applicability: {
        include: ["service_release"],
        exclude: [],
      },
      provenance: {
        sourceEventIds: [eventId],
        evidenceRefs,
      },
      versioning: { version: 1 },
      state: { status: "active", conflictsWith: [] },
      metrics: { confidence: 0.66, reuseCount: 0 },
    });
    atoms.push({
      id: createId("atm"),
      atomType: "constraint",
      scope,
      claim: {
        type: "policy",
        statement: "Define rollback trigger thresholds before starting rollout.",
      },
      trigger: {
        conditions: ["production_deploy"],
        contextTags: ["safety"],
      },
      applicability: {
        include: ["service_release"],
        exclude: [],
      },
      provenance: {
        sourceEventIds: [eventId],
        evidenceRefs,
      },
      versioning: { version: 1 },
      state: { status: "active", conflictsWith: [] },
      metrics: { confidence: 0.7, reuseCount: 0 },
    });
  }

  if (/研究|调研|research|failure pattern|故障模式/.test(text.toLowerCase())) {
    atoms.push({
      id: createId("atm"),
      atomType: "problem_pattern",
      scope,
      claim: buildAtomClaim(
        "Repeated incidents often cluster around latency-sensitive integration boundaries.",
      ),
      trigger: {
        conditions: ["incident_repetition"],
        contextTags: ["analysis", "pattern"],
      },
      applicability: {
        include: ["incident_analysis"],
        exclude: [],
      },
      provenance: {
        sourceEventIds: [eventId],
        evidenceRefs,
      },
      versioning: { version: 1 },
      state: { status: "active", conflictsWith: [] },
      metrics: { confidence: 0.6, reuseCount: 0 },
    });
    atoms.push({
      id: createId("atm"),
      atomType: "strategy",
      scope,
      claim: buildAtomClaim(
        "Cluster failures by trigger and outcome before selecting mitigation strategy.",
      ),
      trigger: {
        conditions: ["incident_dataset_available"],
        contextTags: ["research"],
      },
      applicability: {
        include: ["incident_review"],
        exclude: [],
      },
      provenance: {
        sourceEventIds: [eventId],
        evidenceRefs,
      },
      versioning: { version: 1 },
      state: { status: "active", conflictsWith: [] },
      metrics: { confidence: 0.62, reuseCount: 0 },
    });
    atoms.push({
      id: createId("atm"),
      atomType: "failure_pattern",
      scope,
      claim: buildAtomClaim(
        "Recurring failures usually reflect unstable triggers that were not isolated in prior mitigations.",
      ),
      trigger: {
        conditions: ["repeated_failures", "missing_trigger_isolation"],
        contextTags: ["research", "incident_analysis"],
      },
      applicability: {
        include: ["incident_review"],
        exclude: [],
      },
      provenance: {
        sourceEventIds: [eventId],
        evidenceRefs,
      },
      versioning: { version: 1 },
      state: { status: "active", conflictsWith: [] },
      metrics: { confidence: 0.64, reuseCount: 0 },
    });
  }

  if (/客户|customer/.test(text.toLowerCase()) && /偏好|preference/.test(text.toLowerCase())) {
    atoms.push({
      id: createId("atm"),
      atomType: "preference",
      scope,
      claim: {
        type: "preference",
        statement: "Customer prefers reliability evidence before feature discussion.",
      },
      trigger: {
        conditions: ["customer_update"],
        contextTags: ["support", "communication"],
      },
      applicability: {
        include: ["customer_success"],
        exclude: [],
      },
      provenance: {
        sourceEventIds: [eventId],
        evidenceRefs,
      },
      versioning: { version: 1 },
      state: { status: "active", conflictsWith: [] },
      metrics: { confidence: 0.73, reuseCount: 0 },
    });
    atoms.push({
      id: createId("atm"),
      atomType: "strategy",
      scope,
      claim: buildAtomClaim(
        "Start conversation with stability metrics, then transition to feature roadmap.",
      ),
      trigger: {
        conditions: ["customer_preference_known"],
        contextTags: ["support"],
      },
      applicability: {
        include: ["customer_review"],
        exclude: [],
      },
      provenance: {
        sourceEventIds: [eventId],
        evidenceRefs,
      },
      versioning: { version: 1 },
      state: { status: "active", conflictsWith: [] },
      metrics: { confidence: 0.67, reuseCount: 0 },
    });
    atoms.push({
      id: createId("atm"),
      atomType: "constraint",
      scope,
      claim: {
        type: "policy",
        statement:
          "For this customer, do not lead with feature pitch before presenting stability evidence.",
      },
      trigger: {
        conditions: ["customer_update"],
        contextTags: ["support", "communication_policy"],
      },
      applicability: {
        include: ["customer_success"],
        exclude: [],
      },
      provenance: {
        sourceEventIds: [eventId],
        evidenceRefs,
      },
      versioning: { version: 1 },
      state: { status: "active", conflictsWith: [] },
      metrics: { confidence: 0.71, reuseCount: 0 },
    });
  }

  if (
    /值班|oncall|告警|alert/.test(text.toLowerCase()) &&
    /误报|false[- ]?positive/.test(text.toLowerCase())
  ) {
    atoms.push({
      id: createId("atm"),
      atomType: "failure_pattern",
      scope,
      claim: buildAtomClaim(
        "High alert false-positive rates reduce operator response quality over time.",
      ),
      trigger: {
        conditions: ["high_false_positive_rate"],
        contextTags: ["operations", "alerting"],
      },
      applicability: {
        include: ["incident_response"],
        exclude: [],
      },
      provenance: {
        sourceEventIds: [eventId],
        evidenceRefs,
      },
      versioning: { version: 1 },
      state: { status: "active", conflictsWith: [] },
      metrics: { confidence: 0.69, reuseCount: 0 },
    });
    atoms.push({
      id: createId("atm"),
      atomType: "heuristic",
      scope,
      claim: {
        type: "heuristic",
        statement:
          "Tune alert thresholds and deduplicate noisy signatures before adding new alerts.",
      },
      trigger: {
        conditions: ["oncall_noise"],
        contextTags: ["operations"],
      },
      applicability: {
        include: ["alert_management"],
        exclude: [],
      },
      provenance: {
        sourceEventIds: [eventId],
        evidenceRefs,
      },
      versioning: { version: 1 },
      state: { status: "active", conflictsWith: [] },
      metrics: { confidence: 0.65, reuseCount: 0 },
    });
    atoms.push({
      id: createId("atm"),
      atomType: "strategy",
      scope,
      claim: buildAtomClaim(
        "Adopt a weekly alert-noise reduction loop and update the runbook with verified remediation paths.",
      ),
      trigger: {
        conditions: ["oncall_noise", "runbook_update_needed"],
        contextTags: ["operations", "continuous_improvement"],
      },
      applicability: {
        include: ["incident_response", "operations_playbook"],
        exclude: [],
      },
      provenance: {
        sourceEventIds: [eventId],
        evidenceRefs,
      },
      versioning: { version: 1 },
      state: { status: "active", conflictsWith: [] },
      metrics: { confidence: 0.68, reuseCount: 0 },
    });
  }

  return atoms.map((atom) => withAtomV2Defaults(atom));
}

function normalizeAtomCandidate(atom: MemoryAtom): MemoryAtom {
  const normalizedClaim = atom.claim.statement.trim().replace(/\s+/g, " ");
  const normalizedConditions = normalizeTagList(atom.trigger.conditions);
  const normalizedContextTags = normalizeTagList(atom.trigger.contextTags);
  const mergedTriggerTokens = normalizeTrigger({
    conditions: normalizedConditions,
    contextTags: normalizedContextTags,
  });
  const triggerConditions =
    normalizedConditions.length > 0 ? normalizedConditions : mergedTriggerTokens;

  const normalized: MemoryAtom = {
    ...atom,
    claim: {
      ...atom.claim,
      statement:
        normalizedClaim.length > 0 ? normalizedClaim : "derived_pattern_requires_verification",
    },
    trigger: {
      conditions: triggerConditions,
      contextTags: normalizedContextTags,
    },
    applicability: {
      include: normalizeTagList(atom.applicability.include),
      exclude: normalizeTagList(atom.applicability.exclude),
    },
    provenance: {
      sourceEventIds: [...new Set(atom.provenance.sourceEventIds)],
      evidenceRefs: [...new Set(atom.provenance.evidenceRefs)],
    },
    metrics: {
      ...atom.metrics,
      confidence: clampConfidence(atom.metrics.confidence),
    },
  };

  return {
    ...normalized,
    dedupKey: computeDedupKey(normalized),
  };
}

function repairAtomCandidate(atom: MemoryAtom, context: ContextFrame): MemoryAtom {
  const hasTrigger = atom.trigger.conditions.length > 0 || atom.trigger.contextTags.length > 0;
  const fallbackConditions = context.signals.slice(0, 1);
  const fallbackContextTags =
    context.scenarios.slice(0, 1).length > 0 ? context.scenarios.slice(0, 1) : ["general_context"];
  const repairedTrigger = hasTrigger
    ? atom.trigger
    : {
        conditions: fallbackConditions,
        contextTags: fallbackContextTags,
      };
  const repairedApplicability =
    atom.applicability.include.length > 0
      ? atom.applicability
      : {
          include:
            [...context.entities, ...context.environment].slice(0, 1).length > 0
              ? [...context.entities, ...context.environment].slice(0, 1)
              : ["general_scope"],
          exclude: atom.applicability.exclude,
        };

  const downgradedStatus =
    atom.metrics.confidence < 0.45 && atom.state.status === "active"
      ? "tentative"
      : atom.state.status;

  const repaired: MemoryAtom = {
    ...atom,
    trigger: repairedTrigger,
    applicability: repairedApplicability,
    state: {
      ...atom.state,
      status: downgradedStatus,
      conflictsWith: [...new Set(atom.state.conflictsWith)],
    },
    metrics: {
      ...atom.metrics,
      confidence: clampConfidence(atom.metrics.confidence),
    },
  };

  return {
    ...repaired,
    dedupKey: computeDedupKey(repaired),
  };
}

function deduplicateAtomCandidates(atoms: MemoryAtom[]): MemoryAtom[] {
  const dedupMap = new Map<string, MemoryAtom>();
  for (const atom of atoms) {
    const dedupKey = atom.dedupKey ?? computeDedupKey(atom);
    const existing = dedupMap.get(dedupKey);
    if (!existing) {
      dedupMap.set(dedupKey, atom);
      continue;
    }

    const primary = existing.metrics.confidence >= atom.metrics.confidence ? existing : atom;
    const secondary = primary.id === existing.id ? atom : existing;
    const merged: MemoryAtom = {
      ...primary,
      trigger: {
        conditions: normalizeTagList([
          ...primary.trigger.conditions,
          ...secondary.trigger.conditions,
        ]),
        contextTags: normalizeTagList([
          ...primary.trigger.contextTags,
          ...secondary.trigger.contextTags,
        ]),
      },
      applicability: {
        include: normalizeTagList([
          ...primary.applicability.include,
          ...secondary.applicability.include,
        ]),
        exclude: normalizeTagList([
          ...primary.applicability.exclude,
          ...secondary.applicability.exclude,
        ]),
      },
      provenance: {
        sourceEventIds: [
          ...new Set([
            ...primary.provenance.sourceEventIds,
            ...secondary.provenance.sourceEventIds,
          ]),
        ],
        evidenceRefs: [
          ...new Set([...primary.provenance.evidenceRefs, ...secondary.provenance.evidenceRefs]),
        ],
      },
      state: {
        ...primary.state,
        status:
          primary.state.status === "conflicted" || secondary.state.status === "conflicted"
            ? "conflicted"
            : primary.state.status,
        conflictsWith: [
          ...new Set([...primary.state.conflictsWith, ...secondary.state.conflictsWith]),
        ],
      },
      metrics: {
        confidence: Math.max(primary.metrics.confidence, secondary.metrics.confidence),
        reuseCount: Math.max(primary.metrics.reuseCount, secondary.metrics.reuseCount),
      },
    };
    dedupMap.set(dedupKey, {
      ...merged,
      dedupKey: computeDedupKey(merged),
    });
  }

  return [...dedupMap.values()];
}

function normalizeAndRepairAtoms(atoms: MemoryAtom[], context: ContextFrame): MemoryAtom[] {
  const normalized = atoms.map((atom) =>
    repairAtomCandidate(normalizeAtomCandidate(atom), context),
  );
  return deduplicateAtomCandidates(normalized);
}

function buildRelations(
  atoms: MemoryAtom[],
  entities: Array<{ id: string; name: string }>,
  scenarios: ScenarioRecord[],
  problems: ProblemRecord[],
  scope: Scope,
): RelationRecord[] {
  const relations: RelationRecord[] = [];

  for (const problem of problems) {
    for (const atom of atoms.filter((candidate) => candidate.atomType === "failure_pattern")) {
      relations.push({
        id: createId("rel"),
        fromId: atom.id,
        fromNodeType: "MemoryAtom",
        relationType: "INSTANTIATED_IN",
        toId: problem.id,
        toNodeType: "Problem",
        scope,
        confidence: 0.8,
        status: "active",
        provenance: atom.provenance,
      });
    }
  }

  for (const scenario of scenarios) {
    for (const atom of atoms.filter((candidate) => candidate.atomType === "failure_pattern")) {
      relations.push({
        id: createId("rel"),
        fromId: atom.id,
        fromNodeType: "MemoryAtom",
        relationType: "TRIGGERED_BY",
        toId: scenario.id,
        toNodeType: "Scenario",
        scope,
        confidence: 0.75,
        status: "active",
        provenance: atom.provenance,
      });
    }
  }

  for (const entity of entities) {
    for (const atom of atoms.filter((candidate) => candidate.atomType !== "preference")) {
      const includesEntity = atom.applicability.include.includes(entity.name);
      if (!includesEntity) {
        continue;
      }
      relations.push({
        id: createId("rel"),
        fromId: atom.id,
        fromNodeType: "MemoryAtom",
        relationType: "APPLIES_TO",
        toId: entity.id,
        toNodeType: "Entity",
        scope,
        confidence: 0.72,
        status: "active",
        provenance: atom.provenance,
      });
    }
  }

  const strategyAtoms = atoms.filter((atom) => atom.atomType === "strategy");
  const mitigableAtoms = atoms.filter((atom) =>
    ["failure_pattern", "problem_pattern", "anti_pattern"].includes(atom.atomType),
  );
  for (const strategy of strategyAtoms) {
    for (const targetAtom of mitigableAtoms) {
      if (strategy.id === targetAtom.id) {
        continue;
      }
      relations.push({
        id: createId("rel"),
        fromId: strategy.id,
        fromNodeType: "MemoryAtom",
        relationType: "MITIGATES",
        toId: targetAtom.id,
        toNodeType: "MemoryAtom",
        scope,
        confidence: 0.7,
        status: "active",
        provenance: strategy.provenance,
      });
    }
  }

  return relations;
}

export function buildTaskFrame(
  rawInput: string | Record<string, unknown>,
  config: EngineConfig,
  scopeInput?: ScopeInput,
  hints?: Record<string, string | string[]>,
): TaskFrame {
  const scope = resolveScope(scopeInput, config);
  const text = extractText(rawInput);
  const taskTypeHint = typeof hints?.taskType === "string" ? hints.taskType : undefined;
  const taskType = inferTaskType(text, taskTypeHint);
  const entities = extractEntities(text, scope).map((entity) => entity.name);
  const scenarioTags = extractScenarios(text, scope).map((scenario) => scenario.name);
  const problems = extractProblems(text, scope).map((problem) => problem.normalizedStatement);
  const constraints = inferConstraints(text);
  const defaultRequiredAtomTypesByTask: Record<string, string[]> = {
    debugging: ["failure_pattern", "strategy", "constraint"],
    planning: ["strategy", "constraint"],
    research: ["problem_pattern", "strategy"],
    support: ["preference", "strategy"],
    operations: ["failure_pattern", "heuristic", "strategy"],
  };

  return {
    id: createId("tf"),
    scope,
    taskType,
    goals: [inferGoal(text)],
    problems,
    scenarioTags,
    constraints,
    entities,
    requiredAtomTypes: defaultRequiredAtomTypesByTask[taskType] ?? [],
    provenance: {
      sourceType: "external",
      hintsApplied: Object.keys(hints ?? {}),
    },
  };
}

export function buildDistillationResult(input: {
  rawInput: string | Record<string, unknown>;
  config: EngineConfig;
  scopeInput?: ScopeInput;
  sourceType: SourceType;
  sourceSessionId?: string;
  sourceTurnRange?: [number, number];
  metadata?: Record<string, string>;
}): DistillationResult {
  // Step 1: Segmentation
  const scope = resolveScope(input.scopeInput, input.config);
  const chunk = segmentRawInput({
    rawInput: input.rawInput,
    sourceType: input.sourceType,
    sourceSessionId: input.sourceSessionId,
    sourceTurnRange: input.sourceTurnRange,
    metadata: input.metadata,
  });
  const text = chunk.text;

  // Step 2: Event identifiers and checksums
  const ingestionChecksum = computeIngestionChecksum(input.rawInput, input.metadata);
  const eventKey = computeEventKey({
    rawInput: input.rawInput,
    scope,
    sourceType: input.sourceType,
    sourceSessionId: input.sourceSessionId,
    sourceTurnRange: input.sourceTurnRange,
    metadata: input.metadata,
  });

  // Step 3: Context understanding
  const contextFrame = buildContextFrame(text, scope);

  // Step 4: Event/evidence/object extraction
  const eventId = createId("evt");
  const evidence = buildEvidence(
    input.rawInput,
    scope,
    input.sourceType,
    input.sourceSessionId,
    input.sourceTurnRange,
    input.metadata,
  ).map((record) => ({
    ...record,
    locator: {
      ...record.locator,
      toolCallIds: chunk.toolCalls,
    },
  }));
  const evidenceRefs = evidence.map((item) => item.id);

  const entities = extractEntities(text, scope).map((entity) => ({
    ...entity,
    aliases: [],
    provenance: { sourceEventIds: [eventId], evidenceRefs },
    entityKey: "",
  }));
  const normalizedEntities = entities.map((entity) => {
    const entityKey = computeEntityKey(entity);
    return {
      ...entity,
      id: stableId("ent", entityKey),
      entityKey,
    };
  });
  const scenarios = extractScenarios(text, scope).map((scenario) => {
    const scenarioKey = scenario.scenarioKey ?? computeScenarioKey(scenario);
    return {
      ...scenario,
      id: stableId("scn", scenarioKey),
      scenarioKey,
      provenance: { sourceEventIds: [eventId], evidenceRefs },
    };
  });
  const problems = extractProblems(text, scope).map((problem) => {
    const problemKey = problem.problemKey ?? computeProblemKey(problem);
    return {
      ...problem,
      id: stableId("prb", problemKey),
      problemKey,
      provenance: { sourceEventIds: [eventId], evidenceRefs },
    };
  });

  const extractedAtoms = buildAtoms(text, scope, evidenceRefs, eventId);
  if (extractedAtoms.length === 0) {
    extractedAtoms.push({
      id: createId("atm"),
      atomType: "problem_pattern",
      scope,
      claim: {
        type: "heuristic",
        statement:
          "Observed task context lacks reusable cognition and requires additional validation.",
      },
      trigger: {
        conditions: contextFrame.signals.slice(0, 1),
        contextTags: contextFrame.scenarios.slice(0, 1),
      },
      applicability: {
        include: contextFrame.entities.slice(0, 1),
        exclude: [],
      },
      provenance: {
        sourceEventIds: [eventId],
        evidenceRefs,
      },
      versioning: { version: 1 },
      state: { status: "active", conflictsWith: [] },
      metrics: { confidence: 0.35, reuseCount: 0 },
    });
  }

  // Step 5 + 6 + 7 + 8: normalization -> keying -> candidate dedup -> validation/repair
  const atoms = normalizeAndRepairAtoms(extractedAtoms, contextFrame);

  const decisions = [
    /retry|重试/.test(text) ? "evaluate_retry_strategy" : "",
    /rollback|回滚/.test(text.toLowerCase()) ? "enforce_rollback_gate" : "",
    chunk.toolCalls.length > 0 ? "inspect_tool_execution_boundary" : "",
  ].filter(Boolean);
  const turningPoints = [
    contextFrame.signals.includes("high_latency") ? "latency_spike_detected" : "",
    contextFrame.signals.includes("alert_noise") ? "alert_noise_threshold_exceeded" : "",
    chunk.turns.length > 1 ? "multi_turn_context_detected" : "",
  ].filter(Boolean);

  const event: EventSkeleton = {
    id: eventId,
    scope,
    goal: inferGoal(text),
    context: text.slice(0, 500),
    constraints: contextFrame.constraints,
    decisions,
    turningPoints,
    outcome: undefined,
    linkedAtoms: atoms.map((atom) => atom.id),
    evidenceRefs,
    eventKey,
    provenance: {
      sourceType: input.sourceType,
      sourceSessionId: input.sourceSessionId,
      sourceTurnRange: input.sourceTurnRange,
      ingestionChecksum,
    },
  };

  const relations = buildRelations(atoms, normalizedEntities, scenarios, problems, scope);
  const keys: DistillationKeys = {
    ingestionChecksum,
    eventKey,
    atomDedupKeys: atoms.map((atom) => atom.dedupKey ?? ""),
    entityKeys: normalizedEntities.map((entity) => entity.entityKey ?? ""),
    scenarioKeys: scenarios.map((scenario) => scenario.scenarioKey ?? ""),
    problemKeys: problems.map((problem) => problem.problemKey ?? ""),
  };

  const writePlan: WritePlan = {
    canonicalObjectTypes: [
      "EventSkeleton",
      "MemoryAtom",
      "Entity",
      "Scenario",
      "Problem",
      "Evidence",
    ],
    relationIds: relations.map((relation) => relation.id),
    graphNodeIds: [
      event.id,
      ...atoms.map((atom) => atom.id),
      ...normalizedEntities.map((entity) => entity.id),
      ...scenarios.map((scenario) => scenario.id),
      ...problems.map((problem) => problem.id),
      ...evidence.map((item) => item.id),
    ],
    graphEdgeIds: relations.map((relation) => relation.id),
    vectorDocumentIds: [
      event.id,
      ...atoms.map((atom) => atom.id),
      ...normalizedEntities.map((entity) => entity.id),
    ],
  };

  return {
    event,
    atoms,
    entities: normalizedEntities,
    scenarios,
    problems,
    relations,
    evidence,
    keys,
    writePlan,
    quality: {
      profile: "rule_based",
      stageCoverage: 1,
      stageFallbackRate: 0,
      stageDecisions: [
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
      ],
    },
  };
}

export function buildPackageAnswer(atoms: MemoryAtom[]): PackageAnswer {
  const recommendations = atoms
    .filter((atom) => atom.atomType === "strategy" || atom.atomType === "heuristic")
    .map((atom) => atom.claim.statement)
    .slice(0, 3);

  const summary =
    recommendations[0] ??
    atoms[0]?.claim.statement ??
    "No strong reusable cognition was found for the current task.";

  return {
    summary,
    recommendations,
    nextSteps:
      recommendations.length > 0
        ? ["validate the recommended strategy against current constraints"]
        : [],
  };
}

export function computeTaskOverlap(taskFrame: TaskFrame, atom: MemoryAtom): number {
  const taskTokens = new Set(
    [
      ...taskFrame.goals,
      ...taskFrame.problems,
      ...taskFrame.scenarioTags,
      ...taskFrame.constraints,
      ...taskFrame.entities,
      ...taskFrame.requiredAtomTypes,
    ].flatMap((value) => tokenize(value)),
  );
  const atomTokens = new Set([
    ...tokenize(atom.claim.statement),
    ...atom.trigger.conditions.flatMap((value) => tokenize(value)),
    ...atom.trigger.contextTags.flatMap((value) => tokenize(value)),
    ...atom.applicability.include.flatMap((value) => tokenize(value)),
  ]);

  if (taskTokens.size === 0 || atomTokens.size === 0) {
    return taskFrame.requiredAtomTypes.includes(atom.atomType) ? 0.35 : 0;
  }

  const overlap = [...atomTokens].filter((token) => taskTokens.has(token)).length;
  const lexicalScore = overlap / atomTokens.size;
  const typeScore = taskFrame.requiredAtomTypes.includes(atom.atomType) ? 0.35 : 0;
  return Math.min(1, lexicalScore * 0.75 + typeScore);
}
