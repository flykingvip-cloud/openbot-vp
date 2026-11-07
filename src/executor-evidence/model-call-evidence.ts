/**
 * Per-attempt model-call identity and usage.
 * callId is allocated before the transport runs. This module does not read
 * session totals or TaskOutcome spend, and it does not store prompts.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { TrustedScope } from "../task-outcome/types.js";

export const MODEL_CALL_EVIDENCE_SCHEMA_VERSION = 1 as const;
export const MODEL_CALL_FILE_CAP = 2000;

export type ModelCallUsage = {
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
};

export type ModelCallStatus = "completed" | "failed" | "cancelled" | "unknown";
export type ModelCallTerminalCause = "none" | "error" | "timeout" | "cancelled";
export type ModelCallAttemptKind = "turn" | "fallback_candidate" | "provider_retry";

export type ModelCallEvidence = {
  schemaVersion: 1;
  evidenceId: string;
  agentId: string;
  scope: TrustedScope;
  taskId: string;
  runId: string;
  attemptId: string;
  /** Turn, fallback candidate, and provider retry are different attempt ids. */
  attemptKind: ModelCallAttemptKind;
  callId: string;
  parentCallId: string | null;
  providerRequestId: string | null;
  providerResponseId: string | null;
  provider: string;
  model: string;
  startedAt: number;
  completedAt: number | null;
  /** When this process observed the record. Not a substitute for startedAt. */
  observedAt: number;
  status: ModelCallStatus;
  terminalCause: ModelCallTerminalCause;
  usageSource: string;
  /**
   * provider_aggregate_internal_retries_unknown: one usage blob covers an
   * unknown number of provider-internal retries. It is not split into fake calls.
   */
  usageAggregation: "per_call" | "provider_aggregate_internal_retries_unknown";
  usage: ModelCallUsage;
  provenance: "live" | "seed" | "injected" | "unknown";
  collector: string;
  /**
   * A local callId proves this process allocated one attempt before the
   * transport returned. It does not prove a provider request id when that id is null.
   */
  localIdentity: {
    proves: "executor_attempt_allocated_before_return";
    doesNotProve: "provider_request_identity_when_ids_null";
  };
  persisted: boolean;
  durableAcrossRestart: boolean;
};

export type ExecutorEvidenceContext = {
  agentId: string;
  scope: TrustedScope;
  taskId: string;
  runId: string;
  storeRoot?: string;
  provenance?: ModelCallEvidence["provenance"];
  collector?: string;
};

export type ActiveModelCall = ModelCallEvidence & { finished: boolean };

const calls = new Map<string, ActiveModelCall>();
const callStorage = new AsyncLocalStorage<ActiveModelCall>();

const EMPTY_USAGE: ModelCallUsage = {
  input: null,
  output: null,
  cacheRead: null,
  cacheWrite: null,
};

export function executorEvidenceCollectionEnabled(): boolean {
  return process.env.OPENBOT_EXECUTOR_EVIDENCE !== "0";
}

export function currentExecutorModelCall(): ActiveModelCall | undefined {
  return callStorage.getStore();
}

export function getModelCall(callId: string): ActiveModelCall | undefined {
  return calls.get(callId);
}

export function listModelCalls(): ActiveModelCall[] {
  return [...calls.values()];
}

export function resetModelCallsForTests(): void {
  calls.clear();
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Missing token fields stay null. They are not coerced to zero. */
export function usageFromUnknown(raw: unknown): ModelCallUsage {
  if (!raw || typeof raw !== "object") {
    return { ...EMPTY_USAGE };
  }
  const record = raw as Record<string, unknown>;
  const details = record.prompt_tokens_details;
  const nestedCached =
    details && typeof details === "object"
      ? finiteOrNull((details as { cached_tokens?: unknown }).cached_tokens)
      : null;
  return {
    input: finiteOrNull(
      record.input ??
        record.inputTokens ??
        record.promptTokens ??
        record.input_tokens ??
        record.prompt_tokens,
    ),
    output: finiteOrNull(
      record.output ??
        record.outputTokens ??
        record.completionTokens ??
        record.output_tokens ??
        record.completion_tokens,
    ),
    cacheRead: finiteOrNull(
      record.cacheRead ??
        record.cache_read ??
        record.cache_read_input_tokens ??
        record.cached_tokens ??
        nestedCached,
    ),
    cacheWrite: finiteOrNull(
      record.cacheWrite ?? record.cache_write ?? record.cache_creation_input_tokens,
    ),
  };
}

export function usageFingerprint(usage: ModelCallUsage): string {
  return createHash("sha256").update(JSON.stringify(usage)).digest("hex");
}

function callsDir(storeRoot: string): string {
  return path.join(storeRoot, "executor-evidence", "calls");
}

function persist(evidence: ModelCallEvidence): void {
  evidence.persisted = false;
  evidence.durableAcrossRestart = false;
  if (!executorEvidenceCollectionEnabled() || !evidence.collector) {
    return;
  }
  const root = (evidence as ActiveModelCall & { storeRoot?: string }).storeRoot;
  if (!root) {
    return;
  }
  try {
    const dir = callsDir(root);
    fs.mkdirSync(dir, { recursive: true });
    const existing = fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
    const file = path.join(dir, `${evidence.evidenceId}.json`);
    if (!fs.existsSync(file) && existing.length >= MODEL_CALL_FILE_CAP) {
      return;
    }
    const {
      finished: _finished,
      storeRoot: _root,
      ...body
    } = evidence as ActiveModelCall & {
      storeRoot?: string;
    };
    fs.writeFileSync(
      file,
      `${JSON.stringify({ ...body, persisted: true, durableAcrossRestart: true }, null, 2)}\n`,
    );
    evidence.persisted = true;
    evidence.durableAcrossRestart = true;
  } catch {
    // Evidence persistence must not change the model call's business result.
    evidence.persisted = false;
    evidence.durableAcrossRestart = false;
  }
}

export function beginModelCall(params: {
  context: ExecutorEvidenceContext;
  attemptId: string;
  attemptKind: ModelCallAttemptKind;
  provider: string;
  model: string;
  parentCallId?: string | null;
  nowMs?: number;
}): ActiveModelCall {
  const now = params.nowMs ?? Date.now();
  const evidence: ActiveModelCall & { storeRoot?: string } = {
    schemaVersion: 1,
    evidenceId: `mce_${randomUUID()}`,
    agentId: params.context.agentId,
    scope: params.context.scope,
    taskId: params.context.taskId,
    runId: params.context.runId,
    attemptId: params.attemptId,
    attemptKind: params.attemptKind,
    callId: `call_${randomUUID()}`,
    parentCallId: params.parentCallId ?? null,
    providerRequestId: null,
    providerResponseId: null,
    provider: params.provider,
    model: params.model,
    startedAt: now,
    completedAt: null,
    observedAt: now,
    status: "unknown",
    terminalCause: "none",
    usageSource: "unobserved",
    usageAggregation: "provider_aggregate_internal_retries_unknown",
    usage: { ...EMPTY_USAGE },
    provenance: params.context.provenance ?? "unknown",
    collector: params.context.collector ?? "executor-evidence",
    localIdentity: {
      proves: "executor_attempt_allocated_before_return",
      doesNotProve: "provider_request_identity_when_ids_null",
    },
    persisted: false,
    durableAcrossRestart: false,
    finished: false,
    storeRoot: params.context.storeRoot,
  };
  calls.set(evidence.callId, evidence);
  persist(evidence);
  return evidence;
}

export function finishModelCall(
  call: ActiveModelCall,
  params: {
    status: ModelCallStatus;
    terminalCause?: ModelCallTerminalCause;
    usage?: unknown;
    usageSource: string;
    usageAggregation?: ModelCallEvidence["usageAggregation"];
    providerRequestId?: string | null;
    providerResponseId?: string | null;
    completedAt?: number | null;
    observedAt?: number;
  },
): ModelCallEvidence {
  if (call.finished) {
    return call;
  }
  const observedAt = params.observedAt ?? Date.now();
  call.status = params.status;
  call.terminalCause =
    params.terminalCause ??
    (params.status === "cancelled" ? "cancelled" : params.status === "failed" ? "error" : "none");
  call.usage = params.usage === undefined ? { ...EMPTY_USAGE } : usageFromUnknown(params.usage);
  call.usageSource = params.usageSource;
  call.usageAggregation = params.usageAggregation ?? "provider_aggregate_internal_retries_unknown";
  call.providerRequestId = params.providerRequestId ?? null;
  call.providerResponseId = params.providerResponseId ?? null;
  call.completedAt =
    params.status === "unknown" ? (params.completedAt ?? null) : (params.completedAt ?? observedAt);
  call.observedAt = observedAt;
  call.finished = true;
  persist(call);
  return call;
}

export async function runWithModelCall<T>(call: ActiveModelCall, fn: () => Promise<T>): Promise<T> {
  return await callStorage.run(call, fn);
}

/**
 * Real fallback-candidate boundary. Allocates callId before `run`, and still
 * returns `run`'s value when evidence persistence fails.
 */
export async function observeModelCandidate<T>(params: {
  context?: ExecutorEvidenceContext | null;
  attemptIndex: number;
  provider: string;
  model: string;
  parentCallId?: string | null;
  run: (identity: { callId: string; evidenceId: string; attemptId: string } | null) => Promise<T>;
  classifyError?: (err: unknown) => "cancelled" | "timeout" | "error";
  usageFromResult?: (result: T) => unknown;
}): Promise<T> {
  if (!params.context) {
    return await params.run(null);
  }
  const attemptId = `${params.context.runId}:fallback:${params.attemptIndex}:${params.provider}/${params.model}`;
  const call = beginModelCall({
    context: params.context,
    attemptId,
    attemptKind: "fallback_candidate",
    provider: params.provider,
    model: params.model,
    parentCallId: params.parentCallId,
  });
  try {
    const result = await runWithModelCall(call, () =>
      params.run({ callId: call.callId, evidenceId: call.evidenceId, attemptId: call.attemptId }),
    );
    if (!call.finished) {
      const readUsage =
        params.usageFromResult ??
        ((value: T) => {
          if (!value || typeof value !== "object") {
            return undefined;
          }
          return (value as { meta?: { agentMeta?: { usage?: unknown } } }).meta?.agentMeta?.usage;
        });
      finishModelCall(call, {
        status: "completed",
        terminalCause: "none",
        usage: readUsage(result),
        usageSource: "attempt_result.meta.agentMeta.usage",
        usageAggregation: "provider_aggregate_internal_retries_unknown",
      });
    }
    return result;
  } catch (err) {
    if (!call.finished) {
      const kind = params.classifyError?.(err) ?? "error";
      finishModelCall(call, {
        status: kind === "cancelled" ? "cancelled" : "failed",
        terminalCause:
          kind === "timeout" ? "timeout" : kind === "cancelled" ? "cancelled" : "error",
        usageSource: "absent",
        usageAggregation: "per_call",
      });
    }
    throw err;
  }
}

export function loadPersistedModelCalls(storeRoot: string): ModelCallEvidence[] {
  const dir = callsDir(storeRoot);
  if (!fs.existsSync(dir)) {
    return [];
  }
  const loaded: ModelCallEvidence[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      loaded.push(JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as ModelCallEvidence);
    } catch {
      // A corrupt file is a gap, not a fabricated call.
    }
  }
  return loaded;
}
