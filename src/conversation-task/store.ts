/**
 * ConversationTask Runtime — tenant-scoped authoritative store (P2).
 *
 * Implements the frozen A1/A2/A4 storage contract
 * (`.kiro/specs/conversation-task-runtime/p2-design-freeze.md`):
 *  - Backend: `node:sqlite` (`DatabaseSync`) via `requireNodeSqlite()`; one DB
 *    file per tenant (Scheme A). No personal fallback; a missing/untrusted
 *    tenantId fails closed.
 *  - File key: FULL SHA-256 of canonical tenant bytes (no truncation). Every open
 *    verifies `meta.tenant_id`; a mismatch, or missing meta with non-empty
 *    business tables (file replacement / tamper), fails closed with a
 *    `TenantIsolationViolationError` carrying only the hashed file key.
 *  - Internal `INTEGER PRIMARY KEY` = non-collidable row identity; `candidate_id`
 *    / `task_key` are plain NON-UNIQUE indexes; composite-column UNIQUE is the
 *    business uniqueness truth; foreign keys reference the internal row id.
 *  - create-if-absent = `BEGIN IMMEDIATE` + `INSERT ... ON CONFLICT(<composite>)
 *    DO NOTHING`. A hash hit is always re-checked against the full tuple, and
 *    hash-equal / tuple-different rows coexist.
 *
 * P2 scope only: this persists Candidate and ConversationTask identity + goal +
 * lifecycle. It reserves the `task_revisions` schema but never writes it, never
 * mutates an active task's goal, and performs no active-task resolution. It never
 * touches the Progress Ledger and produces no real side effects.
 */

import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { requireNodeSqlite } from "../memory/sqlite.js";
import { CONFIG_DIR } from "../utils.js";
import {
  canonicalTenantId,
  deriveCandidateId,
  deriveTaskKey,
  fileKeyForTenant,
  normalizeGoal,
} from "./canonical.js";
import {
  ConversationTaskStoreError,
  TenantIsolationViolationError,
  type TenantIsolationViolationReason,
} from "./errors.js";
import type {
  ConversationTaskLifecycle,
  DetectionResult,
  QualificationResult,
  TaskCandidateStatus,
} from "./types.js";

const SCHEMA_VERSION = "ct-store-2026-08-24";

const DEFAULT_STORE_ROOT = path.join(CONFIG_DIR, "conversation-task");

/** Observability record for a rejected open (privacy-safe: hashed key only). */
export type IsolationViolationRecord = {
  reason: TenantIsolationViolationReason;
  fileKey: string;
  atMs: number;
};

export type OpenTaskStoreParams = {
  /** Trusted tenant id from an authenticated context. Missing => fail-closed. */
  tenantId: string;
  /** Storage root; defaults to `<config>/conversation-task`. Never user-derived. */
  storeRoot?: string;
  /** Called (privacy-safe) whenever an open is rejected as an isolation violation. */
  onIsolationViolation?: (record: IsolationViolationRecord) => void;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
};

export type StoredCandidate = {
  id: number;
  candidateId: string;
  tenantId: string;
  conversationId: string;
  sourceMessageId: string;
  decisionVersion: string;
  status: TaskCandidateStatus;
  payload: string;
  createdAtMs: number;
  expiresAtMs: number;
};

export type StoredConversationTask = {
  id: number;
  taskKey: string;
  tenantId: string;
  conversationId: string;
  normalizedGoal: string;
  goal: string;
  /** Inbound message id from activation; anchors inline UI progress. */
  sourceMessageId: string;
  activationEpoch: number;
  lifecycle: ConversationTaskLifecycle;
  requesterId: string;
  ownerId: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type CreateCandidateInput = {
  conversationId: string;
  sourceMessageId: string;
  decisionVersion: string;
  detection: DetectionResult;
  qualification: QualificationResult;
  status?: TaskCandidateStatus;
  /** TTL from creation; the row expires at `now + ttlMs`. */
  ttlMs: number;
};

export type CreateTaskInput = {
  conversationId: string;
  goal: string;
  sourceMessageId?: string;
  activationEpoch: number;
  requesterId: string;
  ownerId?: string;
  /** Initial lifecycle. Activation creates `active`; `draft` is also allowed. */
  lifecycle?: Extract<ConversationTaskLifecycle, "draft" | "active">;
};

/** Legal lifecycle transitions (no reopening a terminal state — resolution is P3). */
const LIFECYCLE_TRANSITIONS: Readonly<
  Record<ConversationTaskLifecycle, readonly ConversationTaskLifecycle[]>
> = {
  draft: ["active", "cancelled"],
  active: ["closed", "cancelled"],
  closed: [],
  cancelled: [],
};

type CandidateRow = {
  id: number | bigint;
  candidate_id: string;
  tenant_id: string;
  conversation_id: string;
  source_message_id: string;
  decision_version: string;
  status: string;
  payload: string;
  created_at_ms: number | bigint;
  expires_at_ms: number | bigint;
};

type TaskRow = {
  id: number | bigint;
  task_key: string;
  tenant_id: string;
  conversation_id: string;
  normalized_goal: string;
  goal: string;
  source_message_id?: string;
  activation_epoch: number | bigint;
  lifecycle: string;
  requester_id: string;
  owner_id: string | null;
  created_at_ms: number | bigint;
  updated_at_ms: number | bigint;
};

function toCandidate(row: CandidateRow): StoredCandidate {
  return {
    id: Number(row.id),
    candidateId: row.candidate_id,
    tenantId: row.tenant_id,
    conversationId: row.conversation_id,
    sourceMessageId: row.source_message_id,
    decisionVersion: row.decision_version,
    status: row.status as TaskCandidateStatus,
    payload: row.payload,
    createdAtMs: Number(row.created_at_ms),
    expiresAtMs: Number(row.expires_at_ms),
  };
}

function toTask(row: TaskRow): StoredConversationTask {
  return {
    id: Number(row.id),
    taskKey: row.task_key,
    tenantId: row.tenant_id,
    conversationId: row.conversation_id,
    normalizedGoal: row.normalized_goal,
    goal: row.goal,
    sourceMessageId: row.source_message_id ?? "",
    activationEpoch: Number(row.activation_epoch),
    lifecycle: row.lifecycle as ConversationTaskLifecycle,
    requesterId: row.requester_id,
    ownerId: row.owner_id,
    createdAtMs: Number(row.created_at_ms),
    updatedAtMs: Number(row.updated_at_ms),
  };
}

function migrateConversationTaskSchema(db: DatabaseSync): void {
  const columns = db.prepare("PRAGMA table_info(conversation_tasks)").all() as Array<{
    name: string;
  }>;
  if (!columns.some((column) => column.name === "source_message_id")) {
    db.exec(`ALTER TABLE conversation_tasks ADD COLUMN source_message_id TEXT NOT NULL DEFAULT ''`);
  }
}

function createMetaTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

function createTaskSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS candidates (
      id                INTEGER PRIMARY KEY,
      candidate_id      TEXT NOT NULL,
      tenant_id         TEXT NOT NULL,
      conversation_id   TEXT NOT NULL,
      source_message_id TEXT NOT NULL,
      decision_version  TEXT NOT NULL,
      status            TEXT NOT NULL,
      payload           TEXT NOT NULL,
      created_at_ms     INTEGER NOT NULL,
      expires_at_ms     INTEGER NOT NULL,
      UNIQUE (tenant_id, conversation_id, source_message_id, decision_version)
    );
    CREATE INDEX IF NOT EXISTS idx_candidates_cid ON candidates(candidate_id);
    CREATE TABLE IF NOT EXISTS conversation_tasks (
      id               INTEGER PRIMARY KEY,
      task_key         TEXT NOT NULL,
      tenant_id        TEXT NOT NULL,
      conversation_id  TEXT NOT NULL,
      normalized_goal  TEXT NOT NULL,
      goal             TEXT NOT NULL,
      activation_epoch INTEGER NOT NULL,
      lifecycle        TEXT NOT NULL,
      requester_id     TEXT NOT NULL,
      owner_id         TEXT,
      created_at_ms    INTEGER NOT NULL,
      updated_at_ms    INTEGER NOT NULL,
      UNIQUE (tenant_id, conversation_id, normalized_goal, activation_epoch)
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_key ON conversation_tasks(task_key);
    CREATE INDEX IF NOT EXISTS idx_tasks_conversation_lifecycle
      ON conversation_tasks(tenant_id, conversation_id, lifecycle);
    CREATE TABLE IF NOT EXISTS task_revisions (
      id            INTEGER PRIMARY KEY,
      task_row_id   INTEGER NOT NULL REFERENCES conversation_tasks(id) ON DELETE CASCADE,
      revision      INTEGER NOT NULL,
      field         TEXT NOT NULL,
      previous_json TEXT,
      next_json     TEXT,
      reason        TEXT NOT NULL,
      actor_id      TEXT NOT NULL,
      at_ms         INTEGER NOT NULL,
      UNIQUE (task_row_id, revision)
    );
  `);
  migrateConversationTaskSchema(db);
}

function firstValue(row: unknown): unknown {
  if (row && typeof row === "object") {
    const values = Object.values(row as Record<string, unknown>);
    return values.length > 0 ? values[0] : undefined;
  }
  return undefined;
}

/** Read `PRAGMA <name>` first-column value. */
function readPragma(db: DatabaseSync, name: string): unknown {
  return firstValue(db.prepare(`PRAGMA ${name}`).get());
}

function businessTablesHaveRows(db: DatabaseSync, tables: readonly string[]): boolean {
  for (const table of tables) {
    const row = db.prepare(`SELECT 1 AS present FROM ${table} LIMIT 1`).get() as
      | { present: number }
      | undefined;
    if (row) {
      return true;
    }
  }
  return false;
}

/** A tenant-scoped SQLite DB opened under the shared isolation protocol. */
export type TenantScopedDb = {
  db: DatabaseSync;
  /** Canonical tenant id (verified against meta.tenant_id on open). */
  tenantId: string;
  fileKey: string;
  now: () => number;
};

export type OpenTenantScopedDbParams = {
  tenantId: string;
  storeRoot?: string;
  /** File suffix under `<root>/tenant/<fileKey>` (e.g. `.db`, `.shadow.db`). */
  fileSuffix: string;
  /** Create the caller's business tables (meta is created by the helper). */
  createBusinessSchema: (db: DatabaseSync) => void;
  /** Tables checked for the "meta missing but data present" tamper case. */
  businessTables: readonly string[];
  onIsolationViolation?: (record: IsolationViolationRecord) => void;
  now?: () => number;
};

/**
 * Open (or create) a tenant-scoped SQLite DB with the shared isolation protocol:
 * full-SHA-256 file key, WAL/foreign_keys/busy_timeout PRAGMAs + self-check, and a
 * `meta.tenant_id` check that fails closed on mismatch or on missing meta with
 * existing business rows (file replacement / tamper). Reused by the authoritative
 * task store and the shadow-log store so both share identical tenant isolation.
 */
export function openTenantScopedDb(params: OpenTenantScopedDbParams): TenantScopedDb {
  const now = params.now ?? Date.now;
  const rawTenant = params.tenantId;
  if (typeof rawTenant !== "string" || rawTenant.trim() === "") {
    throw new ConversationTaskStoreError("missing_tenant", "a trusted tenantId is required");
  }
  const canonical = canonicalTenantId(rawTenant);
  const fileKey = fileKeyForTenant(rawTenant);
  const root = params.storeRoot ?? DEFAULT_STORE_ROOT;
  const dbPath = path.join(root, "tenant", `${fileKey}${params.fileSuffix}`);

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const { DatabaseSync } = requireNodeSqlite();
  const db = new DatabaseSync(dbPath);

  const closeQuietly = (): void => {
    try {
      db.close();
    } catch {
      // ignore close failure after a primary error
    }
  };
  const reject = (reason: TenantIsolationViolationReason): never => {
    params.onIsolationViolation?.({ reason, fileKey, atMs: now() });
    closeQuietly();
    throw new TenantIsolationViolationError(reason, fileKey);
  };

  // PRAGMAs (before any transaction; foreign_keys is per-connection).
  // busy_timeout MUST be set first so the WAL-mode switch and later locks wait
  // for a concurrent opener instead of failing immediately with "database is locked".
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");

  createMetaTable(db);
  params.createBusinessSchema(db);

  // Open protocol: verify tenant identity metadata.
  const metaRow = db.prepare("SELECT value FROM meta WHERE key = 'tenant_id'").get() as
    | { value: string }
    | undefined;
  if (metaRow) {
    if (metaRow.value !== canonical) {
      reject("meta_mismatch");
    }
  } else if (businessTablesHaveRows(db, params.businessTables)) {
    reject("meta_missing_with_data");
  } else {
    db.exec("BEGIN IMMEDIATE");
    try {
      const put = db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)");
      put.run("tenant_id", canonical);
      put.run("schema_version", SCHEMA_VERSION);
      db.exec("COMMIT");
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // ignore
      }
      closeQuietly();
      throw err;
    }
  }

  // PRAGMA self-check (B9): WAL + foreign_keys ON + a positive busy_timeout.
  const journalMode = String(readPragma(db, "journal_mode")).toLowerCase();
  const foreignKeys = Number(readPragma(db, "foreign_keys"));
  const busyTimeout = Number(readPragma(db, "busy_timeout"));
  if (journalMode !== "wal" || foreignKeys !== 1 || !(busyTimeout > 0)) {
    params.onIsolationViolation?.({ reason: "pragma_failed", fileKey, atMs: now() });
    closeQuietly();
    throw new ConversationTaskStoreError(
      "pragma_failed",
      `pragma self-check failed (journal_mode=${journalMode}, foreign_keys=${foreignKeys}, busy_timeout=${busyTimeout})`,
    );
  }

  return { db, tenantId: canonical, fileKey, now };
}

const TASK_BUSINESS_TABLES = ["candidates", "conversation_tasks", "task_revisions"] as const;

/**
 * Open (or create) the authoritative tenant-scoped task store. Fails closed on a
 * missing/untrusted tenantId, a `meta.tenant_id` mismatch, missing meta with
 * existing business rows, or a PRAGMA self-check failure.
 */
export function openTaskStore(params: OpenTaskStoreParams): TaskStore {
  const scoped = openTenantScopedDb({
    tenantId: params.tenantId,
    storeRoot: params.storeRoot,
    fileSuffix: ".db",
    createBusinessSchema: createTaskSchema,
    businessTables: TASK_BUSINESS_TABLES,
    onIsolationViolation: params.onIsolationViolation,
    now: params.now,
  });
  return new TaskStore(scoped.db, scoped.tenantId, scoped.fileKey, scoped.now);
}

/**
 * Handle to one tenant's authoritative store. All rows are already scoped to this
 * tenant (verified on open); every write also stamps `tenant_id` so cross-tenant
 * rows can never appear even if a query is mis-built.
 */
export class TaskStore {
  private readonly db: DatabaseSync;
  /** Canonical tenant id this store is bound to (verified against meta on open). */
  readonly tenantId: string;
  readonly fileKey: string;
  private readonly now: () => number;

  constructor(db: DatabaseSync, tenantId: string, fileKey: string, now: () => number) {
    this.db = db;
    this.tenantId = tenantId;
    this.fileKey = fileKey;
    this.now = now;
  }

  /**
   * create-if-absent for a Candidate. Atomic via `BEGIN IMMEDIATE` + composite
   * `ON CONFLICT DO NOTHING`. Returns the winning or pre-existing row plus whether
   * this call created it (idempotent for redelivered messages, CT8).
   */
  createCandidateIfAbsent(input: CreateCandidateInput): {
    created: boolean;
    candidate: StoredCandidate;
  } {
    const nowMs = this.now();
    const candidateId = deriveCandidateId({
      tenantId: this.tenantId,
      conversationId: input.conversationId,
      sourceMessageId: input.sourceMessageId,
      decisionVersion: input.decisionVersion,
    });
    const payload = JSON.stringify({
      detected: input.detection.detected,
      confidence: input.detection.confidence,
      qualification: input.qualification.kind,
    });
    const status: TaskCandidateStatus = input.status ?? "observing";

    this.db.exec("BEGIN IMMEDIATE");
    let created: boolean;
    try {
      const result = this.db
        .prepare(
          `INSERT INTO candidates
             (candidate_id, tenant_id, conversation_id, source_message_id, decision_version,
              status, payload, created_at_ms, expires_at_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (tenant_id, conversation_id, source_message_id, decision_version) DO NOTHING`,
        )
        .run(
          candidateId,
          this.tenantId,
          input.conversationId,
          input.sourceMessageId,
          input.decisionVersion,
          status,
          payload,
          nowMs,
          nowMs + input.ttlMs,
        );
      created = Number(result.changes) === 1;
      this.db.exec("COMMIT");
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // ignore
      }
      throw err;
    }

    const candidate = this.getCandidate({
      conversationId: input.conversationId,
      sourceMessageId: input.sourceMessageId,
      decisionVersion: input.decisionVersion,
    });
    if (!candidate) {
      throw new ConversationTaskStoreError("candidate_lost", "candidate missing after upsert");
    }
    return { created, candidate };
  }

  /** Read a Candidate by its full composite tuple (the uniqueness truth). */
  getCandidate(tuple: {
    conversationId: string;
    sourceMessageId: string;
    decisionVersion: string;
  }): StoredCandidate | null {
    const row = this.db
      .prepare(
        `SELECT * FROM candidates
         WHERE tenant_id = ? AND conversation_id = ? AND source_message_id = ? AND decision_version = ?`,
      )
      .get(this.tenantId, tuple.conversationId, tuple.sourceMessageId, tuple.decisionVersion) as
      | CandidateRow
      | undefined;
    return row ? toCandidate(row) : null;
  }

  /**
   * All rows sharing a derived `candidate_id` (the plain, non-unique index).
   * Used to demonstrate Scheme A coexistence: hash-equal / tuple-different rows
   * both persist and are distinguishable by their composite tuple.
   */
  findCandidatesByCandidateId(candidateId: string): StoredCandidate[] {
    const rows = this.db
      .prepare(`SELECT * FROM candidates WHERE tenant_id = ? AND candidate_id = ? ORDER BY id ASC`)
      .all(this.tenantId, candidateId) as CandidateRow[];
    return rows.map(toCandidate);
  }

  /** Delete Candidates whose TTL has elapsed. Returns the number removed. */
  expireCandidates(atMs = this.now()): number {
    const result = this.db
      .prepare(`DELETE FROM candidates WHERE tenant_id = ? AND expires_at_ms <= ?`)
      .run(this.tenantId, atMs);
    return Number(result.changes);
  }

  /**
   * create-if-absent for a ConversationTask (Activation). Atomic via
   * `BEGIN IMMEDIATE` + composite `ON CONFLICT DO NOTHING`, so concurrent
   * activations of the same (tenant, conversation, normalizedGoal, epoch) yield
   * exactly one active task (S6). Returns the winner/pre-existing row.
   */
  createTaskIfAbsent(input: CreateTaskInput): { created: boolean; task: StoredConversationTask } {
    const nowMs = this.now();
    const normalizedGoal = normalizeGoal(input.goal);
    const taskKey = deriveTaskKey({
      tenantId: this.tenantId,
      conversationId: input.conversationId,
      normalizedGoal,
      activationEpoch: input.activationEpoch,
    });
    const lifecycle: ConversationTaskLifecycle = input.lifecycle ?? "active";
    const sourceMessageId =
      typeof input.sourceMessageId === "string" ? input.sourceMessageId.trim() : "";

    this.db.exec("BEGIN IMMEDIATE");
    let created: boolean;
    try {
      const result = this.db
        .prepare(
          `INSERT INTO conversation_tasks
             (task_key, tenant_id, conversation_id, normalized_goal, goal, source_message_id,
              activation_epoch, lifecycle, requester_id, owner_id, created_at_ms, updated_at_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (tenant_id, conversation_id, normalized_goal, activation_epoch) DO NOTHING`,
        )
        .run(
          taskKey,
          this.tenantId,
          input.conversationId,
          normalizedGoal,
          input.goal,
          sourceMessageId,
          input.activationEpoch,
          lifecycle,
          input.requesterId,
          input.ownerId ?? null,
          nowMs,
          nowMs,
        );
      created = Number(result.changes) === 1;
      this.db.exec("COMMIT");
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // ignore
      }
      throw err;
    }

    const task = this.getTask({
      conversationId: input.conversationId,
      normalizedGoal,
      activationEpoch: input.activationEpoch,
    });
    if (!task) {
      throw new ConversationTaskStoreError("task_lost", "task missing after upsert");
    }
    return { created, task };
  }

  /** Read a ConversationTask by its full composite tuple. */
  getTask(tuple: {
    conversationId: string;
    normalizedGoal: string;
    activationEpoch: number;
  }): StoredConversationTask | null {
    const row = this.db
      .prepare(
        `SELECT * FROM conversation_tasks
         WHERE tenant_id = ? AND conversation_id = ? AND normalized_goal = ? AND activation_epoch = ?`,
      )
      .get(this.tenantId, tuple.conversationId, tuple.normalizedGoal, tuple.activationEpoch) as
      | TaskRow
      | undefined;
    return row ? toTask(row) : null;
  }

  /** Active ConversationTasks bound to one conversation, newest first. */
  findActiveTasksByConversation(conversationId: string): StoredConversationTask[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM conversation_tasks
         WHERE tenant_id = ? AND conversation_id = ? AND lifecycle = 'active'
         ORDER BY updated_at_ms DESC, id DESC`,
      )
      .all(this.tenantId, conversationId) as TaskRow[];
    return rows.map(toTask);
  }

  /** All rows sharing a derived `task_key` (plain, non-unique index). */
  findTasksByTaskKey(taskKey: string): StoredConversationTask[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM conversation_tasks WHERE tenant_id = ? AND task_key = ? ORDER BY id ASC`,
      )
      .all(this.tenantId, taskKey) as TaskRow[];
    return rows.map(toTask);
  }

  getTaskById(id: number): StoredConversationTask | null {
    const row = this.db
      .prepare(`SELECT * FROM conversation_tasks WHERE tenant_id = ? AND id = ?`)
      .get(this.tenantId, id) as TaskRow | undefined;
    return row ? toTask(row) : null;
  }

  /**
   * Transition a task's lifecycle. Only draft->active|cancelled and
   * active->closed|cancelled are legal; terminal states never reopen (reopening
   * is active-task resolution, which is P3). Never mutates goal/acceptance/delivery.
   */
  transitionTask(id: number, next: ConversationTaskLifecycle): StoredConversationTask {
    const current = this.getTaskById(id);
    if (!current) {
      throw new ConversationTaskStoreError("task_not_found", `no task with id ${id}`);
    }
    const allowed = LIFECYCLE_TRANSITIONS[current.lifecycle];
    if (!allowed.includes(next)) {
      throw new ConversationTaskStoreError(
        "illegal_transition",
        `cannot transition ${current.lifecycle} -> ${next}`,
      );
    }
    this.db
      .prepare(
        `UPDATE conversation_tasks SET lifecycle = ?, updated_at_ms = ? WHERE tenant_id = ? AND id = ?`,
      )
      .run(next, this.now(), this.tenantId, id);
    return this.getTaskById(id)!;
  }

  /** Count tasks in a given lifecycle (e.g. active tasks frozen while off, O2). */
  countTasksByLifecycle(lifecycle: ConversationTaskLifecycle): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM conversation_tasks WHERE tenant_id = ? AND lifecycle = ?`)
      .get(this.tenantId, lifecycle) as { n: number | bigint };
    return Number(row.n);
  }

  /** Count reserved revision rows — must remain 0 in P2 (P2/P3 boundary). */
  countRevisions(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM task_revisions`).get() as {
      n: number | bigint;
    };
    return Number(row.n);
  }

  close(): void {
    this.db.close();
  }
}
