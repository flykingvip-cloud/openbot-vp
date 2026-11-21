import fs from "node:fs/promises";
import path from "node:path";
import { writeJsonAtomic } from "../../../infra/json-files.js";
import type { WaitCondition } from "../../contracts/execution-protocol.js";
import type { PersistedOperation } from "../../contracts/operation.js";

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
      !["started", "succeeded"].includes(parsed.state) ||
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

/** Called only by the owner of an existing exclusive durable side-effect claim. */
export async function executeClaimedToolOperation<T>(params: {
  file: string;
  operationId: string;
  run: () => Promise<T> | T;
  nowMs?: number;
}): Promise<T> {
  const prior = await readToolOperation<T>(params.file);
  if (prior) {
    if (prior.operationId !== params.operationId) {
      throw new Error("Operation journal identity mismatch");
    }
    if (prior.state === "succeeded") {
      return prior.result as T;
    }
    throw new ToolOperationOutcomeUnknownError(params.operationId);
  }
  const record: PersistedOperation = {
    version: 1,
    operationId: params.operationId,
    state: "started",
    startedAtMs: params.nowMs ?? Date.now(),
    wait: {
      condition: new ToolOperationOutcomeUnknownError(params.operationId).waitCondition,
      nextQueryAtMs: (params.nowMs ?? Date.now()) + 30_000,
      attempts: 0,
    },
  };
  // This must commit before calling any external writer.
  await writeJsonAtomic(params.file, record);
  const result = await params.run();
  await writeJsonAtomic(params.file, {
    ...record,
    state: "succeeded",
    completedAtMs: Date.now(),
    result,
  });
  return result;
}

/**
 * Query-only reconciliation: unknown results never authorize a retry. A provider
 * receipt may settle the existing journal; this function never invokes a writer.
 * Caller must hold the same exclusive operation ownership as execution.
 */
export async function reconcileClaimedToolOperation<T>(params: {
  file: string;
  operationId: string;
  query: () => Promise<
    { kind: "confirmed"; evidenceId: string; result: T } | { kind: "unknown"; reason: string }
  >;
}): Promise<{ kind: "confirmed"; result: T } | { kind: "unknown"; reason: string }> {
  const record = await readToolOperation<T>(params.file);
  if (!record || record.operationId !== params.operationId) {
    throw new Error("Operation journal identity mismatch");
  }
  if (record.state === "succeeded") {
    return { kind: "confirmed", result: record.result as T };
  }
  let decision: Awaited<ReturnType<typeof params.query>>;
  try {
    decision = await params.query();
  } catch (error) {
    decision = { kind: "unknown", reason: error instanceof Error ? error.message : String(error) };
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
    if (operation?.state === "started" && operation.wait && operation.wait.nextQueryAtMs <= nowMs) {
      due.push({ file, operation });
    }
  }
  return due;
}
