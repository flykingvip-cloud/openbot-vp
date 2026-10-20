/**
 * CollabDispatch Sprint D4 — structured audit trail for broadcast governance.
 *
 * Mirrors access-control audit-sink conventions: JSONL under state/audit,
 * best-effort writes that never throw into the caller. Identifiers only.
 *
 * Events: approve | deliver | cancel (design Sprint D4 / §5.6).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import type { CollabDispatchAudienceMode } from "./collab-dispatch-store.js";

export type CollabDispatchAuditAction = "approve" | "deliver" | "cancel";

export type CollabDispatchAuditEvent = {
  ts: string;
  action: CollabDispatchAuditAction;
  dispatchId: string;
  tenantId: string;
  kind: string;
  audienceMode: CollabDispatchAudienceMode;
  spaceId?: string | null;
  actorUserId: string;
  status?: string;
  detail?: Record<string, string | number | boolean | null>;
};

const AUDIT_FILE = "collab-dispatch.jsonl";

function auditFilePath(): string {
  return path.join(resolveStateDir(), "audit", AUDIT_FILE);
}

export function collabDispatchAuditPath(): string {
  return auditFilePath();
}

/** Best-effort append; never throws into callers. */
export async function appendCollabDispatchAuditEvent(
  event: CollabDispatchAuditEvent,
): Promise<void> {
  try {
    const filePath = auditFilePath();
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  } catch (error) {
    console.warn(`[collab-dispatch-audit] failed to write: ${String(error)}`);
  }
}

export async function listCollabDispatchAuditEvents(params?: {
  dispatchId?: string;
  limit?: number;
}): Promise<CollabDispatchAuditEvent[]> {
  try {
    const raw = await fs.readFile(auditFilePath(), "utf8");
    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    const limit = Math.max(1, Math.min(params?.limit ?? 200, 2000));
    const slice = lines.slice(-limit);
    const events: CollabDispatchAuditEvent[] = [];
    for (const line of slice) {
      try {
        const parsed = JSON.parse(line) as CollabDispatchAuditEvent;
        if (params?.dispatchId && parsed.dispatchId !== params.dispatchId) {
          continue;
        }
        events.push(parsed);
      } catch {
        // skip corrupt lines
      }
    }
    return events;
  } catch {
    return [];
  }
}
