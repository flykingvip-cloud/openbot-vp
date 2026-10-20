/**
 * Best-effort resolution of pattern independence task id from live run context.
 * Sync I/O only (hot path); never throws.
 */

import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../../utils.js";
import { resolvePatternTaskId, type PatternTaskIdSources } from "./task-id.js";

export type RunPatternTaskContext = PatternTaskIdSources & {
  groupId?: string | null;
  /** Collaboration / catalog conversation id when known. */
  conversationId?: string | null;
  /** Config / data root for shared-task store (defaults CONFIG_DIR parent heuristics). */
  dataRoot?: string | null;
};

/**
 * Resolve task id for pattern sampling from provenance + shared task context file.
 */
export function resolveRunPatternTaskId(ctx: RunPatternTaskContext): string | null {
  // Explicit fields first (collab task / deliverable / lineage / cron).
  const primary = resolvePatternTaskId(ctx);
  if (primary) {
    return primary;
  }

  const groupId = ctx.groupId?.trim();
  const conversationId = ctx.conversationId?.trim();
  if (!groupId || !conversationId || conversationId === ctx.sessionKey?.trim()) {
    return null;
  }

  const shared = readSharedTaskRefsSync({
    groupId,
    conversationId,
    dataRoot: ctx.dataRoot ?? null,
  });
  if (shared.taskRef) {
    return `collab:${shared.taskRef}`;
  }
  if (shared.deliverableRef) {
    return `deliverable:${shared.deliverableRef}`;
  }
  // Multi-turn collaboration conversation as one independent sample boundary
  // (not sessionKey — catalog conversationId is the collab unit of work).
  return `collab-conv:${groupId}:${conversationId}`;
}

function readSharedTaskRefsSync(params: {
  groupId: string;
  conversationId: string;
  dataRoot: string | null;
}): { taskRef: string | null; deliverableRef: string | null } {
  try {
    const roots = [
      params.dataRoot,
      process.env.OPENBOT_DATA_ROOT,
      path.join(CONFIG_DIR, ".."),
      CONFIG_DIR,
    ].filter((r): r is string => typeof r === "string" && r.trim().length > 0);

    const safeGroup = params.groupId.replace(/[^a-zA-Z0-9._-]/g, "_");
    const safeConv = params.conversationId.replace(/[^a-zA-Z0-9._-]/g, "_");

    for (const root of roots) {
      const filePath = path.join(
        root.replace(/\/$/, ""),
        ".meta/conversations/shared-task",
        safeGroup,
        `${safeConv}.json`,
      );
      if (!fs.existsSync(filePath)) {
        continue;
      }
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
        taskRefs?: unknown;
        deliverableRefs?: unknown;
      };
      const taskRef =
        Array.isArray(raw.taskRefs) && typeof raw.taskRefs[0] === "string"
          ? raw.taskRefs[0].trim()
          : "";
      const deliverableRef =
        Array.isArray(raw.deliverableRefs) && typeof raw.deliverableRefs[0] === "string"
          ? raw.deliverableRefs[0].trim()
          : "";
      return {
        taskRef: taskRef || null,
        deliverableRef: deliverableRef || null,
      };
    }
  } catch {
    // best-effort
  }
  return { taskRef: null, deliverableRef: null };
}
