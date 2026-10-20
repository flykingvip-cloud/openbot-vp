/**
 * ConversationTask Runtime — P2.5 persistent config source (admission §5 AC5, C3/C4).
 *
 * A single shared SQLite store for (a) the tenant **allowlist** and (b) the
 * `detection`/`qualification` **feature flags**, so both are read from the same
 * durable, multi-instance-consistent source instead of process env:
 *  - **Durable + shared**: a SQLite file every gateway instance opens; a write on
 *    one instance is observed by others within the read cache TTL (<= 3s).
 *  - **Fail-closed**: unknown tenant / absent flag / any read error => OFF/empty.
 *    A missing config never means "allowed" or "on".
 *  - **Versioned CAS** updates (`BEGIN IMMEDIATE` + `state_version` guard), mirroring
 *    the activation control plane, so concurrent admin writes cannot lost-update.
 *  - **No plaintext tenantId**: the allowlist is keyed by `fileKeyForTenant` (full
 *    SHA-256 of the canonical tenant), never the raw tenant value.
 *  - **Shadow-only guarantee**: `activation`/`projection`/`authorization` can never
 *    read as enabled here and cannot be turned on — enabling one is refused.
 *  - **No client write path**: writes are the `setTenantAllow`/`setFlag` admin APIs
 *    (server-side, operator-attributed); the gateway hook only ever *reads*.
 *
 * It touches no Progress Ledger and performs no side effects.
 */

import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { requireNodeSqlite } from "../memory/sqlite.js";
import { CONFIG_DIR } from "../utils.js";
import { fileKeyForTenant } from "./canonical.js";
import { ConversationTaskStoreError } from "./errors.js";
import { SHADOW_FORBIDDEN_FLAGS, type ConversationTaskFlag } from "./feature.js";
import type { FlagReader } from "./flag-cache.js";

const TENANT_KEY_PREFIX_LEN = 12;

export const ALLOWLIST_CACHE_DEFAULT_TTL_MS = 3_000;
export const ALLOWLIST_CACHE_MAX_TTL_MS = 5_000;

const DEFAULT_CONFIG_STORE_PATH = path.join(CONFIG_DIR, "conversation-task", "config-store.db");

export type ConfigCasResult =
  | { ok: true; stateVersion: number }
  | { ok: false; reason: "state_changed_retry_required" };

export type SetTenantAllowInput = {
  tenantId: string;
  enabled: boolean;
  actor: string;
  reason: string;
  /** Optional versioned CAS: only apply if the row's `state_version` equals this. */
  expectedVersion?: number;
};

export type ConversationTaskConfigStoreOptions = {
  dbPath?: string;
  storeRoot?: string;
  now?: () => number;
};

function isForbiddenFlag(flag: ConversationTaskFlag): boolean {
  return SHADOW_FORBIDDEN_FLAGS.includes(flag);
}

/**
 * Durable, shared config store for the P2.5 allowlist + flags. Every method is
 * fail-closed; forbidden flags can never be enabled or read as on.
 */
export class ConversationTaskConfigStore {
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  readonly dbPath: string;

  constructor(options: ConversationTaskConfigStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.dbPath =
      options.dbPath ??
      (options.storeRoot
        ? path.join(options.storeRoot, "config-store.db")
        : DEFAULT_CONFIG_STORE_PATH);
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    const { DatabaseSync } = requireNodeSqlite();
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tenant_allowlist (
        tenant_key    TEXT PRIMARY KEY,
        enabled       INTEGER NOT NULL,
        actor         TEXT NOT NULL,
        reason        TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        state_version INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS feature_flags (
        flag          TEXT PRIMARY KEY,
        enabled       INTEGER NOT NULL,
        actor         TEXT NOT NULL,
        reason        TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        state_version INTEGER NOT NULL
      );
    `);
  }

  /**
   * True when at least one tenant is explicitly enabled. Empty allowlist (or a
   * missing table) is `false` so an env-gated host can admit authenticated
   * tenants. A read error is `true` (fail-closed: treat as restricted).
   */
  hasAnyEnabledTenant(): boolean {
    try {
      const row = this.db
        .prepare("SELECT 1 AS n FROM tenant_allowlist WHERE enabled = 1 LIMIT 1")
        .get() as { n: number | bigint } | undefined;
      return Boolean(row);
    } catch {
      return true;
    }
  }

  /** True only when the tenant is explicitly enabled. Default/absent/read-error => false. */
  isTenantAllowed(tenantId: string): boolean {
    try {
      if (typeof tenantId !== "string" || tenantId.trim() === "") {
        return false;
      }
      const key = fileKeyForTenant(tenantId);
      const row = this.db
        .prepare("SELECT enabled FROM tenant_allowlist WHERE tenant_key = ?")
        .get(key) as { enabled: number | bigint } | undefined;
      return row ? Number(row.enabled) === 1 : false;
    } catch {
      return false; // fail-closed
    }
  }

  /** Versioned-CAS upsert of a tenant allowlist entry (server-timestamped, attributed). */
  setTenantAllow(input: SetTenantAllowInput): ConfigCasResult {
    if (typeof input.tenantId !== "string" || input.tenantId.trim() === "") {
      throw new ConversationTaskStoreError(
        "tenant_required",
        "a trusted tenantId is required to set the allowlist",
      );
    }
    if (typeof input.actor !== "string" || input.actor.trim() === "") {
      throw new ConversationTaskStoreError(
        "actor_required",
        "an operator actor is required to modify the allowlist",
      );
    }
    const key = fileKeyForTenant(input.tenantId);
    const nowMs = this.now();
    try {
      this.db.exec("BEGIN IMMEDIATE");
      const current = this.db
        .prepare("SELECT state_version FROM tenant_allowlist WHERE tenant_key = ?")
        .get(key) as { state_version: number | bigint } | undefined;
      const currentVersion = current ? Number(current.state_version) : 0;
      if (input.expectedVersion != null && input.expectedVersion !== currentVersion) {
        this.db.exec("ROLLBACK");
        return { ok: false, reason: "state_changed_retry_required" };
      }
      const nextVersion = currentVersion + 1;
      this.db
        .prepare(
          `INSERT INTO tenant_allowlist
             (tenant_key, enabled, actor, reason, updated_at_ms, state_version)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(tenant_key) DO UPDATE SET
             enabled = excluded.enabled, actor = excluded.actor, reason = excluded.reason,
             updated_at_ms = excluded.updated_at_ms, state_version = excluded.state_version`,
        )
        .run(key, input.enabled ? 1 : 0, input.actor, input.reason, nowMs, nextVersion);
      this.db.exec("COMMIT");
      return { ok: true, stateVersion: nextVersion };
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // ignore
      }
      throw err;
    }
  }

  /**
   * Flag value from the config source. `activation`/`projection`/`authorization`
   * always read `false` here (shadow-only guarantee), regardless of any stored row.
   * Fail-closed on any read error.
   */
  isFlagEnabled(flag: ConversationTaskFlag): boolean {
    if (isForbiddenFlag(flag)) {
      return false;
    }
    try {
      const row = this.db.prepare("SELECT enabled FROM feature_flags WHERE flag = ?").get(flag) as
        | { enabled: number | bigint }
        | undefined;
      return row ? Number(row.enabled) === 1 : false;
    } catch {
      return false; // fail-closed
    }
  }

  /** Versioned-CAS set of a flag. Refuses to enable a forbidden flag (shadow-only). */
  setFlag(
    flag: ConversationTaskFlag,
    enabled: boolean,
    actor: string,
    reason: string,
    expectedVersion?: number,
  ): ConfigCasResult {
    if (enabled && isForbiddenFlag(flag)) {
      throw new ConversationTaskStoreError(
        "forbidden_flag",
        `${flag} must stay OFF in P2.5 shadow-only; refusing to enable`,
      );
    }
    if (typeof actor !== "string" || actor.trim() === "") {
      throw new ConversationTaskStoreError(
        "actor_required",
        "an operator actor is required to modify a flag",
      );
    }
    const nowMs = this.now();
    try {
      this.db.exec("BEGIN IMMEDIATE");
      const current = this.db
        .prepare("SELECT state_version FROM feature_flags WHERE flag = ?")
        .get(flag) as { state_version: number | bigint } | undefined;
      const currentVersion = current ? Number(current.state_version) : 0;
      if (expectedVersion != null && expectedVersion !== currentVersion) {
        this.db.exec("ROLLBACK");
        return { ok: false, reason: "state_changed_retry_required" };
      }
      const nextVersion = currentVersion + 1;
      this.db
        .prepare(
          `INSERT INTO feature_flags
             (flag, enabled, actor, reason, updated_at_ms, state_version)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(flag) DO UPDATE SET
             enabled = excluded.enabled, actor = excluded.actor, reason = excluded.reason,
             updated_at_ms = excluded.updated_at_ms, state_version = excluded.state_version`,
        )
        .run(flag, enabled ? 1 : 0, actor, reason, nowMs, nextVersion);
      this.db.exec("COMMIT");
      return { ok: true, stateVersion: nextVersion };
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // ignore
      }
      throw err;
    }
  }

  /** A `FlagReader` bound to this store (wrap with `ConversationTaskFlagCache`). */
  flagReader(): FlagReader {
    return (flag) => this.isFlagEnabled(flag);
  }

  /** A tenant-allow reader bound to this store (wrap with `TenantAllowlistCache`). */
  allowReader(): AllowlistReader {
    return (tenantId) => this.isTenantAllowed(tenantId);
  }

  /**
   * Ops snapshot for Gate C tooling. Fail-closed: any read error looks like
   * everything OFF / empty. Never includes plaintext tenant ids.
   */
  readEnablementStatus(): EnablementStatus {
    const forbidden: EnablementFlagStatus[] = SHADOW_FORBIDDEN_FLAGS.map((flag) => ({
      flag,
      enabled: false,
      state: "forbidden(off)",
    }));
    try {
      const flagRows = this.db
        .prepare(
          "SELECT flag, enabled, actor, reason, updated_at_ms, state_version FROM feature_flags",
        )
        .all() as Array<{
        flag: string;
        enabled: number | bigint;
        actor: string;
        reason: string;
        updated_at_ms: number | bigint;
        state_version: number | bigint;
      }>;
      const byName = new Map(flagRows.map((row) => [row.flag, row]));
      const shadowFlags: EnablementFlagStatus[] = (["detection", "qualification"] as const).map(
        (flag) => {
          const row = byName.get(flag);
          if (!row) {
            return { flag, enabled: false, state: "off" };
          }
          const enabled = Number(row.enabled) === 1;
          return {
            flag,
            enabled,
            state: enabled ? "on" : "off",
            actor: row.actor,
            reason: row.reason,
            stateVersion: Number(row.state_version),
            updatedAtMs: Number(row.updated_at_ms),
          };
        },
      );
      const allowRows = this.db
        .prepare(
          "SELECT tenant_key, enabled, actor, reason, updated_at_ms, state_version FROM tenant_allowlist",
        )
        .all() as Array<{
        tenant_key: string;
        enabled: number | bigint;
        actor: string;
        reason: string;
        updated_at_ms: number | bigint;
        state_version: number | bigint;
      }>;
      const entries = allowRows.map((row) => ({
        tenantKeyPrefix: row.tenant_key.slice(0, TENANT_KEY_PREFIX_LEN),
        enabled: Number(row.enabled) === 1,
        actor: row.actor,
        reason: row.reason,
        stateVersion: Number(row.state_version),
        updatedAtMs: Number(row.updated_at_ms),
      }));
      return {
        flags: [...shadowFlags, ...forbidden],
        allowlist: {
          enabledCount: entries.filter((entry) => entry.enabled).length,
          totalCount: entries.length,
          entries,
        },
      };
    } catch {
      return {
        flags: [
          { flag: "detection", enabled: false, state: "off" },
          { flag: "qualification", enabled: false, state: "off" },
          ...forbidden,
        ],
        allowlist: { enabledCount: 0, totalCount: 0, entries: [] },
      };
    }
  }

  close(): void {
    this.db.close();
  }
}

export type EnablementFlagState = "on" | "off" | "forbidden(off)";

export type EnablementFlagStatus = {
  flag: ConversationTaskFlag;
  enabled: boolean;
  state: EnablementFlagState;
  actor?: string;
  reason?: string;
  stateVersion?: number;
  updatedAtMs?: number;
};

export type EnablementAllowlistEntry = {
  tenantKeyPrefix: string;
  enabled: boolean;
  actor: string;
  reason: string;
  stateVersion: number;
  updatedAtMs: number;
};

export type EnablementStatus = {
  flags: EnablementFlagStatus[];
  allowlist: {
    enabledCount: number;
    totalCount: number;
    entries: EnablementAllowlistEntry[];
  };
};

function clampAllowlistTtl(ttlMs: number): number {
  if (!Number.isFinite(ttlMs) || ttlMs < 0) {
    return ALLOWLIST_CACHE_DEFAULT_TTL_MS;
  }
  return Math.min(ttlMs, ALLOWLIST_CACHE_MAX_TTL_MS);
}

export type AllowlistReader = (tenantId: string) => boolean;

export type TenantAllowlistCacheOptions = {
  ttlMs?: number;
  reader: AllowlistReader;
  now?: () => number;
};

/**
 * Hot-read cache for the tenant allowlist: TTL <= 3s (hard cap 5s), fail-safe-off
 * (a reader throw is cached as `false`), `invalidate()` for immediate observation.
 * Bounds cross-instance staleness to the TTL.
 */
export class TenantAllowlistCache {
  private readonly ttlMs: number;
  private readonly reader: AllowlistReader;
  private readonly now: () => number;
  private readonly entries = new Map<string, { value: boolean; expiresAtMs: number }>();

  constructor(options: TenantAllowlistCacheOptions) {
    this.ttlMs = clampAllowlistTtl(options.ttlMs ?? ALLOWLIST_CACHE_DEFAULT_TTL_MS);
    this.reader = options.reader;
    this.now = options.now ?? Date.now;
  }

  isAllowed(tenantId: string): boolean {
    const nowMs = this.now();
    const cached = this.entries.get(tenantId);
    if (cached && nowMs < cached.expiresAtMs) {
      return cached.value;
    }
    let value: boolean;
    try {
      value = this.reader(tenantId);
    } catch {
      value = false; // fail-safe-off
    }
    this.entries.set(tenantId, { value, expiresAtMs: nowMs + this.ttlMs });
    return value;
  }

  invalidate(tenantId?: string): void {
    if (tenantId) {
      this.entries.delete(tenantId);
    } else {
      this.entries.clear();
    }
  }
}
