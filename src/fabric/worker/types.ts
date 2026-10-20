/**
 * worker/types.ts — Fabric Worker Runtime contract (development-supervisor M0).
 *
 * The single, unified abstraction every coding agent (Kiro / Codex / Claude Code,
 * and future Docker / GitHub / Browser workers) is driven through. The Supervisor
 * engine depends ONLY on this `Worker` interface + the registry — never on a
 * concrete backend — so onboarding the Nth worker needs zero supervisor changes
 * (R10, design Property 11).
 *
 * Two orthogonal capability axes (CTO review):
 *  - taskCapabilities: WHAT a worker can do (coding/edit/terminal/git/test).
 *  - control:          HOW it can be supervised (streaming/checkpoint/cancellable/
 *                      interactive) → drives the realtime-vs-polling degradation.
 *
 * Runtime identity and placement are deliberately NOT part of the static Worker
 * definition. They are resolved per run into `ExecutionContext`.
 *
 * Design: `.kiro/specs/development-supervisor/design.md` (Fabric Worker Runtime).
 */

/** WHAT a worker can do. */
export type WorkerTaskCapability = "coding" | "edit" | "terminal" | "git" | "test";

/** HOW a worker can be supervised (degradation signal). */
export type WorkerControlCapability = "streaming" | "checkpoint" | "cancellable" | "interactive";

/** WHO provides the identity used by a worker run. */
export type CredentialPolicy = "enterprise_shared" | "local_ide_login" | "seat_personal";

/** WHERE the worker run executes. */
export type ExecutionPlacement = "gateway" | "node_agent";

/** Safe degradation behavior when placement resolution cannot satisfy the request. */
export type PlacementFallback = "escalate" | "queue_until_online" | "deny";

/** Read-only credential/auth health surfaced to operators. Never includes secret values. */
export type CredentialStatus = "missing" | "configured" | "validated" | "expired" | "invalid";

export interface ResolvedIdentity {
  policy: CredentialPolicy;
  status: CredentialStatus;
  /** Resolved SecretRef env, present only when a gateway-style executor needs env injection. */
  credentialEnv?: Record<string, string>;
  credentialId?: string;
}

export interface ResolvedPlacement {
  placement: ExecutionPlacement;
  executor: "gateway" | "node_agent";
  nodeAgentId?: string;
  fallback: PlacementFallback;
}

export interface ExecutionAttribution {
  tenantId?: string;
  userId?: string;
  seatId?: string;
  credentialId?: string;
  workerId: string;
  model?: string;
}

/**
 * Per-run immutable execution unit: Worker definition + this context = one run.
 * Store/report only redacted identifiers/status; never persist credentialEnv.
 */
export interface ExecutionContext {
  identity: ResolvedIdentity;
  placement: ResolvedPlacement;
  attribution: ExecutionAttribution;
}

export interface CredentialResolver {
  resolve(input: {
    tenantId?: string;
    seatId?: string;
    workerId: string;
    model?: string;
    policy: CredentialPolicy;
  }): Promise<ResolvedIdentity>;
}

export type PlacementResolution =
  | ResolvedPlacement
  | { fallback: PlacementFallback; reason: string };

export interface PlacementResolver {
  resolve(input: {
    tenantId?: string;
    seatId?: string;
    workerId: string;
    requested: ExecutionPlacement;
    fallback?: PlacementFallback;
  }): Promise<PlacementResolution>;
}

export interface WorkerAuthProbe {
  probe(input: {
    workerId: string;
    placement: ResolvedPlacement;
    identity: ResolvedIdentity;
  }): Promise<{
    installed: boolean;
    authenticated: boolean;
    status: CredentialStatus;
    expiresAt?: string;
    source: "probe" | "declared";
    reason?: string;
  }>;
}

/** Handle to one started worker run. Intentionally minimal — NO CLI/session
 * concept leaks here (P0-2); the CLI adapter maps runId→cliSessionId internally. */
export interface WorkerRunHandle {
  runId: string;
  workerId: string;
}

/** Coarse lifecycle phase (P0-1). `isTerminalStatus` is the single terminal test. */
export type RunPhase = "pending" | "running" | "terminal";

/** Terminal outcome — present iff phase === "terminal" (P0-1). */
export type RunOutcome = "succeeded" | "failed" | "cancelled" | "timed_out";

export interface RunStatus {
  phase: RunPhase;
  /** Set iff `phase === "terminal"`. */
  outcome?: RunOutcome;
  exitCode?: number;
  /** Redacted result summary (never secret values). */
  summary?: string;
  usage?: { input?: number; output?: number };
}

/** The single terminal predicate the Supervisor engine relies on (P0-1). */
export function isTerminalStatus(status: RunStatus): boolean {
  return status.phase === "terminal";
}

/** A streamed (or terminal) log/progress event — mirrors Fabric ExecutionEvent shape. */
export interface WorkerLogEvent {
  type: "stdout" | "stderr" | "status" | "progress";
  data?: string;
  phase?: string;
}

export interface WorkerStartInput {
  task: { goal: string; prompt: string };
  workspaceDir: string;
  /** CLI workers map this to their modelArg. */
  model?: string;
  /**
   * Opaque continuity key for multi-turn runs (e.g. the supervised taskId). The
   * adapter decides how to honor it — the CLI adapter resumes the same CLI
   * session under this key; session-less workers (Docker/GitHub) may ignore it.
   * NO CLI `sessionId` is exposed at this generic boundary (P0-2).
   */
  continuityKey?: string;
  timeoutMs: number;
  /** Pre-resolved SecretRef credential env (never logged). */
  credentialEnv?: Record<string, string>;
  /** Per-run identity/placement/attribution context. */
  executionContext?: ExecutionContext;
}

/**
 * The unified Worker. Implementations: CliWorker (M0), future Docker/GitHub/…
 * `logs` streams when `control` includes "streaming"; otherwise it degrades to a
 * single terminal event and the supervisor polls `status` instead (D-LIVE).
 */
export interface Worker {
  readonly id: string;
  readonly taskCapabilities: readonly WorkerTaskCapability[];
  readonly control: readonly WorkerControlCapability[];
  start(input: WorkerStartInput): Promise<WorkerRunHandle>;
  status(runId: string): Promise<RunStatus>;
  cancel(runId: string): Promise<void>;
  logs(runId: string): AsyncIterable<WorkerLogEvent>;
}

/** True when the worker can be supervised in real time (streaming logs). */
export function supportsStreaming(worker: Pick<Worker, "control">): boolean {
  return worker.control.includes("streaming");
}

/** True when an in-flight run can be cancelled promptly. */
export function supportsCancel(worker: Pick<Worker, "control">): boolean {
  return worker.control.includes("cancellable");
}
