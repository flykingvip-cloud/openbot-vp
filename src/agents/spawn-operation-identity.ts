import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { OperationIdentity } from "../agent-runtime/contracts/operation.js";
import { executionOperationKey } from "../agent-runtime/contracts/operation.js";

/** Replays of the same persisted provider call reuse identity; regenerated calls remain distinct. */
export function createSpawnOperationResolver(input: {
  root: string;
  tenantId: string;
  taskId: string;
  logicalExecutionId: string;
}) {
  return async (callId: string): Promise<OperationIdentity> => {
    if (!callId.trim()) {
      throw new Error("Spawn requires a recorded tool call identity");
    }
    const tuple = [input.tenantId, input.taskId, input.logicalExecutionId, callId];
    const file = path.join(
      input.root,
      `${createHash("sha256").update(JSON.stringify(tuple)).digest("hex")}.json`,
    );
    const identity: OperationIdentity = {
      tenantId: input.tenantId,
      taskId: input.taskId,
      executionId: input.logicalExecutionId,
      stepId: callId,
      operationId: randomUUID(),
    };
    executionOperationKey(identity);
    await fs.mkdir(input.root, { recursive: true, mode: 0o700 });
    // Publish only a complete private file; link is atomic and never replaces a winner.
    const staging = `${file}.${process.pid}.${randomUUID()}.pending`;
    try {
      const handle = await fs.open(staging, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(identity));
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await fs.link(staging, file);
        const directory = await fs.open(input.root, "r");
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
        return identity;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw error;
        }
      }
    } finally {
      await fs.rm(staging, { force: true });
    }
    const prior = JSON.parse(await fs.readFile(file, "utf8")) as OperationIdentity;
    executionOperationKey(prior);
    if (
      prior.tenantId !== input.tenantId ||
      prior.taskId !== input.taskId ||
      prior.executionId !== input.logicalExecutionId ||
      prior.stepId !== callId
    ) {
      throw new Error("Persisted spawn operation identity mismatch");
    }
    return prior;
  };
}
