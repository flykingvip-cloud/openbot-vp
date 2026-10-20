/**
 * Local disk read approval — pure parsers and queue reducers.
 *
 * Mirrors `controllers/exec-approval.ts`, with one substantive difference: this
 * approval type has only two decisions. There is no "always allow", because a
 * standing permission for a path is not something the grant can express
 * (docs/design/openbot-local-disk-read-grant-2026-09-29.md section 4.11).
 *
 * No DOM, no gateway, no lit. Payloads arrive from the wire as `unknown` and any
 * missing required field yields `null` rather than a defaulted card — a card that
 * understated what it grants would be worse than no card.
 */

export type LocalFileApprovalTask = "read-file" | "list-directory" | "inspect-archive";

export type LocalFileApprovalBudget = {
  maxEntriesRead: number;
  maxTotalExpandedBytes: number;
  maxCalls: number;
};

export type LocalFileApprovalRequestPayload = {
  /** Canonical path as the node resolved it, never a gateway-assembled string. */
  canonicalPath: string;
  targetKind: "file" | "directory";
  task: LocalFileApprovalTask;
  /** Human wording for what is granted, supplied by the gateway. */
  taskDescription: string;
  agentId: string;
  userId: string;
  tenantId: string;
  /** Present for bounded tasks so the card cannot understate the grant. */
  budget?: LocalFileApprovalBudget | null;
  /** Paired computer name. Presentation only; never a routing key. */
  nodeDisplayName?: string;
};

export type LocalFileApprovalRequest = {
  id: string;
  request: LocalFileApprovalRequestPayload;
  createdAtMs: number;
  expiresAtMs: number;
};

export type LocalFileApprovalResolved = {
  id: string;
  decision?: string | null;
  resolvedBy?: string | null;
};

/** Allow Once is this turn. Allow Always remembers the exact path. */
export type LocalFileApprovalDecision = "allow-once" | "allow-always" | "deny";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseBudget(value: unknown): LocalFileApprovalBudget | null {
  if (!isRecord(value)) {
    return null;
  }
  const entries = value.maxEntriesRead;
  const bytes = value.maxTotalExpandedBytes;
  const calls = value.maxCalls;
  if (typeof entries !== "number" || typeof bytes !== "number" || typeof calls !== "number") {
    return null;
  }
  return { maxEntriesRead: entries, maxTotalExpandedBytes: bytes, maxCalls: calls };
}

function parseTask(value: unknown): LocalFileApprovalTask | null {
  return value === "read-file" || value === "list-directory" || value === "inspect-archive"
    ? value
    : null;
}

export function parseLocalFileApprovalRequested(payload: unknown): LocalFileApprovalRequest | null {
  if (!isRecord(payload)) {
    return null;
  }
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  if (!id) {
    return null;
  }
  // The gateway sends a flat summary, not a nested `request` object like exec
  // approvals; accept either so a shape change on one side is not silently fatal.
  const source = isRecord(payload.request) ? payload.request : payload;

  const canonicalPath = typeof source.canonicalPath === "string" ? source.canonicalPath.trim() : "";
  const task = parseTask(source.task);
  const targetKind =
    source.targetKind === "file" || source.targetKind === "directory" ? source.targetKind : null;
  if (!canonicalPath || !task || !targetKind) {
    return null;
  }
  const createdAtMs = typeof payload.createdAtMs === "number" ? payload.createdAtMs : 0;
  const expiresAtMs = typeof payload.expiresAtMs === "number" ? payload.expiresAtMs : 0;
  if (!createdAtMs || !expiresAtMs) {
    // Without a window we cannot show how long is left, and the card would never
    // auto-clear when the server-side timeout denies it.
    return null;
  }

  return {
    id,
    request: {
      canonicalPath,
      targetKind,
      task,
      taskDescription:
        typeof source.taskDescription === "string" && source.taskDescription.trim()
          ? source.taskDescription.trim()
          : task,
      agentId: typeof source.agentId === "string" ? source.agentId : "",
      userId: typeof source.userId === "string" ? source.userId : "",
      tenantId: typeof source.tenantId === "string" ? source.tenantId : "",
      budget: parseBudget(source.budget),
      ...(typeof source.nodeDisplayName === "string" && source.nodeDisplayName.trim()
        ? { nodeDisplayName: source.nodeDisplayName.trim() }
        : {}),
    },
    createdAtMs,
    expiresAtMs,
  };
}

export function parseLocalFileApprovalResolved(payload: unknown): LocalFileApprovalResolved | null {
  if (!isRecord(payload)) {
    return null;
  }
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  if (!id) {
    return null;
  }
  return {
    id,
    decision: typeof payload.decision === "string" ? payload.decision : null,
    resolvedBy: typeof payload.resolvedBy === "string" ? payload.resolvedBy : null,
  };
}

export function pruneLocalFileApprovalQueue(
  queue: LocalFileApprovalRequest[],
): LocalFileApprovalRequest[] {
  const now = Date.now();
  return queue.filter((entry) => entry.expiresAtMs > now);
}

export function addLocalFileApproval(
  queue: LocalFileApprovalRequest[],
  entry: LocalFileApprovalRequest,
): LocalFileApprovalRequest[] {
  const next = pruneLocalFileApprovalQueue(queue).filter((item) => item.id !== entry.id);
  next.push(entry);
  return next;
}

export function removeLocalFileApproval(
  queue: LocalFileApprovalRequest[],
  id: string,
): LocalFileApprovalRequest[] {
  return pruneLocalFileApprovalQueue(queue).filter((entry) => entry.id !== id);
}
