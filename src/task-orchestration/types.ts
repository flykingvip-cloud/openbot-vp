/**
 * Orchestration Plane — frozen domain contracts (P4.5).
 *
 * Dispatcher between ConversationTask (identity) and Progress Ledger (facts).
 * This module is **dormant / default-off**: nothing here invokes web_search,
 * web_fetch, browser, nodes/system.run, or sessions_spawn; nothing writes a
 * Ledger; nothing creates a ConversationTask; nothing changes chat.send.
 *
 * Fact chain (execution-plan.md §1):
 *
 *   Conversation -> Detection -> Qualification -> Activation
 *     -> ConversationTask -> Orchestrator (dispatcher) -> Execution Events
 *     -> Progress Ledger -> Evidence / Acceptance -> Projection
 *
 * `nodeId` bindings, if any, live in this partition — never on ConversationTask
 * / conversation_tasks rows (A1 freeze, CT2). A sqlite table is deferred.
 */

import type { OrchReasonCode } from "./reason-codes.js";

/** P4.5: live tool invoke is not implemented. Do not flip this in this slice. */
export const ORCHESTRATION_LIVE_INVOKE = false;

/**
 * Personal sessions_spawn workers MAY be used later as bounded helpers.
 * They are NOT a P7 Mission. P4.5 does not spawn. Depth is capped so a worker
 * cannot recursively mint unbounded workers (`createSessionsSpawnTool`).
 */
export const PERSONAL_SUBAGENT_MAX_DEPTH = 1;

/**
 * Execution surfaces for routing. Replaces overly coarse SideEffectClass for
 * *routing only*. Duration classification and authorization stay orthogonal;
 * CTR `SideEffectClass` is unchanged (P2 freeze).
 */
export type ExecutionSurface =
  | "memory"
  | "skill"
  | "connector"
  | "web_read"
  | "browser"
  | "node_fs_read"
  | "node_exec"
  | "outbound_message"
  | "external_write"
  | "broadcast";

export const EXECUTION_SURFACES: readonly ExecutionSurface[] = [
  "memory",
  "skill",
  "connector",
  "web_read",
  "browser",
  "node_fs_read",
  "node_exec",
  "outbound_message",
  "external_write",
  "broadcast",
] as const;

/**
 * Capability ladder rungs in order. Skipping ahead while a lower rung is
 * sufficient is `blocked_policy`. Auth surfaces (outbound/external/broadcast)
 * are not on this ladder — P4.5 they always human-gate.
 */
export const CAPABILITY_LADDER: readonly ExecutionSurface[] = [
  "memory",
  "skill",
  "connector",
  "web_read",
  "browser",
  "node_fs_read",
  "node_exec",
] as const;

export type SurfaceDecisionKind = "selected" | "human_gate" | "skip" | "blocked_policy" | "noop";

/**
 * Pure router output. P4.5 `enqueue`/`invoke` are always false — the router
 * never materializes work.
 */
export type SurfaceDecision = {
  kind: SurfaceDecisionKind;
  surface?: ExecutionSurface;
  reasonCodes: readonly OrchReasonCode[];
  enqueue: boolean;
  invoke: boolean;
};

/**
 * In-memory job shape for a future enqueue path. P4.5 never materializes one
 * on the live path. `nodeId` belongs here, not on ConversationTask.
 */
export type OrchestratorJob = {
  jobId: string;
  taskId: string;
  stepId: string;
  surface: ExecutionSurface;
  /** Paired user-machine node. Never persist this onto conversation_tasks. */
  nodeId?: string;
  status: "shadow" | "queued" | "dormant";
};

export type OrchestrationFlags = {
  shadowEnabled: boolean;
  dispatchEnabled: boolean;
  nodeEnabled: boolean;
  browserEnabled: boolean;
};

export type StepIntent =
  | "recall_memory"
  | "apply_skill"
  | "use_connector"
  | "read_web"
  | "interact_web"
  | "read_user_machine"
  | "exec_user_machine"
  | "send_message"
  | "write_external"
  | "broadcast";

/** Path kind: workspace-relative is the gateway sandbox, never the user machine. */
export type PathKind = "none" | "workspace" | "node";

/**
 * Paired-node inventory for fail-closed routing.
 * User machine = paired nodeId from `listNodes` / `nodes` tool.
 * Zero bound nodes, or multiple unbound nodes → Human Gate.
 */
export type NodeInventory = {
  /** Node ids already bound to this orchestration job/task (not the CTR row). */
  boundNodeIds: readonly string[];
  /** Paired nodes with no orchestration binding. */
  unboundCount: number;
};

export type RouteStepInput = {
  intent: StepIntent;
  flags: OrchestrationFlags;
  skillId?: string;
  /** Connectors already connected (e.g. "gmail"). Prefer these over browser. */
  connectedConnectorIds?: readonly string[];
  requestedConnectorId?: string;
  /** Caller asking to skip the ladder — rejected when a lower rung suffices. */
  requestedSurface?: ExecutionSurface;
  pathKind?: PathKind;
  nodeInventory?: NodeInventory;
};

/**
 * Personal sessions_spawn helper (not a Mission). Types/comments only in P4.5.
 */
export type PersonalSubagentBinding = {
  readonly kind: "personal_subagent";
  readonly notMission: true;
  depth: number;
};

export function emptyOrchestrationFlags(): OrchestrationFlags {
  return {
    shadowEnabled: false,
    dispatchEnabled: false,
    nodeEnabled: false,
    browserEnabled: false,
  };
}

export function shadowOrchestrationFlags(
  overrides: Partial<OrchestrationFlags> = {},
): OrchestrationFlags {
  return {
    shadowEnabled: true,
    dispatchEnabled: false,
    nodeEnabled: false,
    browserEnabled: false,
    ...overrides,
  };
}

export function isCapabilitySurface(surface: ExecutionSurface): boolean {
  return (CAPABILITY_LADDER as readonly string[]).includes(surface);
}

export function ladderIndex(surface: ExecutionSurface): number {
  const index = CAPABILITY_LADDER.indexOf(surface);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}
