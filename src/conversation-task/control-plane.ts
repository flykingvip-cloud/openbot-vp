/**
 * ConversationTask Runtime — activation control plane (P2, per p2-ops-review.md O3
 * and review rounds 2/3/4).
 *
 * The "activation force-off" state must be **durable, shared, fail-safe, and
 * tamper-resistant against caller-supplied time / lost-update races**:
 *  - Persisted in a shared SQLite file; survives restart, observed by every
 *    instance.
 *  - A brand-new DB, a missing state row, a schema anomaly, or any read error is
 *    treated as **forced OFF** (`uninitialized_or_recovered`). A missing control
 *    plane never means "activation is available".
 *  - **Time is server-authoritative only.** Callers cannot pass a timestamp;
 *    cooldown is computed from the control plane's own injected clock, so a forged
 *    future time cannot shorten or bypass the cooldown.
 *  - **Reopen is a versioned atomic compare-and-set.** It reads the current
 *    `state_version`, then inside a `BEGIN IMMEDIATE` transaction updates only
 *    `WHERE state_version = observed` and requires `changes === 1`; a concurrent
 *    force-off/reopen that bumped the version makes the update a no-op and returns
 *    `state_changed_retry_required` (no lost update).
 *  - The full degrade state (reason, degrade time, RCA-pending, state version, and
 *    the last manual-reopen actor/time) is persisted, so restart keeps the
 *    manual-recovery gate intact. There is no public unconstrained clear.
 *
 * `InMemoryActivationControlPlane` mirrors the semantics for unit tests only.
 */

import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { requireNodeSqlite } from "../memory/sqlite.js";
import { CONFIG_DIR } from "../utils.js";

/** Cooldown owned by the control plane; a caller cannot shorten or forge it. */
export const DEFAULT_MIN_REOPEN_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/** Reason stamped on a fresh/recovered control plane; requires manual reopen. */
export const CONTROL_PLANE_UNINITIALIZED_REASON = "uninitialized_or_recovered";

export type ControlPlaneSnapshot = {
  forcedOff: boolean;
  reason?: string;
  degradedAtMs?: number;
  rcaPending: boolean;
  stateVersion: number;
  lastReopenActor?: string;
  lastReopenAtMs?: number;
};

/** Input to force activation off. NOTE: no timestamp — time is server-side only. */
export type ForceOffInput = {
  reason: string;
  /** Whether a Reminder over-upgrade RCA must be resolved before reopening. */
  rcaPending?: boolean;
};

/** Reopen request. NOTE: no timestamp — the control plane uses its own clock. */
export type ReopenAttempt = {
  confirmedByHuman: boolean;
  /** Set true only after a Reminder over-upgrade RCA is resolved. */
  rcaResolved?: boolean;
  /** Identity of the human operator; recorded durably. Required. */
  actorId: string;
};

export type ReopenOutcome = {
  reopened: boolean;
  reason:
    | "reopened"
    | "not_degraded"
    | "manual_confirm_required"
    | "actor_required"
    | "cooldown_active"
    | "reminder_rca_required"
    | "state_changed_retry_required"
    | "control_plane_unreadable";
};

export interface ActivationControlPlane {
  /** True when activation is force-disabled. Fails safe-off (true) on any error. */
  isForcedOff(): boolean;
  /** Force activation off, durably (server timestamps it). */
  forceOff(input: ForceOffInput): void;
  /** Mark the RCA-pending flag without resetting the cooldown. */
  setRcaPending(): void;
  /**
   * The only way out of forced-off: a versioned atomic CAS. Re-validates (against
   * persisted state, server time) human confirmation + cooldown + RCA, then clears
   * ONLY if `state_version` is unchanged since it was observed.
   */
  attemptReopen(req: ReopenAttempt): ReopenOutcome;
  /**
   * CAS primitive: reopen only if the persisted `state_version` still equals
   * `observedStateVersion`. `attemptReopen` calls this with the freshly-read
   * version; a stale version yields `state_changed_retry_required`.
   */
  reopenIfVersion(req: ReopenAttempt, observedStateVersion: number): ReopenOutcome;
  snapshot(): ControlPlaneSnapshot;
}

/**
 * Pure reopen decision over a snapshot (excludes the version CAS, which is done by
 * the caller transactionally). `nowMs` is always the control plane's server clock.
 */
export function evaluateReopen(
  snap: ControlPlaneSnapshot,
  req: ReopenAttempt,
  minReopenIntervalMs: number,
  nowMs: number,
): ReopenOutcome {
  if (!snap.forcedOff) {
    return { reopened: false, reason: "not_degraded" };
  }
  if (!req.confirmedByHuman) {
    return { reopened: false, reason: "manual_confirm_required" };
  }
  if (typeof req.actorId !== "string" || req.actorId.trim() === "") {
    return { reopened: false, reason: "actor_required" };
  }
  if (snap.degradedAtMs == null || nowMs - snap.degradedAtMs < minReopenIntervalMs) {
    return { reopened: false, reason: "cooldown_active" };
  }
  if (snap.rcaPending && !req.rcaResolved) {
    return { reopened: false, reason: "reminder_rca_required" };
  }
  return { reopened: true, reason: "reopened" };
}

const DEFAULT_CONTROL_PLANE_PATH = path.join(CONFIG_DIR, "conversation-task", "control-plane.db");

export type SqliteActivationControlPlaneOptions = {
  dbPath?: string;
  storeRoot?: string;
  /** Server-authoritative clock. Callers of forceOff/attemptReopen cannot override it. */
  now?: () => number;
  minReopenIntervalMs?: number;
};

type ControlRow = {
  forced_off: number | bigint;
  reason: string | null;
  degraded_at_ms: number | bigint | null;
  rca_pending: number | bigint;
  state_version: number | bigint;
  last_reopen_actor: string | null;
  last_reopen_at_ms: number | bigint | null;
};

function rowToSnapshot(row: ControlRow): ControlPlaneSnapshot {
  return {
    forcedOff: Number(row.forced_off) !== 0,
    ...(row.reason ? { reason: row.reason } : undefined),
    ...(row.degraded_at_ms != null ? { degradedAtMs: Number(row.degraded_at_ms) } : undefined),
    rcaPending: Number(row.rca_pending) !== 0,
    stateVersion: Number(row.state_version),
    ...(row.last_reopen_actor ? { lastReopenActor: row.last_reopen_actor } : undefined),
    ...(row.last_reopen_at_ms != null
      ? { lastReopenAtMs: Number(row.last_reopen_at_ms) }
      : undefined),
  };
}

function failSafeSnapshot(): ControlPlaneSnapshot {
  return {
    forcedOff: true,
    reason: CONTROL_PLANE_UNINITIALIZED_REASON,
    rcaPending: false,
    stateVersion: -1,
  };
}

export class SqliteActivationControlPlane implements ActivationControlPlane {
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  private readonly minReopenIntervalMs: number;
  readonly dbPath: string;

  constructor(options: SqliteActivationControlPlaneOptions = {}) {
    this.now = options.now ?? Date.now;
    this.minReopenIntervalMs = options.minReopenIntervalMs ?? DEFAULT_MIN_REOPEN_INTERVAL_MS;
    this.dbPath =
      options.dbPath ??
      (options.storeRoot
        ? path.join(options.storeRoot, "control-plane.db")
        : DEFAULT_CONTROL_PLANE_PATH);
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    const { DatabaseSync } = requireNodeSqlite();
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS activation_control (
        id                INTEGER PRIMARY KEY CHECK (id = 1),
        forced_off        INTEGER NOT NULL,
        reason            TEXT,
        degraded_at_ms    INTEGER,
        rca_pending       INTEGER NOT NULL DEFAULT 0,
        state_version     INTEGER NOT NULL DEFAULT 0,
        last_reopen_actor TEXT,
        last_reopen_at_ms INTEGER
      );
    `);
    this.ensureRow();
  }

  /** A fresh DB (or a DB whose row was deleted) is initialized to forced-off. */
  private ensureRow(): void {
    const exists = this.db.prepare("SELECT 1 FROM activation_control WHERE id = 1").get() as
      | { 1: number }
      | undefined;
    if (exists) {
      return;
    }
    this.db
      .prepare(
        `INSERT INTO activation_control
           (id, forced_off, reason, degraded_at_ms, rca_pending, state_version)
         VALUES (1, 1, ?, ?, 0, 1)`,
      )
      .run(CONTROL_PLANE_UNINITIALIZED_REASON, this.now());
  }

  private readRow(): ControlRow | undefined {
    return this.db
      .prepare(
        `SELECT forced_off, reason, degraded_at_ms, rca_pending, state_version,
                last_reopen_actor, last_reopen_at_ms
         FROM activation_control WHERE id = 1`,
      )
      .get() as ControlRow | undefined;
  }

  isForcedOff(): boolean {
    return this.snapshot().forcedOff;
  }

  snapshot(): ControlPlaneSnapshot {
    try {
      const row = this.readRow();
      return row ? rowToSnapshot(row) : failSafeSnapshot();
    } catch {
      return failSafeSnapshot();
    }
  }

  forceOff(input: ForceOffInput): void {
    const nowMs = this.now(); // server time only
    const rca = input.rcaPending ? 1 : 0;
    this.db
      .prepare(
        `UPDATE activation_control
         SET forced_off = 1,
             reason = ?,
             degraded_at_ms = ?,
             rca_pending = MAX(rca_pending, ?),
             state_version = state_version + 1
         WHERE id = 1`,
      )
      .run(input.reason, nowMs, rca);
  }

  setRcaPending(): void {
    this.db
      .prepare(
        `UPDATE activation_control
         SET rca_pending = 1, state_version = state_version + 1
         WHERE id = 1 AND rca_pending = 0`,
      )
      .run();
  }

  attemptReopen(req: ReopenAttempt): ReopenOutcome {
    const snap = this.snapshot();
    return this.reopenIfVersion(req, snap.stateVersion);
  }

  reopenIfVersion(req: ReopenAttempt, observedStateVersion: number): ReopenOutcome {
    const nowMs = this.now(); // server time only — no caller-supplied timestamp
    let snap: ControlPlaneSnapshot;
    try {
      const row = this.readRow();
      if (!row) {
        return { reopened: false, reason: "control_plane_unreadable" };
      }
      snap = rowToSnapshot(row);
    } catch {
      return { reopened: false, reason: "control_plane_unreadable" };
    }
    const outcome = evaluateReopen(snap, req, this.minReopenIntervalMs, nowMs);
    if (!outcome.reopened) {
      return outcome;
    }
    // Versioned atomic CAS: only clear if the state has not changed since observed.
    try {
      this.db.exec("BEGIN IMMEDIATE");
      const result = this.db
        .prepare(
          `UPDATE activation_control
           SET forced_off = 0,
               reason = NULL,
               degraded_at_ms = NULL,
               rca_pending = 0,
               last_reopen_actor = ?,
               last_reopen_at_ms = ?,
               state_version = state_version + 1
           WHERE id = 1 AND state_version = ?`,
        )
        .run(req.actorId, nowMs, observedStateVersion);
      if (Number(result.changes) !== 1) {
        this.db.exec("ROLLBACK");
        return { reopened: false, reason: "state_changed_retry_required" };
      }
      this.db.exec("COMMIT");
    } catch {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // ignore
      }
      return { reopened: false, reason: "control_plane_unreadable" };
    }
    return { reopened: true, reason: "reopened" };
  }

  close(): void {
    this.db.close();
  }
}

/**
 * NON-DURABLE in-memory control plane. FOR UNIT TESTS ONLY. Mirrors the Sqlite
 * semantics: fresh = forced off; server-only time; versioned CAS reopen.
 */
export class InMemoryActivationControlPlane implements ActivationControlPlane {
  private snap: ControlPlaneSnapshot;
  private readonly now: () => number;
  private readonly minReopenIntervalMs: number;

  constructor(options: { now?: () => number; minReopenIntervalMs?: number } = {}) {
    this.now = options.now ?? Date.now;
    this.minReopenIntervalMs = options.minReopenIntervalMs ?? DEFAULT_MIN_REOPEN_INTERVAL_MS;
    this.snap = {
      forcedOff: true,
      reason: CONTROL_PLANE_UNINITIALIZED_REASON,
      degradedAtMs: this.now(),
      rcaPending: false,
      stateVersion: 1,
    };
  }

  isForcedOff(): boolean {
    return this.snap.forcedOff;
  }

  snapshot(): ControlPlaneSnapshot {
    return { ...this.snap };
  }

  forceOff(input: ForceOffInput): void {
    this.snap = {
      forcedOff: true,
      reason: input.reason,
      degradedAtMs: this.now(),
      rcaPending: this.snap.rcaPending || Boolean(input.rcaPending),
      stateVersion: this.snap.stateVersion + 1,
      ...(this.snap.lastReopenActor ? { lastReopenActor: this.snap.lastReopenActor } : undefined),
      ...(this.snap.lastReopenAtMs != null
        ? { lastReopenAtMs: this.snap.lastReopenAtMs }
        : undefined),
    };
  }

  setRcaPending(): void {
    if (!this.snap.rcaPending) {
      this.snap = { ...this.snap, rcaPending: true, stateVersion: this.snap.stateVersion + 1 };
    }
  }

  attemptReopen(req: ReopenAttempt): ReopenOutcome {
    return this.reopenIfVersion(req, this.snap.stateVersion);
  }

  reopenIfVersion(req: ReopenAttempt, observedStateVersion: number): ReopenOutcome {
    const nowMs = this.now();
    const outcome = evaluateReopen(this.snap, req, this.minReopenIntervalMs, nowMs);
    if (!outcome.reopened) {
      return outcome;
    }
    if (this.snap.stateVersion !== observedStateVersion) {
      return { reopened: false, reason: "state_changed_retry_required" };
    }
    this.snap = {
      forcedOff: false,
      rcaPending: false,
      stateVersion: this.snap.stateVersion + 1,
      lastReopenActor: req.actorId,
      lastReopenAtMs: nowMs,
    };
    return { reopened: true, reason: "reopened" };
  }
}
