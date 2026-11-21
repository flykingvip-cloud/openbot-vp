import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  executionOperationKey,
  type OperationIdentity,
} from "../agent-runtime/contracts/operation.js";
import {
  executeClaimedToolOperation,
  readToolOperation,
  ToolOperationOutcomeUnknownError,
} from "../agent-runtime/state/repository/tool-operation.js";

/** Exclusive claim precedes child creation; unknown claims never dispatch twice. */
export async function dispatchChildOnce<T>(input: {
  root: string;
  identity: OperationIdentity;
  requesterSessionKey: string;
  request: unknown;
  dispatch: () => Promise<T>;
}): Promise<T> {
  const key = executionOperationKey(input.identity);
  const digest = createHash("sha256")
    .update(JSON.stringify([input.requesterSessionKey, input.request]))
    .digest("hex");
  await fs.mkdir(input.root, { recursive: true, mode: 0o700 });
  const claim = path.join(input.root, `${createHash("sha256").update(key).digest("hex")}.json`);
  const staging = `${claim}.${process.pid}.${randomUUID()}.pending`;
  try {
    try {
      await fs.writeFile(staging, JSON.stringify({ key, digest }), { flag: "wx", mode: 0o600 });
      await fs.link(staging, claim);
    } finally {
      await fs.rm(staging, { force: true });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    const previous = JSON.parse(await fs.readFile(claim, "utf8")) as {
      key: string;
      digest: string;
    };
    if (previous.key !== key || previous.digest !== digest) {
      throw new Error("Child operation request conflicts with persisted dispatch", {
        cause: error,
      });
    }
    const receipt = await readToolOperation<T>(`${claim}.result`);
    if (receipt?.state === "succeeded" && receipt.operationId === key) {
      return receipt.result as T;
    }
    throw new ToolOperationOutcomeUnknownError(key);
  }
  return executeClaimedToolOperation({
    file: `${claim}.result`,
    operationId: key,
    run: input.dispatch,
  });
}
