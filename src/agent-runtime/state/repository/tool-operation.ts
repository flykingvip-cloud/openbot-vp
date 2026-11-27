import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { writeJsonAtomic } from "../../../infra/json-files.js";
import { acquireFileLock } from "../../../plugin-sdk/file-lock.js";
import type { WaitCondition } from "../../contracts/execution-protocol.js";
import type { PersistedOperation } from "../../contracts/operation.js";
import {
  exposeStoredHostReadBinding,
  stampHostReadBindingOnSuccess,
} from "../stored-result-read-binding.js";
import { assertFencingGenerationMatch, nextFencingGeneration } from "./fencing.js";

/** No automatic retries: lack of a result is not proof the external write failed. */
export class ToolOperationOutcomeUnknownError extends Error {
  readonly waitCondition: WaitCondition;
  constructor(readonly operationId: string) {
    super(`External operation ${operationId} requires reconciliation before retry`);
    this.name = "ToolOperationOutcomeUnknownError";
    this.waitCondition = {
      waitId: `operation:${operationId}`,
      reason: "external_operation",
      wakeOn: [`operation:${operationId}:reconciled`],
    };
  }
}

export async function readToolOperation<T>(file: string): Promise<PersistedOperation<T> | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as PersistedOperation<T>;
    if (
      parsed.version !== 1 ||
      !parsed.operationId ||
      !["started", "prepared", "not_issued", "intent", "unknown", "succeeded"].includes(
        parsed.state,
      ) ||
      !Number.isFinite(parsed.startedAtMs)
    ) {
      throw new Error(`Invalid operation journal: ${file}`);
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/** Host-only execution-local port; never supplied through model parameters. */
const admissionScope = new AsyncLocalStorage<{
  fingerprint: string;
  intent?: () => Promise<void>;
  opaque?: () => Promise<void>;
}>();
export function withToolOperationAdmission<T>(
  fingerprint: string,
  run: () => Promise<T>,
): Promise<T> {
  return admissionScope.run({ fingerprint }, run);
}
export async function commitToolOperationWriteIntent(): Promise<void> {
  await admissionScope.getStore()?.intent?.();
}

/** Persist uncertainty before entering arbitrary plugin code. */
export async function enterOpaqueToolAdmission(): Promise<void> {
  await admissionScope.getStore()?.opaque?.();
}
const trustedRefusals = new WeakMap<object, object | undefined>();
export function trustedToolAdmissionRefusal(reason: string | Error): Error {
  const error = reason instanceof Error ? reason : new Error(reason);
  trustedRefusals.set(error, admissionScope.getStore());
  return error;
}
// file-lock is process-reentrant, so serialize local contenders before acquiring it.
const admissionTails = new Map<string, Promise<void>>();
export async function executeClaimedToolOperation<T>(params: {
  file: string;
  operationId: string;
  run: () => Promise<T> | T;
  nowMs?: number;
  expectedFencingGeneration?: number;
}): Promise<T> {
  const key = path.join(await fs.realpath(path.dirname(params.file)), path.basename(params.file));
  const previous = admissionTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  admissionTails.set(key, tail);
  await previous;
  try {
    const lock = await acquireFileLock(`${key}.admission`, {
      retries: { retries: 100, factor: 1, minTimeout: 10, maxTimeout: 10 },
      stale: 60_000,
    });
    try {
      return await executeOwnedToolOperation(params);
    } finally {
      await lock.release();
    }
  } finally {
    release();
    if (admissionTails.get(key) === tail) {
      admissionTails.delete(key);
    }
  }
}

async function executeOwnedToolOperation<T>(params: {
  file: string;
  operationId: string;
  run: () => Promise<T> | T;
  nowMs?: number;
  expectedFencingGeneration?: number;
}): Promise<T> {
  const scope = admissionScope.getStore();
  const prior = await readToolOperation<T>(params.file);
  if (params.expectedFencingGeneration !== undefined) {
    assertFencingGenerationMatch({
      expectedGeneration: params.expectedFencingGeneration,
      currentGeneration: prior?.fencingGeneration ?? 0,
      resource: `tool-operation:${params.operationId}`,
    });
  }
  if (prior) {
    if (prior.operationId !== params.operationId) {
      throw new Error("Operation journal identity mismatch");
    }
    if (prior.state === "succeeded") {
      if (prior.scopeFingerprint !== scope?.fingerprint) {
        throw new Error("Operation replay scope mismatch");
      }
      exposeStoredHostReadBinding(prior.hostReadBinding);
      return prior.result as T;
    }
    // A crashed prepared owner is NOT evidence of a completed admission refusal.
    if (prior.state !== "not_issued") {
      throw new ToolOperationOutcomeUnknownError(params.operationId);
    }
    if (!scope || prior.scopeFingerprint !== scope.fingerprint) {
      throw new Error("Operation admission scope mismatch");
    }
  }
  const attemptId = randomUUID();
  const record: PersistedOperation<T> = {
    version: 1,
    operationId: params.operationId,
    state: "prepared",
    attemptId,
    fencingGeneration: nextFencingGeneration(prior?.fencingGeneration),
    scopeFingerprint: scope?.fingerprint,
    refusals: prior?.refusals ?? [],
    startedAtMs: params.nowMs ?? Date.now(),
  };
  await writeJsonAtomic(params.file, record);
  let intentAttempted = false;
  let opaqueEntered = false;
  const markOpaque = async () => {
    opaqueEntered = true;
    record.state = "unknown";
    await writeJsonAtomic(params.file, record);
  };
  const markIntent = async () => {
    if (intentAttempted) {
      throw new Error("Duplicate write intent in one attempt");
    }
    // A failed/ambiguous intent commit must never be classified as not issued.
    intentAttempted = true;
    record.state = "intent";
    record.wait = {
      condition: new ToolOperationOutcomeUnknownError(params.operationId).waitCondition,
      nextQueryAtMs: (params.nowMs ?? Date.now()) + 30_000,
      attempts: 0,
    };
    await writeJsonAtomic(params.file, record);
  };
  let attemptScope:
    | { fingerprint: string; intent: () => Promise<void>; opaque: () => Promise<void> }
    | undefined;
  try {
    attemptScope = scope
      ? { fingerprint: scope.fingerprint, intent: markIntent, opaque: markOpaque }
      : undefined;
    const result = scope
      ? await admissionScope.run(attemptScope!, params.run)
      : await (async () => {
          await markIntent();
          return params.run();
        })();
    if (!intentAttempted) {
      throw new Error("Trusted tool returned without committing write intent");
    }
    const details =
      result && typeof result === "object" ? (result as { details?: unknown }).details : undefined;
    if (
      details &&
      typeof details === "object" &&
      (details as { status?: unknown }).status === "result_unknown"
    ) {
      await writeJsonAtomic(params.file, { ...record, state: "unknown", result });
      return result;
    }
    const hostReadBinding = stampHostReadBindingOnSuccess(record.hostReadBinding);
    await writeJsonAtomic(params.file, {
      ...record,
      state: "succeeded",
      completedAtMs: Date.now(),
      result,
      ...(hostReadBinding ? { hostReadBinding } : {}),
    });
    return result;
  } catch (error) {
    await writeJsonAtomic(
      params.file,
      intentAttempted ||
        opaqueEntered ||
        !(
          error &&
          typeof error === "object" &&
          trustedRefusals.has(error) &&
          trustedRefusals.get(error) === attemptScope
        )
        ? { ...record, state: "unknown" }
        : {
            ...record,
            state: "not_issued",
            refusals: [
              ...(record.refusals ?? []),
              {
                attemptId,
                atMs: Date.now(),
                reason: error instanceof Error ? error.message : "Non-Error admission refusal",
              },
            ],
          },
    );
    throw error;
  }
}

/**
 * Query-only reconciliation: unknown results never authorize a retry. A provider
 * receipt may settle the existing journal; this function never invokes a writer.
 * Caller must hold the same exclusive operation ownership as execution.
 */
export async function reconcileClaimedToolOperation<T>(params: {
  file: string;
  operationId: string;
  expectedFencingGeneration?: number;
  query: () => Promise<
    { kind: "confirmed"; evidenceId: string; result: T } | { kind: "unknown"; reason: string }
  >;
}): Promise<{ kind: "confirmed"; result: T } | { kind: "unknown"; reason: string }> {
  const record = await readToolOperation<T>(params.file);
  if (!record || record.operationId !== params.operationId) {
    throw new Error("Operation journal identity mismatch");
  }
  if (params.expectedFencingGeneration !== undefined) {
    assertFencingGenerationMatch({
      expectedGeneration: params.expectedFencingGeneration,
      currentGeneration: record.fencingGeneration ?? 0,
      resource: `tool-operation:${params.operationId}`,
    });
  }
  if (record.state === "succeeded") {
    return { kind: "confirmed", result: record.result as T };
  }
  if (record.state === "not_issued" || record.state === "prepared") {
    throw new Error("Operation has no confirmed write-intent for reconciliation");
  }
  let decision: Awaited<ReturnType<typeof params.query>>;
  try {
    decision = await params.query();
  } catch (error) {
    decision = {
      kind: "unknown",
      reason: error instanceof Error ? error.message : "Non-Error admission refusal",
    };
  }
  if (decision.kind === "unknown") {
    const attempts = (record.wait?.attempts ?? 0) + 1;
    await writeJsonAtomic(params.file, {
      ...record,
      wait: {
        condition: new ToolOperationOutcomeUnknownError(params.operationId).waitCondition,
        nextQueryAtMs: Date.now() + Math.min(3_600_000, 30_000 * 2 ** Math.min(attempts, 7)),
        attempts,
      },
    });
    return decision;
  }
  if (!decision.evidenceId.trim()) {
    throw new Error("Reconciliation requires external evidence");
  }
  await writeJsonAtomic(params.file, {
    ...record,
    state: "succeeded",
    completedAtMs: Date.now(),
    result: decision.result,
    reconciliationEvidenceId: decision.evidenceId,
    wait: undefined,
  });
  return { kind: "confirmed", result: decision.result };
}

/** Durable due scan; callers must claim exclusive ownership before querying. */
export async function listDueToolOperations(
  dir: string,
  nowMs = Date.now(),
): Promise<
  Array<{
    file: string;
    operation: PersistedOperation;
  }>
> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const due: Array<{ file: string; operation: PersistedOperation }> = [];
  for (const name of names) {
    if (!name.endsWith(".result")) {
      continue;
    }
    const file = path.join(dir, name);
    const operation = await readToolOperation(file);
    if (
      (operation?.state === "started" ||
        operation?.state === "intent" ||
        operation?.state === "unknown") &&
      operation.wait &&
      operation.wait.nextQueryAtMs <= nowMs
    ) {
      due.push({ file, operation });
    }
  }
  return due;
}
