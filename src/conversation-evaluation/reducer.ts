import {
  classifyErrorClass,
  isErrorClass,
  judgeDimensions,
  type ErrorClass,
} from "./assessment.js";
import { deriveEfficiency } from "./efficiency.js";
import {
  agentIdFromSessionKey,
  classifyEntrypoint,
  classifyLinkQuality,
  createEvaluationEventId,
  hashConversationKey,
  readAttempt,
  roundIdFromCollabRun,
} from "./identity.js";
import type {
  ClockSource,
  ConversationEvaluationRecord,
  FirstVisibleKind,
  LinkQuality,
} from "./types.js";
import {
  CONVERSATION_EVALUATION_RULE_SET_ID,
  CONVERSATION_EVALUATION_RULE_VERSION,
} from "./types.js";

export type ObservationInput = {
  runId: string;
  ts: number;
  stream: string;
  sessionKey?: string;
  data: Record<string, unknown>;
  trustedTenantId: string;
  linkQuality?: LinkQuality;
  conversationId?: string;
  agentId?: string | null;
  visibleText?: boolean;
  visibleMedia?: boolean;
};

type ToolSpan = { start: number | null; end: number | null; isError: boolean };

type RunState = {
  runId: string;
  tenantId: string;
  linkQuality: LinkQuality;
  sessionKey?: string;
  conversationId: string;
  agentId: string | null;
  modelId?: string;
  attempt?: number;
  sawDispatch: boolean;
  entrypointHint?: unknown;
  t0: number | null;
  t0Source?: ClockSource;
  startedAt: number | null;
  endedAt: number | null;
  phase: "start" | "end" | "error" | null;
  aborted: boolean;
  errorClass: ErrorClass | null;
  modelTtftMs: number | null;
  sawFirstToken: boolean;
  firstVisibleAt: number | null;
  firstVisibleKind: FirstVisibleKind | null;
  sawAssistantText: boolean;
  llmMs: number | null;
  sawCompile: boolean;
  compileMs: number | null;
  tools: Map<string, ToolSpan>;
  toolFailed: boolean;
  evidence: string[];
  pendingEmitted: boolean;
  bucketAt: number;
  claimIgnored: boolean;
};

function noteEvidence(state: RunState, ref: string): void {
  if (!state.evidence.includes(ref) && state.evidence.length < 32) {
    state.evidence.push(ref);
  }
}

function noteVisible(state: RunState, ts: number, kind: FirstVisibleKind): void {
  if (state.firstVisibleAt === null || ts < state.firstVisibleAt) {
    state.firstVisibleAt = ts;
    state.firstVisibleKind = kind;
  }
}

function conversationIdFor(obs: ObservationInput): string {
  if (obs.conversationId?.trim()) {
    return hashConversationKey(obs.conversationId.trim());
  }
  const hashed = obs.data.sessionKeyHash;
  if (typeof hashed === "string" && hashed.trim()) {
    return hashed.trim().slice(0, 64);
  }
  if (obs.sessionKey?.trim()) {
    return hashConversationKey(obs.sessionKey.trim());
  }
  return hashConversationKey(`run:${obs.runId}`);
}

function createState(obs: ObservationInput): RunState {
  const attempt = readAttempt(obs.data);
  return {
    runId: obs.runId,
    tenantId: obs.trustedTenantId,
    linkQuality: classifyLinkQuality(obs.runId, obs.linkQuality),
    sessionKey: obs.sessionKey,
    conversationId: conversationIdFor(obs),
    agentId: obs.agentId ?? agentIdFromSessionKey(obs.sessionKey),
    ...(attempt !== undefined ? { attempt } : {}),
    sawDispatch: false,
    t0: null,
    startedAt: null,
    endedAt: null,
    phase: null,
    aborted: false,
    errorClass: null,
    modelTtftMs: null,
    sawFirstToken: false,
    firstVisibleAt: null,
    firstVisibleKind: null,
    sawAssistantText: false,
    llmMs: null,
    sawCompile: false,
    compileMs: null,
    tools: new Map(),
    toolFailed: false,
    evidence: [],
    pendingEmitted: false,
    bucketAt: obs.ts,
    claimIgnored: false,
  };
}

function applyObservation(state: RunState, obs: ObservationInput): void {
  if (obs.sessionKey && !state.sessionKey) {
    state.sessionKey = obs.sessionKey;
    state.agentId = state.agentId ?? agentIdFromSessionKey(obs.sessionKey);
  }
  const attempt = readAttempt(obs.data);
  if (attempt !== undefined) {
    state.attempt = attempt;
  }
  const claimed = obs.data.tenantId;
  if (typeof claimed === "string" && claimed.trim()) {
    if (claimed.trim().toLowerCase() !== state.tenantId.trim().toLowerCase()) {
      state.claimIgnored = true;
      noteEvidence(state, "tenant_claim_ignored");
    }
  }
  if (typeof obs.data.entrypoint === "string") {
    state.entrypointHint = obs.data.entrypoint;
  }
  if (typeof obs.data.model === "string" && obs.data.model.trim()) {
    state.modelId = obs.data.model.trim();
  }

  const event = typeof obs.data.event === "string" ? obs.data.event : "";
  if (event === "chat.dispatch_started") {
    state.sawDispatch = true;
    state.t0 = obs.ts;
    state.t0Source = "chat.dispatch_started";
    noteEvidence(state, "chat.dispatch_started");
  } else if (event === "chat.user_persisted") {
    noteEvidence(state, "chat.user_persisted");
  } else if (event === "chat.first_token") {
    state.sawFirstToken = true;
    const modelTtftMs = obs.data.modelTtftMs;
    if (typeof modelTtftMs === "number" && Number.isFinite(modelTtftMs) && modelTtftMs >= 0) {
      state.modelTtftMs = modelTtftMs;
    }
    noteVisible(state, obs.ts, "model");
    noteEvidence(state, "chat.first_token");
  } else if (event === "chat.model_started") {
    noteEvidence(state, "chat.model_started");
  } else if (event === "chat.model_finished") {
    const modelMs = obs.data.modelMs;
    if (typeof modelMs === "number" && Number.isFinite(modelMs) && modelMs >= 0) {
      state.llmMs = (state.llmMs ?? 0) + modelMs;
    }
    noteEvidence(state, "chat.model_finished");
  } else if (event === "chat.context_compiled") {
    const compileMs = obs.data.compileMs;
    if (typeof compileMs === "number" && Number.isFinite(compileMs) && compileMs >= 0) {
      state.sawCompile = true;
      state.compileMs = compileMs;
    }
    noteEvidence(state, "chat.context_compiled");
  } else if (event === "chat.assistant_persisted") {
    noteEvidence(state, "chat.assistant_persisted");
  }

  if (obs.stream === "assistant" && (obs.visibleText || obs.visibleMedia)) {
    noteVisible(state, obs.ts, obs.visibleText ? "model" : "other");
    if (obs.visibleText) {
      state.sawAssistantText = true;
    }
    noteEvidence(state, "assistant");
  }

  if (obs.stream === "tool") {
    const toolCallId =
      typeof obs.data.toolCallId === "string" && obs.data.toolCallId.trim()
        ? obs.data.toolCallId
        : `anon:${obs.ts}`;
    const phase = obs.data.phase;
    if (phase === "start") {
      noteVisible(state, obs.ts, "tool");
      state.tools.set(toolCallId, { start: obs.ts, end: null, isError: false });
      noteEvidence(state, "tool:start");
    } else if (phase === "result") {
      const span = state.tools.get(toolCallId) ?? { start: null, end: null, isError: false };
      span.end = obs.ts;
      span.isError = obs.data.isError === true;
      state.tools.set(toolCallId, span);
      if (span.isError) {
        state.toolFailed = true;
      }
      noteEvidence(state, "tool:result");
    }
  }

  if (obs.stream === "lifecycle" && !event.startsWith("chat.")) {
    const phase = obs.data.phase;
    if (phase === "start" || phase === "end" || phase === "error") {
      const startedAt = typeof obs.data.startedAt === "number" ? obs.data.startedAt : obs.ts;
      if (state.startedAt === null) {
        state.startedAt = startedAt;
      }
      if (state.t0 === null) {
        state.t0 = startedAt;
        state.t0Source = "lifecycle_start";
      }
      if (phase === "start") {
        state.phase = state.phase ?? "start";
        noteEvidence(state, "lifecycle:start");
      }
    }
    if (phase === "end" || phase === "error") {
      state.phase = phase;
      state.endedAt = typeof obs.data.endedAt === "number" ? obs.data.endedAt : obs.ts;
      if (phase === "error") {
        state.errorClass = isErrorClass(obs.data.errorClass)
          ? obs.data.errorClass
          : classifyErrorClass(obs.data.error);
      }
      if (obs.data.aborted === true || obs.data.reason === "aborted") {
        state.aborted = true;
      }
      noteEvidence(state, phase === "end" ? "lifecycle:end" : "lifecycle:error");
    }
  }
}

function toolStats(state: RunState): { toolSpanCount: number; toolMeasuredMs: number | null } {
  if (state.tools.size === 0) {
    return { toolSpanCount: 0, toolMeasuredMs: null };
  }
  let sum = 0;
  let incomplete = 0;
  for (const span of state.tools.values()) {
    if (span.start === null || span.end === null) {
      incomplete += 1;
      continue;
    }
    const delta = span.end - span.start;
    if (delta < 0) {
      incomplete += 1;
      continue;
    }
    sum += delta;
  }
  return {
    toolSpanCount: state.tools.size,
    toolMeasuredMs: incomplete > 0 ? null : sum,
  };
}

function buildRecord(
  state: RunState,
  nowMs: number,
  recordKind: ConversationEvaluationRecord["recordKind"],
  reducerFailed: boolean,
): ConversationEvaluationRecord {
  const terminal = state.phase === "end" || state.phase === "error";
  const tools = toolStats(state);
  const efficiency = deriveEfficiency({
    t0: state.t0,
    t0Source: state.t0Source,
    endedAt: state.endedAt,
    terminal,
    phase: state.phase,
    modelTtftMs: state.modelTtftMs,
    sawFirstToken: state.sawFirstToken,
    firstVisibleAt: state.firstVisibleAt,
    firstVisibleKind: state.firstVisibleKind,
    sawAssistantText: state.sawAssistantText,
    llmMs: state.llmMs,
    toolSpanCount: tools.toolSpanCount,
    toolMeasuredMs: tools.toolMeasuredMs,
    sawCompile: state.sawCompile,
    compileMs: state.compileMs,
  });
  const judged = judgeDimensions({
    terminal: reducerFailed ? true : terminal,
    phase: state.phase,
    aborted: state.aborted,
    errorClass: state.errorClass,
    toolFailed: state.toolFailed,
    visible: state.firstVisibleAt !== null,
    linkQuality: state.linkQuality,
    reducerFailed,
  });
  const entrypoint = classifyEntrypoint({
    runId: state.runId,
    sessionKey: state.sessionKey,
    sawDispatch: state.sawDispatch,
    entrypointHint: state.entrypointHint,
  });
  const roundId = entrypoint === "collab-bot" ? roundIdFromCollabRun(state.runId) : undefined;
  const record: ConversationEvaluationRecord = {
    tenantId: state.tenantId,
    conversationId: state.conversationId,
    runId: state.runId,
    eventId: createEvaluationEventId(),
    agentId: state.agentId,
    linkQuality: state.linkQuality,
    entrypoint,
    execution: judged.execution,
    usability: judged.usability,
    correctness: judged.correctness,
    correctnessReason: judged.correctnessReason,
    failureAttribution: judged.failureAttribution,
    assessmentStatus: judged.assessmentStatus,
    ruleSetId: CONVERSATION_EVALUATION_RULE_SET_ID,
    ruleVersion: CONVERSATION_EVALUATION_RULE_VERSION,
    evidenceRefs: [...state.evidence],
    totalMs: efficiency.totalMs,
    modelFirstTokenMs: efficiency.modelFirstTokenMs,
    ttftMs: efficiency.ttftMs,
    llmMs: efficiency.llmMs,
    toolMs: efficiency.toolMs,
    compileMs: efficiency.compileMs,
    dockerMs: "n/a",
    startupMode: "unknown",
    startedAt: state.startedAt === null ? null : new Date(state.startedAt).toISOString(),
    endedAt: state.endedAt === null ? null : new Date(state.endedAt).toISOString(),
    observedAt: new Date(nowMs).toISOString(),
    assessedAt: terminal || reducerFailed ? new Date(nowMs).toISOString() : null,
    recordKind,
  };
  if (state.attempt !== undefined) {
    record.attempt = state.attempt;
  }
  if (state.modelId) {
    record.modelId = state.modelId;
  }
  if (roundId) {
    record.roundId = roundId;
  }
  if (judged.unassessedReason) {
    record.unassessedReason = judged.unassessedReason;
  }
  if (judged.failureCode) {
    record.failureCode = judged.failureCode;
  }
  if (efficiency.firstVisibleKind && typeof efficiency.ttftMs === "number") {
    record.firstVisibleKind = efficiency.firstVisibleKind;
  }
  if (efficiency.ttftAlgorithm) {
    record.ttftAlgorithm = efficiency.ttftAlgorithm;
  }
  if (efficiency.toolMsAlgorithm) {
    record.toolMsAlgorithm = efficiency.toolMsAlgorithm;
  }
  if (efficiency.t0Source) {
    record.t0Source = efficiency.t0Source;
  }
  return record;
}

function isTerminalPhase(state: RunState): boolean {
  return state.phase === "end" || state.phase === "error";
}

export class ConversationReducer {
  private readonly runs = new Map<string, RunState>();

  private key(tenantId: string, runId: string): string {
    return `${tenantId}\0${runId}`;
  }

  ingest(obs: ObservationInput, nowMs: number): ConversationEvaluationRecord | null {
    if (!obs.trustedTenantId.trim() || !obs.runId.trim()) {
      return null;
    }
    const key = this.key(obs.trustedTenantId, obs.runId);
    const state = this.runs.get(key) ?? createState(obs);
    this.runs.set(key, state);
    const wasTerminal = isTerminalPhase(state);
    applyObservation(state, obs);
    if (isTerminalPhase(state) && !wasTerminal) {
      return buildRecord(state, nowMs, "terminal", false);
    }
    if (!wasTerminal && !state.pendingEmitted) {
      state.pendingEmitted = true;
      return buildRecord(state, nowMs, "pending", false);
    }
    return null;
  }

  reassess(tenantId: string, runId: string, nowMs: number): ConversationEvaluationRecord | null {
    const state = this.runs.get(this.key(tenantId, runId));
    if (!state || !isTerminalPhase(state)) {
      return null;
    }
    return buildRecord(state, nowMs, "reassess", false);
  }

  fail(tenantId: string, runId: string, nowMs: number): ConversationEvaluationRecord | null {
    const key = this.key(tenantId, runId);
    const state = this.runs.get(key);
    if (!state) {
      return null;
    }
    return buildRecord(state, nowMs, "terminal", true);
  }

  bucketAt(tenantId: string, runId: string): number | null {
    return this.runs.get(this.key(tenantId, runId))?.bucketAt ?? null;
  }
}
