/**
 * Approval type for local file reads (design 4.11).
 *
 * Reuses the approval lifecycle, not the shell-exec policy. Three differences from
 * exec approvals are deliberate:
 *
 * - Allow Once covers this turn. Allow Always remembers the exact resolved path
 *   on the device binding (a directory list does not grant child reads).
 *   Timeout, no route, and deny still refuse. There is no default-allow.
 * - Timeout, an unreachable UI and an explicit deny are all the same outcome.
 *   There is no default-allow.
 * - The prompt shows the canonical path the node returned, never a string the
 *   gateway assembled, and it names the bounded task actually being granted.
 */

import type { CapabilityBinding, TurnBudget } from "../../local-files/types.js";
import { ApprovalLifecycle, type ApprovalRecord } from "../approval-lifecycle.js";
import type { ApprovalDecision, ApprovalPort, ApprovalTask } from "./service.js";

/** Default window a user has to answer. Past it the read is refused. */
export const LOCAL_FILE_APPROVAL_TIMEOUT_MS = 90_000;

/**
 * What the card renders. Carries no capability material and no file content: it is
 * a prompt, not a grant.
 */
export type LocalFileApprovalRequest = {
  /** Canonical path as returned by the node (design 9.1 step 3). */
  canonicalPath: string;
  targetKind: "file" | "directory";
  task: ApprovalTask;
  /** Human wording, so the card and the grant describe the same task. */
  taskDescription: string;
  /** Budget the approval actually grants, so the card cannot understate it. */
  budget: TurnBudget;
  /** Paired computer name when the gateway knows it. Presentation only. */
  nodeDisplayName?: string;
  agentId: string;
  nodeId: string;
  tenantId: string;
  userId: string;
  sessionKey: string;
  turnId: string;
};

export type LocalFileApprovalRecord = ApprovalRecord<LocalFileApprovalRequest>;

export type LocalFileApprovalEvents = {
  /** Broadcast so an approval surface can render the card. */
  requested(payload: {
    id: string;
    request: LocalFileApprovalRequest;
    createdAtMs: number;
    expiresAtMs: number;
  }): void;
  resolved(payload: {
    id: string;
    decision: ApprovalDecision;
    resolvedBy?: string | null;
    request?: LocalFileApprovalRequest;
  }): void;
};

export type LocalFileApprovalOptions = {
  events: LocalFileApprovalEvents;
  /**
   * Whether any surface can currently render a card. When nothing can, the request
   * is refused immediately rather than left to time out — the user would never see
   * it, so waiting only delays the same answer (design 4.11).
   */
  hasApprovalRoute(): boolean;
  timeoutMs?: number;
};

/** Human-readable task label. Kept here so wording and grant stay in one place. */
export function describeApprovalTask(task: ApprovalTask): string {
  switch (task) {
    case "list-directory":
      return "list this directory";
    case "inspect-archive":
      return "inspect this archive";
    default:
      return "read this file";
  }
}

export class LocalFileApprovalService implements ApprovalPort {
  private readonly lifecycle = new ApprovalLifecycle<LocalFileApprovalRequest>();
  private readonly options: LocalFileApprovalOptions;

  constructor(options: LocalFileApprovalOptions) {
    this.options = options;
  }

  async requestLocalFileApproval(params: {
    binding: CapabilityBinding;
    canonicalPath: string;
    targetKind: "file" | "directory";
    task: ApprovalTask;
    budget: TurnBudget;
    nodeDisplayName?: string;
  }): Promise<ApprovalDecision> {
    const timeoutMs = this.options.timeoutMs ?? LOCAL_FILE_APPROVAL_TIMEOUT_MS;
    const request: LocalFileApprovalRequest = {
      canonicalPath: params.canonicalPath,
      targetKind: params.targetKind,
      task: params.task,
      taskDescription: describeApprovalTask(params.task),
      budget: params.budget,
      ...(params.nodeDisplayName ? { nodeDisplayName: params.nodeDisplayName } : {}),
      agentId: params.binding.agentId,
      nodeId: params.binding.nodeId,
      tenantId: params.binding.tenantId,
      userId: params.binding.userId,
      sessionKey: params.binding.sessionKey,
      turnId: params.binding.turnId,
    };

    // Refuse before registering when nothing can render the card.
    if (!this.options.hasApprovalRoute()) {
      return "deny";
    }

    const record = this.lifecycle.create(request, timeoutMs);
    let decisionPromise: Promise<"allow-once" | "allow-always" | "deny" | null>;
    try {
      decisionPromise = this.lifecycle.register(record, timeoutMs);
    } catch {
      return "deny";
    }

    this.options.events.requested({
      id: record.id,
      request,
      createdAtMs: record.createdAtMs,
      expiresAtMs: record.expiresAtMs,
    });

    const decision = await decisionPromise;
    if (decision === null) {
      // Lifecycle settles a timeout as null.
      return "timeout";
    }
    if (decision !== "allow-once" && decision !== "allow-always") {
      return "deny";
    }
    // Spend it atomically so the same approval cannot be reused.
    if (!this.lifecycle.consumeSettledGrant(record.id, decision)) {
      return "deny";
    }
    return decision;
  }

  /**
   * Record a user's decision. Returns false for an unknown or already-settled id.
   * `allow-always` remembers the exact path; it is not a standing disk grant.
   */
  resolve(params: {
    id: string;
    decision: "allow-once" | "allow-always" | "deny";
    resolvedBy?: string | null;
  }): {
    ok: boolean;
    reason?: "unknown-id" | "ambiguous-id" | "already-resolved";
  } {
    const lookup = this.lifecycle.lookupPendingId(params.id);
    if (lookup.kind === "none") {
      return { ok: false, reason: "unknown-id" };
    }
    if (lookup.kind === "ambiguous") {
      return { ok: false, reason: "ambiguous-id" };
    }
    const snapshot = this.lifecycle.getSnapshot(lookup.id);
    const ok = this.lifecycle.resolve(lookup.id, params.decision, params.resolvedBy ?? null);
    if (!ok) {
      return { ok: false, reason: "already-resolved" };
    }
    this.options.events.resolved({
      id: lookup.id,
      decision: params.decision,
      resolvedBy: params.resolvedBy ?? null,
      request: snapshot?.request,
    });
    return { ok: true };
  }

  getSnapshot(id: string): LocalFileApprovalRecord | null {
    return this.lifecycle.getSnapshot(id);
  }

  /** Cards awaiting an answer. */
  listPending(): LocalFileApprovalRecord[] {
    return this.lifecycle.listPending();
  }
}

/**
 * Operator-visible form of a pending card.
 *
 * Carries no capability material, because a card is a prompt rather than a grant —
 * and an operator answering it needs the path and the task, not a token.
 */
export type PendingApprovalSummary = {
  id: string;
  canonicalPath: string;
  targetKind: "file" | "directory";
  task: ApprovalTask;
  /** What the approval actually grants, in words, so the prompt cannot understate it. */
  taskDescription: string;
  agentId: string;
  userId: string;
  tenantId: string;
  createdAtMs: number;
  expiresAtMs: number;
};

export function summarizePendingApproval(record: LocalFileApprovalRecord): PendingApprovalSummary {
  return {
    id: record.id,
    canonicalPath: record.request.canonicalPath,
    targetKind: record.request.targetKind,
    task: record.request.task,
    taskDescription: describeApprovalTask(record.request.task),
    agentId: record.request.agentId,
    userId: record.request.userId,
    tenantId: record.request.tenantId,
    createdAtMs: record.createdAtMs,
    expiresAtMs: record.expiresAtMs,
  };
}
