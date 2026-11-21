import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { withFileLockSync, SESSION_TASK_BOARD_LOCK_OPTIONS } from "../../infra/file-lock.js";
import { writeJsonAtomicSync } from "../../infra/json-files.js";
import { listCommittedSkillInvocationAudits } from "../skill-lifecycle-store.js";
import { appendSkillInvocationEvent } from "./event-store.js";
import type { SkillInvocationCompletedEvent } from "./types.js";

/** Idempotent audit projection recovery; never executes skills or increments counters. */
export function reconcileCommittedInvocationAudits(input: {
  tenantId: string;
  userId: string;
  configDir: string;
  limit?: number;
  agentIds?: readonly string[];
}): number {
  const scopeKey = createHash("sha256")
    .update(
      JSON.stringify([
        input.tenantId,
        input.userId,
        input.agentIds ? [...input.agentIds].toSorted() : null,
      ]),
    )
    .digest("hex");
  const cursorFile = path.join(input.configDir, "skill-audit-recovery", `${scopeKey}.json`);
  return withFileLockSync(cursorFile, SESSION_TASK_BOARD_LOCK_OPTIONS, () => {
    let afterInvocationId: string | undefined;
    try {
      const cursor = JSON.parse(fs.readFileSync(cursorFile, "utf8"));
      if (typeof cursor.afterInvocationId !== "string") {
        throw new Error("Invalid audit recovery cursor");
      }
      afterInvocationId = cursor.afterInvocationId;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    const facts = listCommittedSkillInvocationAudits({ ...input, afterInvocationId });
    let projected = 0;
    for (const fact of facts) {
      if (!fact || typeof fact !== "object" || Array.isArray(fact)) {
        throw new Error("Invalid committed invocation audit");
      }
      const row = fact as Record<string, unknown>;
      if (
        row.type !== "skill_invocation_completed" ||
        typeof row.invocationId !== "string" ||
        typeof row.agentId !== "string" ||
        typeof row.skillId !== "string" ||
        typeof row.completedAt !== "number" ||
        !Number.isFinite(row.completedAt)
      ) {
        throw new Error("Invalid committed invocation audit");
      }
      appendSkillInvocationEvent(fact as SkillInvocationCompletedEvent, input.configDir);
      // Publish cursor only after the idempotent audit append succeeds.
      writeJsonAtomicSync(cursorFile, { afterInvocationId: row.invocationId });
      projected++;
    }
    // Wrap at end: late inserts with earlier IDs are visited on the next sweep.
    if (!facts.length) {
      writeJsonAtomicSync(cursorFile, { afterInvocationId: "" });
    }
    return projected;
  });
}
