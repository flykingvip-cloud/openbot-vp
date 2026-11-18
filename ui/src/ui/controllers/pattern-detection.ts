import type { GatewayBrowserClient } from "../gateway.ts";

export type PatternSignal = {
  kind: "repeated_task" | "stable_prompt" | "fixed_workflow" | "repeated_toolchain" | "stable_io";
  description: string;
  confidence: number; // 0-1
  detectedAt: number;
  sampleCount: number;
};

export type PatternDetectionHint = {
  agentId: string;
  contextId: string;
  signals: PatternSignal[];
  overallConfidence: number; // 0-1, aggregated from signals
  suggestedName: string;
  suggestedSummary: string;
};

export type PatternDetectionThresholds = {
  minRepetitions: number; // e.g. 3
  minConfidence: number; // e.g. 0.7
  minSignalCount: number; // e.g. 2
};

export type PatternDetectionState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  pendingHints: PatternDetectionHint[];
  dismissedContextIds: Set<string>;
  thresholds: PatternDetectionThresholds;
};

export const DEFAULT_THRESHOLDS: PatternDetectionThresholds = {
  minRepetitions: 3,
  minConfidence: 0.7,
  minSignalCount: 2,
};

const VALID_SIGNAL_KINDS = new Set([
  "repeated_task",
  "stable_prompt",
  "fixed_workflow",
  "repeated_toolchain",
  "stable_io",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeSignal(value: unknown): PatternSignal | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const kind = stringValue(record.kind);
  if (!VALID_SIGNAL_KINDS.has(kind)) {
    return null;
  }
  return {
    kind: kind as PatternSignal["kind"],
    description: stringValue(record.description).trim(),
    confidence: clampNumber(record.confidence, 0, 1, 0),
    detectedAt:
      typeof record.detectedAt === "number" && Number.isFinite(record.detectedAt)
        ? record.detectedAt
        : 0,
    sampleCount:
      typeof record.sampleCount === "number" && Number.isFinite(record.sampleCount)
        ? Math.max(0, Math.floor(record.sampleCount))
        : 0,
  };
}

/**
 * Sanitizes a raw hint value from the gateway into a well-typed PatternDetectionHint.
 * Returns a valid hint with normalized fields; invalid signals are filtered out.
 */
export function normalizePatternHint(value: unknown): PatternDetectionHint {
  const record = asRecord(value) ?? {};
  const rawSignals = Array.isArray(record.signals) ? record.signals : [];
  const signals = rawSignals.map(normalizeSignal).filter((s): s is PatternSignal => s !== null);

  return {
    agentId: stringValue(record.agentId).trim(),
    contextId: stringValue(record.contextId).trim(),
    signals,
    overallConfidence: clampNumber(record.overallConfidence, 0, 1, 0),
    suggestedName: stringValue(record.suggestedName).trim(),
    suggestedSummary: stringValue(record.suggestedSummary).trim(),
  };
}

/**
 * Pure function: returns true if hint meets all thresholds:
 * - overallConfidence >= minConfidence
 * - signals.length >= minSignalCount
 * - at least one signal has sampleCount >= minRepetitions
 */
export function evaluatePatternHint(
  hint: PatternDetectionHint,
  thresholds: PatternDetectionThresholds,
): boolean {
  if (hint.overallConfidence < thresholds.minConfidence) {
    return false;
  }
  if (hint.signals.length < thresholds.minSignalCount) {
    return false;
  }
  const hasEnoughRepetitions = hint.signals.some(
    (signal) => signal.sampleCount >= thresholds.minRepetitions,
  );
  return hasEnoughRepetitions;
}

/**
 * Adds hint to pendingHints if it passes evaluation and hasn't been dismissed.
 */
export function processIncomingHint(
  state: PatternDetectionState,
  hint: PatternDetectionHint,
): void {
  if (state.dismissedContextIds.has(hint.contextId)) {
    return;
  }
  if (!evaluatePatternHint(hint, state.thresholds)) {
    return;
  }
  // Avoid duplicates for the same contextId
  const existing = state.pendingHints.findIndex((h) => h.contextId === hint.contextId);
  if (existing >= 0) {
    state.pendingHints[existing] = hint;
  } else {
    state.pendingHints.push(hint);
  }
}

/**
 * Adds contextId to dismissedContextIds and removes from pendingHints.
 */
export function dismissHint(state: PatternDetectionState, contextId: string): void {
  state.dismissedContextIds.add(contextId);
  state.pendingHints = state.pendingHints.filter((h) => h.contextId !== contextId);
}

/**
 * Returns pendingHints that haven't been dismissed.
 */
export function getActiveHints(state: PatternDetectionState): PatternDetectionHint[] {
  return state.pendingHints.filter((h) => !state.dismissedContextIds.has(h.contextId));
}

/**
 * Calls `pattern-detection.subscribe` endpoint to start receiving hints for an agent.
 * Server returns a snapshot of candidates (source of truth).
 */
export async function subscribeToPatternDetection(
  state: PatternDetectionState,
  agentId: string,
): Promise<boolean> {
  if (!state.client || !state.connected) {
    return false;
  }
  try {
    const response = await state.client.request("pattern-detection.subscribe", { agentId });
    const record = asRecord(response);
    const rawCandidates = Array.isArray(record?.candidates) ? record.candidates : [];
    for (const raw of rawCandidates) {
      const hint = patternCandidateToHint(raw);
      if (hint) {
        processIncomingHint(state, hint);
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Ingest one independent run sample into the server pattern detector.
 * Returns server candidate when the sample crosses the multi-task threshold.
 */
export async function ingestPatternSampleToServer(
  state: PatternDetectionState,
  params: {
    agentId: string;
    runId?: string | null;
    taskId?: string | null;
    sessionKey?: string | null;
    inputStructureHash: string;
    outputStructureHash: string;
    toolTraceHash?: string | null;
    toolsUsed?: string[] | null;
    success?: boolean | null;
    suggestedNameHint?: string;
    suggestedSummaryHint?: string;
  },
): Promise<PatternDetectionHint | null> {
  // Synthetic UI roles are not tenant-owned agents. Do not submit an invented
  // actor identity; group sampling needs a server-proven responding agent.
  if (params.agentId === "group-supervisor" || params.agentId === "assistant-runtime") {
    return null;
  }
  if (!state.client || !state.connected) {
    return null;
  }
  try {
    const response = await state.client.request("pattern-detection.ingest-sample", {
      agentId: params.agentId,
      runId: params.runId ?? undefined,
      taskId: params.taskId ?? undefined,
      sessionKey: params.sessionKey ?? undefined,
      inputStructureHash: params.inputStructureHash,
      outputStructureHash: params.outputStructureHash,
      toolTraceHash: params.toolTraceHash ?? undefined,
      toolsUsed: params.toolsUsed ?? undefined,
      success: params.success ?? null,
      suggestedNameHint: params.suggestedNameHint,
      suggestedSummaryHint: params.suggestedSummaryHint,
    });
    const record = asRecord(response);
    const candidate = record?.candidate;
    if (!candidate) {
      return null;
    }
    const hint = patternCandidateToHint(candidate);
    if (hint) {
      processIncomingHint(state, hint);
    }
    return hint;
  } catch {
    return null;
  }
}

/** Map server PatternCandidate → UI PatternDetectionHint. */
export function patternCandidateToHint(value: unknown): PatternDetectionHint | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const candidateId = stringValue(record.candidateId).trim();
  const agentId = stringValue(record.agentId).trim();
  if (!candidateId || !agentId) {
    return null;
  }
  const sampleCount =
    typeof record.independentTaskCount === "number" && Number.isFinite(record.independentTaskCount)
      ? Math.max(0, Math.floor(record.independentTaskCount))
      : typeof record.sampleCount === "number" && Number.isFinite(record.sampleCount)
        ? Math.max(0, Math.floor(record.sampleCount))
        : 0;
  const confidence = clampNumber(record.overallConfidence, 0, 1, 0);
  return {
    agentId,
    contextId: candidateId,
    signals: [
      {
        kind: "repeated_task",
        description: "服务端跨独立任务聚合的稳定模式证据",
        confidence,
        detectedAt:
          typeof record.lastSeenAt === "number" && Number.isFinite(record.lastSeenAt)
            ? record.lastSeenAt
            : Date.now(),
        sampleCount,
      },
      {
        kind: "stable_io",
        description: "结构指纹跨多次独立 run 对齐",
        confidence: Math.min(1, confidence + 0.05),
        detectedAt:
          typeof record.lastSeenAt === "number" && Number.isFinite(record.lastSeenAt)
            ? record.lastSeenAt
            : Date.now(),
        sampleCount,
      },
    ],
    overallConfidence: confidence,
    suggestedName: stringValue(record.suggestedName).trim() || "稳定工作模式",
    suggestedSummary:
      stringValue(record.suggestedSummary).trim() || "跨多次独立任务观察到的可复用执行模式",
  };
}

/** List server candidates (read-only truth for UI). */
export async function listServerPatternCandidates(
  state: PatternDetectionState,
  agentId?: string,
): Promise<PatternDetectionHint[]> {
  if (!state.client || !state.connected) {
    return [];
  }
  try {
    const response = await state.client.request("pattern-detection.list-candidates", {
      agentId,
      status: "candidate",
    });
    const record = asRecord(response);
    const raw = Array.isArray(record?.candidates) ? record.candidates : [];
    return raw
      .map(patternCandidateToHint)
      .filter((hint): hint is PatternDetectionHint => hint !== null);
  } catch {
    return [];
  }
}

export type PatternCandidateGovernanceRow = PatternDetectionHint & {
  status: "candidate" | "approved" | "rejected" | "published";
};

function normalizeCandidateStatus(value: unknown): PatternCandidateGovernanceRow["status"] {
  const status = stringValue(value);
  if (
    status === "approved" ||
    status === "rejected" ||
    status === "published" ||
    status === "candidate"
  ) {
    return status;
  }
  return "candidate";
}

/** List candidates including approved (for governance publish step). */
export async function listServerPatternCandidatesByStatus(
  state: PatternDetectionState,
  params: { agentId: string; status?: PatternCandidateGovernanceRow["status"] },
): Promise<PatternCandidateGovernanceRow[]> {
  if (!state.client || !state.connected) {
    return [];
  }
  try {
    const response = await state.client.request("pattern-detection.list-candidates", {
      agentId: params.agentId,
      status: params.status ?? "candidate",
    });
    const record = asRecord(response);
    const raw = Array.isArray(record?.candidates) ? record.candidates : [];
    const rows: PatternCandidateGovernanceRow[] = [];
    for (const entry of raw) {
      const hint = patternCandidateToHint(entry);
      if (!hint) {
        continue;
      }
      const entryRecord = asRecord(entry);
      rows.push({
        ...hint,
        status: normalizeCandidateStatus(entryRecord?.status),
      });
    }
    return rows;
  } catch {
    return [];
  }
}

export async function approvePatternCandidateOnServer(
  state: PatternDetectionState,
  params: { agentId: string; candidateId: string; autoInstallIntent?: boolean },
): Promise<boolean> {
  if (!state.client || !state.connected) {
    return false;
  }
  try {
    await state.client.request("pattern-detection.approve", {
      agentId: params.agentId,
      candidateId: params.candidateId,
      autoInstallIntent: params.autoInstallIntent === true,
    });
    dismissHint(state, params.candidateId);
    return true;
  } catch {
    return false;
  }
}

export async function rejectPatternCandidateOnServer(
  state: PatternDetectionState,
  params: { agentId: string; candidateId: string },
): Promise<boolean> {
  if (!state.client || !state.connected) {
    return false;
  }
  try {
    await state.client.request("pattern-detection.reject", {
      agentId: params.agentId,
      candidateId: params.candidateId,
    });
    dismissHint(state, params.candidateId);
    return true;
  } catch {
    return false;
  }
}

export async function publishPatternDraftSkillOnServer(
  state: PatternDetectionState,
  params: { agentId: string; candidateId: string; sourceAgentId?: string },
): Promise<boolean> {
  if (!state.client || !state.connected) {
    return false;
  }
  try {
    await state.client.request("pattern-detection.publish-draft-skill", {
      agentId: params.agentId,
      candidateId: params.candidateId,
      ...(params.sourceAgentId ? { sourceAgentId: params.sourceAgentId } : {}),
    });
    return true;
  } catch {
    return false;
  }
}
