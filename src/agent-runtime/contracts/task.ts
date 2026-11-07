import type { TaskAcceptanceCheck } from "./quality.js";
/** Existing session-task contracts only; not a unified collaboration plan schema.
 * Type-only: runtime mutations and persistence remain with the original state owner.
 */
export type TaskStop = {
  summary: string;
  workspacePaths: string[];
};

/**
 * One owner constraint / revision entry (slice3).
 * History is append-only; `superseded` marks coverage for resume — rows are never deleted
 * by keyword scanning. Only an explicit *full replace* supersedes prior active rows;
 * local `revise` / `supplement` keep them active (resume notes conflict coverage).
 */
export type ConstraintEntry = {
  text: string;
  atMs: number;
  kind: "supplement" | "revise";
  superseded?: boolean;
};

/** Legacy boards may still store bare strings; normalize on read. */
export type ConstraintEntryInput = string | ConstraintEntry;

export type TrackedTask = {
  /** Criteria captured at explicit execution admission, not inferred from a finished reply. */
  acceptanceCriteria?: string[];
  acceptanceChecks?: TaskAcceptanceCheck[];
  admissionRequestId?: string;
  taskId: string;
  title: string;
  goalText: string;
  unfinished: boolean;
  deliverableChecked?: boolean;
  stop: TaskStop;
  parkedAtMs?: number;
  createdAtMs: number;
  /** Why this task was parked (automatic switch, cron surface, etc.). */
  parkReason?: string;
  /** When true, automatic task_board_continue wake stays suppressed until resume. */
  wakeSuppress?: boolean;
  /**
   * Full owner same-task constraint log (not truncated). Append-only history.
   * Active (= !superseded) entries bind resume; stop.summary is display/stop only.
   * Legacy string[] is normalized on read.
   */
  effectiveConstraints?: ConstraintEntryInput[];
  /** Deliverable version stamp for late-complete isolation (C4). */
  deliverableVersion?: string;
  /** Execution attempt stamp for late-complete isolation (C4). */
  executionAttempt?: string;
};

/** CLOSE tombstone — blocks wake / late results / resume resurrection (C5). */
export type TaskTombstone = {
  taskId: string;
  closedAtMs: number;
  title?: string;
};

/** Capacity overflow archive — searchable, not a continue target (C6 / §3.6). */
export type ArchivedTask = TrackedTask & {
  archivedAtMs: number;
  archiveReason: string;
};

/**
 * Focus scope: tenant + user + session. Boards are already per-session file;
 * optional scope fields make isolation explicit for AC18.
 */
export type TaskBoardScope = {
  tenantId?: string;
  userId?: string;
  sessionId?: string;
};

export type SessionTaskBoard = {
  current?: TrackedTask;
  parked: TrackedTask[];
  /**
   * Authoritative focus epoch (C1). Bumps only on successful atomic insert or
   * legal resume — never from mtime / model time / message arrival time.
   */
  focusRevision: number;
  /**
   * Monotonic board write generation (slice3). Bumped from *on-disk* epoch inside
   * the shared file lock on every successful write — independent of focusRevision.
   */
  writeEpoch?: number;
  /** CLOSE tombstones (C5). */
  tombstones?: TaskTombstone[];
  /** Searchable archive for parked>MAX overflow (C6). */
  archived?: ArchivedTask[];
  /** Optional tenant+user+session scope (C1 / AC18). */
  scope?: TaskBoardScope;
};

export type IncomingTurnResult = {
  board: SessionTaskBoard;
  action: "continue" | "switch" | "resume" | "cancel_parked";
  taskId: string;
  cutContext: boolean;
  statusLine?: string;
  restoredPrompt?: string;
  currentTitle?: string;
  incomingTitle?: string;
  droppedTitle?: string;
  droppedPaths?: string[];
  /** Focus revision after this mutation (C1). */
  focusRevision?: number;
  /**
   * Resume success does NOT imply immediate auto-execute (C6).
   * Callers must not schedule continue solely because action==="resume".
   */
  scheduleContinue?: boolean;
  rejectedReason?: string;
  /**
   * Owner pause/cancel of the *current* unfinished task: callers must abort the
   * in-flight run via the existing abort path (same as task-park cutContext).
   * Does not by itself bump focusRevision.
   */
  abortInFlight?: boolean;
};

/** Binding captured at request admission and carried across queue/execution/completion. */
export type TaskCompletionBinding = {
  /** Accepted constraints captured when this attempt is claimed; never model supplied. */
  constraints?: readonly string[];
  taskId: string;
  executionAttempt?: string;
  deliverableVersion?: string;
};

export type CurrentTaskResumeRequest = {
  taskId: string;
  expectedFocusRevision: number;
  expectedWriteEpoch: number;
};
export type CurrentTaskResumeResult =
  | { kind: "accepted"; binding: TaskCompletionBinding; acceptance: readonly string[] }
  | { kind: "rejected"; reason: string };

/** Trusted snapshot captured by the host before task side effects. */
export type TaskActionBoundary = {
  sessionFile: string;
  binding: TaskCompletionBinding;
  constraints: readonly string[];
};
