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
export const MODEL_CALL_FILE_CAP = 64;
export const MODEL_CALL_MEMORY_CAP = 64;
export const EVIDENCE_DISK_BYTE_CAP = 512_000;

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
  /** Usage noted from a model response. This is not the candidate's terminal state. */
  modelResponseStatus: "unobserved" | "observed" | "absent";
  /** False when completedAt or observedAt precedes startedAt, or a timestamp is not finite. */
  timeOrderValid: boolean;
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

/** Collection is off unless the process explicitly opts in. */
export function executorEvidenceCollectionEnabled(): boolean {
  return process.env.OPENBOT_EXECUTOR_EVIDENCE === "1";
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

function countOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
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
      ? countOrNull((details as { cached_tokens?: unknown }).cached_tokens)
      : null;
  return {
    input: countOrNull(
      record.input ??
        record.inputTokens ??
        record.promptTokens ??
        record.input_tokens ??
        record.prompt_tokens,
    ),
    output: countOrNull(
      record.output ??
        record.outputTokens ??
        record.completionTokens ??
        record.output_tokens ??
        record.completion_tokens,
    ),
    cacheRead: countOrNull(
      record.cacheRead ??
        record.cache_read ??
        record.cache_read_input_tokens ??
        record.cached_tokens ??
        nestedCached,
    ),
    cacheWrite: countOrNull(
      record.cacheWrite ?? record.cache_write ?? record.cache_creation_input_tokens,
    ),
  };
}

export function directoryBytes(root: string): number {
  if (!fs.existsSync(root)) {
    return 0;
  }
  let total = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      total += directoryBytes(full);
    } else {
      total += fs.statSync(full).size;
    }
  }
  return total;
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
    const {
      finished: _finished,
      storeRoot: _root,
      ...body
    } = evidence as ActiveModelCall & {
      storeRoot?: string;
    };
    const wrote = writeBoundedEvidenceFile(
      root,
      `${evidence.evidenceId}.json`,
      { ...body, persisted: true, durableAcrossRestart: true },
      "calls",
    );
    if (wrote === "written" || wrote === "replayed") {
      evidence.persisted = true;
      evidence.durableAcrossRestart = true;
    }
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
    modelResponseStatus: "unobserved",
    timeOrderValid: true,
    finished: false,
    storeRoot: params.context.storeRoot,
  };
  if (!executorEvidenceCollectionEnabled()) {
    return evidence;
  }
  while (calls.size >= MODEL_CALL_MEMORY_CAP) {
    const oldest = [...calls.values()].toSorted((a, b) => a.startedAt - b.startedAt)[0];
    if (!oldest) {
      break;
    }
    calls.delete(oldest.callId);
  }
  calls.set(evidence.callId, evidence);
  persist(evidence);
  return evidence;
}

/** Record provider usage without sealing the candidate execution as completed. */
export function noteModelResponse(
  call: ActiveModelCall,
  params: { usage?: unknown; usageSource: string },
): void {
  call.usage = params.usage === undefined ? { ...EMPTY_USAGE } : usageFromUnknown(params.usage);
  call.usageSource = params.usageSource;
  call.modelResponseStatus = "observed";
  call.observedAt = Date.now();
  if (executorEvidenceCollectionEnabled()) {
    persist(call);
  }
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
  const completedAt =
    params.status === "unknown" ? (params.completedAt ?? null) : (params.completedAt ?? observedAt);
  const timeOrderValid =
    Number.isFinite(call.startedAt) &&
    call.startedAt >= 0 &&
    Number.isFinite(observedAt) &&
    observedAt >= call.startedAt &&
    (completedAt == null ||
      (Number.isFinite(completedAt) && completedAt >= call.startedAt && completedAt <= observedAt));
  call.timeOrderValid = timeOrderValid;
  call.status = timeOrderValid ? params.status : "unknown";
  call.terminalCause =
    params.terminalCause ??
    (params.status === "cancelled" ? "cancelled" : params.status === "failed" ? "error" : "none");
  if (params.usage !== undefined) {
    call.usage = usageFromUnknown(params.usage);
  } else if (call.modelResponseStatus !== "observed") {
    call.usage = { ...EMPTY_USAGE };
  }
  call.usageSource =
    call.modelResponseStatus === "observed" && params.usage === undefined
      ? call.usageSource
      : params.usageSource;
  call.usageAggregation = params.usageAggregation ?? "provider_aggregate_internal_retries_unknown";
  call.providerRequestId = params.providerRequestId ?? null;
  call.providerResponseId = params.providerResponseId ?? null;
  call.completedAt = completedAt;
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

export function evidenceDiskByteCap(): number {
  const raw = Number(process.env.OPENBOT_EXECUTOR_EVIDENCE_DISK_CAP);
  return Number.isFinite(raw) && raw > 0 ? raw : EVIDENCE_DISK_BYTE_CAP;
}

/** Linux starttime from /proc. Same pid after recycle has a different token. */
export function processStartToken(pid: number): string | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const end = stat.lastIndexOf(")");
    if (end < 0) {
      return null;
    }
    const fields = stat
      .slice(end + 2)
      .trim()
      .split(/\s+/);
    return fields[19] ?? null;
  } catch {
    return null;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Recover only a lock whose owner is gone or whose pid was recycled.
 * A live owner keeps the lock no matter how old it is.
 */
function recoverStaleEvidenceLock(lockPath: string): void {
  if (!fs.existsSync(lockPath)) {
    return;
  }
  try {
    const [pidText, token] = fs.readFileSync(lockPath, "utf8").split("\n");
    const pid = Number(pidText?.trim());
    if (!Number.isInteger(pid) || pid <= 0) {
      fs.rmSync(lockPath, { force: true });
      return;
    }
    const liveToken = processStartToken(pid);
    if (liveToken && token && liveToken === token.trim()) {
      return;
    }
    if (liveToken && token && liveToken !== token.trim()) {
      fs.rmSync(lockPath, { force: true });
      return;
    }
    if (processAlive(pid)) {
      return;
    }
    fs.rmSync(lockPath, { force: true });
  } catch {
    fs.rmSync(lockPath, { force: true });
  }
}

function usageDetermined(usage: ModelCallUsage | undefined): boolean {
  if (!usage) {
    return false;
  }
  return [usage.input, usage.output, usage.cacheRead, usage.cacheWrite].some(
    (value) => typeof value === "number",
  );
}

function usageSame(left: ModelCallUsage | undefined, right: ModelCallUsage | undefined): boolean {
  return (
    left?.input === right?.input &&
    left?.output === right?.output &&
    left?.cacheRead === right?.cacheRead &&
    left?.cacheWrite === right?.cacheWrite
  );
}

function legalCallAdvance(
  previous: { evidenceId?: string; callId?: string; status?: string; usage?: ModelCallUsage },
  next: { evidenceId?: string; callId?: string; status?: string; usage?: ModelCallUsage },
): boolean {
  if (
    !previous.evidenceId ||
    previous.evidenceId !== next.evidenceId ||
    previous.callId !== next.callId
  ) {
    return false;
  }
  const rank = (status: string | undefined) => (status === "unknown" || !status ? 0 : 1);
  if (rank(next.status) < rank(previous.status)) {
    return false;
  }
  if (rank(previous.status) === 1 && next.status !== previous.status) {
    return false;
  }
  if (usageDetermined(previous.usage) && !usageSame(previous.usage, next.usage)) {
    return false;
  }
  return true;
}

export function writeBoundedEvidenceFile(
  storeRoot: string,
  fileName: string,
  body: unknown,
  folder: "associations" | "calls" = "associations",
): "written" | "replayed" | "conflict" | "capped" | "failed" {
  if (!executorEvidenceCollectionEnabled()) {
    return "failed";
  }
  const root = path.join(storeRoot, "executor-evidence");
  const dir = path.join(root, folder);
  const lockPath = path.join(root, "write.lock");
  let tmp: string | undefined;
  try {
    fs.mkdirSync(root, { recursive: true });
    const started = Date.now();
    let fd: number | undefined;
    while (fd === undefined) {
      try {
        fd = fs.openSync(lockPath, "wx");
        const token = processStartToken(process.pid) ?? "unknown";
        fs.writeFileSync(fd, `${process.pid}\n${token}`);
      } catch {
        recoverStaleEvidenceLock(lockPath);
        if (Date.now() - started > 1_000) {
          return "failed";
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      }
    }
    try {
      fs.mkdirSync(dir, { recursive: true });
      for (const name of fs.readdirSync(dir)) {
        if (name.endsWith(".tmp")) {
          fs.rmSync(path.join(dir, name), { force: true });
        }
      }
      const text = `${JSON.stringify(body, null, 2)}\n`;
      const file = path.join(dir, fileName);
      let replacing = false;
      if (fs.existsSync(file)) {
        const current = fs.readFileSync(file, "utf8");
        if (current === text) {
          return "replayed";
        }
        if (folder === "associations") {
          return "conflict";
        }
        let previous: {
          evidenceId?: string;
          callId?: string;
          status?: string;
          usage?: ModelCallUsage;
        };
        try {
          previous = JSON.parse(current) as typeof previous;
        } catch {
          return "conflict";
        }
        if (!legalCallAdvance(previous, body as typeof previous)) {
          return "conflict";
        }
        replacing = true;
      }
      // Peak is the bytes already on disk plus the new temp file and lock overhead.
      // Do not subtract the file being replaced: both exist until rename.
      const incoming = Buffer.byteLength(text) + 128;
      if (directoryBytes(root) + incoming > evidenceDiskByteCap()) {
        return "capped";
      }
      const names = fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
      if (!replacing && names.length >= ASSOCIATION_FILE_CAP_LOCAL) {
        return "capped";
      }
      tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, file);
      tmp = undefined;
      return "written";
    } finally {
      if (tmp) {
        fs.rmSync(tmp, { force: true });
      }
      fs.closeSync(fd);
      fs.rmSync(lockPath, { force: true });
    }
  } catch {
    if (tmp) {
      fs.rmSync(tmp, { force: true });
    }
    return "failed";
  }
}

const ASSOCIATION_FILE_CAP_LOCAL = 64;

export function loadPersistedModelCalls(storeRoot: string): ModelCallEvidence[] {
  return readCallFiles(storeRoot).rows;
}

export function readCallFiles(storeRoot: string): { rows: ModelCallEvidence[]; gaps: string[] } {
  const dir = callsDir(storeRoot);
  if (!fs.existsSync(dir)) {
    return { rows: [], gaps: [] };
  }
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return { rows: [], gaps: ["call_read_failed"] };
  }
  const rows: ModelCallEvidence[] = [];
  const gaps: string[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      rows.push(JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as ModelCallEvidence);
    } catch {
      gaps.push("corrupt_call");
    }
  }
  return { rows, gaps };
}
