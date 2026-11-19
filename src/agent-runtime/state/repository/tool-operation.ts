import fs from "node:fs/promises";
import { writeJsonAtomic } from "../../../infra/json-files.js";
import type { PersistedOperation } from "../../contracts/operation.js";

/** No automatic retries: lack of a result is not proof the external write failed. */
export class ToolOperationOutcomeUnknownError extends Error {
  constructor(readonly operationId: string) {
    super(`External operation ${operationId} requires reconciliation before retry`);
    this.name = "ToolOperationOutcomeUnknownError";
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
