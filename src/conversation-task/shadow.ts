/**
 * ConversationTask Runtime — shadow decision log storage (P2, per p2-ops-review.md O4;
 * P2.5 hardened per admission §5 AC3/AC4/C1/C2/C5).
 *
 * Shadow logs are privacy-safe observability records: reason codes, decision
 * version, result and a keyed fingerprint — never raw user text, and (P2.5) never
 * plaintext conversation/message ids. This module:
 *  - fingerprints text with a tenant-scoped **keyed HMAC** (key from an injected
 *    provider backed by secrets, never code/logs); a rotated key breaks the chain;
 *  - stores `conversationId`/`messageId` **only as tenant-scoped keyed HMAC columns**
 *    (never plaintext) and enforces a **composite UNIQUE** `(conversation_id_hmac,
 *    message_id_hmac, decision_version, key_id)` with **atomic create-if-absent**
 *    (`ON CONFLICT DO NOTHING`) so duplicate/concurrent delivery yields one row;
 *  - never persists the offline, **unkeyed** `fingerprintText` (`fp_…`) in a
 *    production record — the persisted `inputFingerprint` is overwritten with the
 *    keyed fingerprint (C1);
 *  - **refuses writes when the HMAC key is missing (fail-closed, never an empty
 *    secret)** (C5) or **past its rotation age** (fail-closed);
 *  - persists to a per-tenant SQLite DB (survives restart) via the shared
 *    tenant-isolation protocol; default TTL 30 days, lowerable per tenant;
 *  - deletes by conversation or tenant and records a **tamper-evident, HMAC-keyed,
 *    hash-chained** deletion receipt.
 *
 * Idempotency epoch (C2): uniqueness holds within a key epoch (`key_id`). A key
 * rotation changes `key_id` (new epoch, like a TTL reset); TTL deletion of a row
 * likewise lets a later delivery re-insert. It never touches the Progress Ledger
 * and performs no real side effects.
 */

import { createHmac } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { canonicalSerialize, fileKeyForTenant } from "./canonical.js";
import { ConversationTaskStoreError } from "./errors.js";
import { openTenantScopedDb, type IsolationViolationRecord } from "./store.js";
import type { ShadowDecisionLog } from "./types.js";

export const SHADOW_LOG_DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const HMAC_KEY_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

/** A tenant HMAC key, supplied from a secrets source (never code/logs). */
export type TenantHmacKey = {
  keyId: string;
  secret: string;
  issuedAtMs: number;
};

/**
 * Provider contract (C5): returns the tenant's current HMAC key. It **must throw**
 * when no key is available for the tenant — it must never return an empty/absent
 * secret. The shadow write path additionally guards against an empty secret and
 * fails closed (no write, no unkeyed degrade).
 */
export type TenantHmacKeyProvider = (tenantId: string) => TenantHmacKey;

/**
 * Tenant-scoped keyed fingerprint of input text: `hf_<keyId>_<HMAC-SHA256>`. The
 * keyId prefix means a rotated key produces a different fingerprint (chain break
 * by design). The raw text is never stored or returned.
 */
export function tenantFingerprint(text: string, tenantId: string, key: TenantHmacKey): string {
  const mac = createHmac("sha256", key.secret)
    .update(canonicalSerialize([tenantId.normalize("NFC"), text.normalize("NFC")]))
    .digest("hex");
  return `hf_${key.keyId}_${mac}`;
}

/**
 * Tenant-scoped keyed HMAC of an identifier (conversation/message), domain-separated
 * by `kind`: `hi_<keyId>_<HMAC-SHA256>`. Used as the on-disk id column value so no
 * plaintext id is ever persisted (C2/AC4). Full-width (not truncated); keyed, so it
 * is not recomputable without the tenant secret.
 */
export function keyedIdHmac(
  kind: "conv" | "msg",
  id: string,
  tenantId: string,
  key: TenantHmacKey,
): string {
  const mac = createHmac("sha256", key.secret)
    .update(canonicalSerialize([tenantId.normalize("NFC"), kind, id.normalize("NFC")]))
    .digest("hex");
  return `hi_${key.keyId}_${mac}`;
}

/** True when a key is at/over the rotation age (default 90 days) and must rotate. */
export function isHmacRotationDue(
  key: TenantHmacKey,
  atMs: number,
  maxAgeMs = HMAC_KEY_MAX_AGE_MS,
): boolean {
  return atMs - key.issuedAtMs >= maxAgeMs;
}

/**
 * Fail-closed guard (C5): a usable key must be present with a non-empty secret and
 * a keyId. A provider that cannot supply a key must throw; if it returns anything
 * without a real secret we refuse the write here rather than degrade to unkeyed.
 */
function assertUsableKey(key: TenantHmacKey | undefined | null): asserts key is TenantHmacKey {
  if (
    !key ||
    typeof key.secret !== "string" ||
    key.secret.length === 0 ||
    typeof key.keyId !== "string" ||
    key.keyId.length === 0
  ) {
    throw new ConversationTaskStoreError(
      "hmac_key_missing",
      "tenant HMAC key is missing; shadow write refused (fail-closed, no unkeyed degrade)",
    );
  }
}

export type ShadowLogInput = {
  conversationId: string;
  messageId: string;
  /** Raw text — used only to compute the keyed fingerprint; never stored. */
  text: string;
  log: ShadowDecisionLog;
};

export type StoredShadowLog = {
  id: number;
  tenantKey: string;
  /** Keyed HMAC of conversationId (never plaintext). */
  conversationIdHmac: string;
  /** Keyed HMAC of messageId (never plaintext). */
  messageIdHmac: string;
  decisionVersion: string;
  keyId: string;
  fingerprint: string;
  log: ShadowDecisionLog;
  atMs: number;
  expiresAtMs: number;
  /** True if this call inserted a new row; false if it hit the composite UNIQUE. */
  inserted: boolean;
};

/** Tamper-evident, HMAC-keyed, hash-chained deletion receipt (aligns with S7). */
export type ShadowDeletionReceipt = {
  receiptId: string;
  scope: "conversation" | "tenant";
  tenantKey: string;
  /** Keyed HMAC of the conversationId (never plaintext); absent for tenant scope. */
  conversationIdHmac?: string;
  removed: number;
  atMs: number;
  keyId: string;
  /** Digest of the previous receipt (hash chain; "genesis" for the first). */
  prevDigest: string;
  /** HMAC-SHA256(secret, canonical(fields || prevDigest)); keyed, not recomputable. */
  digest: string;
};

export type ShadowLogBookOptions = {
  tenantId: string;
  storeRoot?: string;
  keyProvider: TenantHmacKeyProvider;
  /** TTL for this tenant; defaults to 30 days, may be lowered per tenant. */
  ttlMs?: number;
  now?: () => number;
  onIsolationViolation?: (record: IsolationViolationRecord) => void;
};

const SHADOW_BUSINESS_TABLES = ["shadow_logs", "shadow_receipts"] as const;

function createShadowSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shadow_logs (
      id                    INTEGER PRIMARY KEY,
      conversation_id_hmac  TEXT NOT NULL,
      message_id_hmac       TEXT NOT NULL,
      decision_version      TEXT NOT NULL,
      key_id                TEXT NOT NULL,
      fingerprint           TEXT NOT NULL,
      log_json              TEXT NOT NULL,
      at_ms                 INTEGER NOT NULL,
      expires_at_ms         INTEGER NOT NULL,
      UNIQUE(conversation_id_hmac, message_id_hmac, decision_version, key_id)
    );
    CREATE INDEX IF NOT EXISTS idx_shadow_conv ON shadow_logs(conversation_id_hmac);
    CREATE TABLE IF NOT EXISTS shadow_receipts (
      id                    INTEGER PRIMARY KEY,
      receipt_id            TEXT NOT NULL,
      scope                 TEXT NOT NULL,
      conversation_id_hmac  TEXT,
      removed               INTEGER NOT NULL,
      at_ms                 INTEGER NOT NULL,
      key_id                TEXT NOT NULL,
      prev_digest           TEXT NOT NULL,
      digest                TEXT NOT NULL
    );
  `);
}

/** Canonical signing input for a receipt digest (order is fixed). */
function receiptSigningFields(fields: {
  scope: "conversation" | "tenant";
  tenantKey: string;
  conversationIdHmac?: string;
  removed: number;
  atMs: number;
  keyId: string;
  prevDigest: string;
}): readonly string[] {
  return [
    fields.scope,
    fields.tenantKey,
    fields.conversationIdHmac ?? "",
    String(fields.removed),
    String(fields.atMs),
    fields.keyId,
    fields.prevDigest,
  ];
}

function computeReceiptDigest(
  secret: string,
  fields: Parameters<typeof receiptSigningFields>[0],
): string {
  return createHmac("sha256", secret)
    .update(canonicalSerialize(receiptSigningFields(fields)))
    .digest("hex");
}

/**
 * Verify a deletion receipt's HMAC digest with the tenant key. Returns false if
 * any field was tampered with or the key is wrong. Auditors use this to prove the
 * receipt was not forged/recomputed without the secret.
 */
export function verifyShadowReceipt(receipt: ShadowDeletionReceipt, key: TenantHmacKey): boolean {
  if (receipt.keyId !== key.keyId) {
    return false;
  }
  const expected = computeReceiptDigest(key.secret, {
    scope: receipt.scope,
    tenantKey: receipt.tenantKey,
    conversationIdHmac: receipt.conversationIdHmac,
    removed: receipt.removed,
    atMs: receipt.atMs,
    keyId: receipt.keyId,
    prevDigest: receipt.prevDigest,
  });
  return expected === receipt.digest;
}

type ShadowLogRow = {
  id: number | bigint;
  conversation_id_hmac: string;
  message_id_hmac: string;
  decision_version: string;
  key_id: string;
  fingerprint: string;
  log_json: string;
  at_ms: number | bigint;
  expires_at_ms: number | bigint;
};

type ReceiptRow = {
  receipt_id: string;
  scope: string;
  conversation_id_hmac: string | null;
  removed: number | bigint;
  at_ms: number | bigint;
  key_id: string;
  prev_digest: string;
  digest: string;
};

/**
 * Persistent, tenant-scoped shadow log book (per-tenant `.shadow.db`). Holds only
 * redacted records with keyed fingerprints and keyed id columns, and enforces the
 * composite-unique idempotency, TTL and deletion semantics above.
 */
export class ShadowLogBook {
  private readonly db: DatabaseSync;
  private readonly tenantId: string;
  readonly tenantKey: string;
  private readonly keyProvider: TenantHmacKeyProvider;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: ShadowLogBookOptions) {
    const scoped = openTenantScopedDb({
      tenantId: options.tenantId,
      storeRoot: options.storeRoot,
      fileSuffix: ".shadow.db",
      createBusinessSchema: createShadowSchema,
      businessTables: SHADOW_BUSINESS_TABLES,
      onIsolationViolation: options.onIsolationViolation,
      now: options.now,
    });
    this.db = scoped.db;
    this.tenantId = scoped.tenantId;
    this.tenantKey = fileKeyForTenant(options.tenantId);
    this.keyProvider = options.keyProvider;
    this.ttlMs = options.ttlMs ?? SHADOW_LOG_DEFAULT_TTL_MS;
    this.now = scoped.now;
  }

  /** Resolve the tenant key, failing closed if the provider throws or yields no secret. */
  private resolveKey(): TenantHmacKey {
    const key = this.keyProvider(this.tenantId);
    assertUsableKey(key);
    return key;
  }

  private rowToStored(row: ShadowLogRow, inserted: boolean): StoredShadowLog {
    return {
      id: Number(row.id),
      tenantKey: this.tenantKey,
      conversationIdHmac: row.conversation_id_hmac,
      messageIdHmac: row.message_id_hmac,
      decisionVersion: row.decision_version,
      keyId: row.key_id,
      fingerprint: row.fingerprint,
      log: JSON.parse(row.log_json) as ShadowDecisionLog,
      atMs: Number(row.at_ms),
      expiresAtMs: Number(row.expires_at_ms),
      inserted,
    };
  }

  /**
   * Append a shadow log with keyed HMAC fingerprint + keyed id columns, atomic
   * create-if-absent on the composite UNIQUE. Fails closed when the HMAC key is
   * missing (C5) or past its rotation age. The persisted record never contains the
   * unkeyed `fingerprintText` — `inputFingerprint` is overwritten with the keyed
   * fingerprint (C1). A duplicate/concurrent delivery returns the existing row with
   * `inserted: false`.
   */
  append(input: ShadowLogInput): StoredShadowLog {
    const atMs = this.now();
    const key = this.resolveKey();
    if (isHmacRotationDue(key, atMs)) {
      throw new ConversationTaskStoreError(
        "hmac_key_expired",
        "shadow HMAC key is past its rotation age; rotate before writing",
      );
    }
    const fingerprint = tenantFingerprint(input.text, this.tenantId, key);
    const convHmac = keyedIdHmac("conv", input.conversationId, this.tenantId, key);
    const msgHmac = keyedIdHmac("msg", input.messageId, this.tenantId, key);
    const decisionVersion = input.log.decisionVersion;
    const keyId = key.keyId;
    const expiresAtMs = atMs + this.ttlMs;
    // C1: never persist the unkeyed fingerprintText; the on-disk record carries the
    // keyed fingerprint in `inputFingerprint` (and the dedicated `fingerprint` column).
    const persistedLog: ShadowDecisionLog = { ...input.log, inputFingerprint: fingerprint };
    const logJson = JSON.stringify(persistedLog);
    const result = this.db
      .prepare(
        `INSERT INTO shadow_logs
           (conversation_id_hmac, message_id_hmac, decision_version, key_id,
            fingerprint, log_json, at_ms, expires_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(conversation_id_hmac, message_id_hmac, decision_version, key_id)
           DO NOTHING`,
      )
      .run(convHmac, msgHmac, decisionVersion, keyId, fingerprint, logJson, atMs, expiresAtMs);
    if (Number(result.changes) === 1) {
      return {
        id: Number(result.lastInsertRowid),
        tenantKey: this.tenantKey,
        conversationIdHmac: convHmac,
        messageIdHmac: msgHmac,
        decisionVersion,
        keyId,
        fingerprint,
        log: persistedLog,
        atMs,
        expiresAtMs,
        inserted: true,
      };
    }
    // Duplicate / concurrent delivery hit the composite UNIQUE: return the existing row.
    const existing = this.db
      .prepare(
        `SELECT * FROM shadow_logs
         WHERE conversation_id_hmac = ? AND message_id_hmac = ?
           AND decision_version = ? AND key_id = ?`,
      )
      .get(convHmac, msgHmac, decisionVersion, keyId) as ShadowLogRow;
    return this.rowToStored(existing, false);
  }

  /** Remove logs past their TTL. Returns the number removed. */
  pruneExpired(atMs = this.now()): number {
    const result = this.db.prepare(`DELETE FROM shadow_logs WHERE expires_at_ms <= ?`).run(atMs);
    return Number(result.changes);
  }

  private lastReceiptDigest(): string {
    const row = this.db
      .prepare(`SELECT digest FROM shadow_receipts ORDER BY id DESC LIMIT 1`)
      .get() as { digest: string } | undefined;
    return row?.digest ?? "genesis";
  }

  private writeReceipt(
    scope: "conversation" | "tenant",
    removed: number,
    conversationIdHmac: string | undefined,
    atMs: number,
    key: TenantHmacKey,
  ): ShadowDeletionReceipt {
    const prevDigest = this.lastReceiptDigest();
    const digest = computeReceiptDigest(key.secret, {
      scope,
      tenantKey: this.tenantKey,
      conversationIdHmac,
      removed,
      atMs,
      keyId: key.keyId,
      prevDigest,
    });
    const receiptId = `rcpt_${createHmac("sha256", key.secret)
      .update(`${scope}:${conversationIdHmac ?? ""}:${atMs}:${prevDigest}`)
      .digest("hex")
      .slice(0, 24)}`;
    this.db
      .prepare(
        `INSERT INTO shadow_receipts
           (receipt_id, scope, conversation_id_hmac, removed, at_ms, key_id, prev_digest, digest)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        receiptId,
        scope,
        conversationIdHmac ?? null,
        removed,
        atMs,
        key.keyId,
        prevDigest,
        digest,
      );
    return {
      receiptId,
      scope,
      tenantKey: this.tenantKey,
      ...(conversationIdHmac ? { conversationIdHmac } : undefined),
      removed,
      atMs,
      keyId: key.keyId,
      prevDigest,
      digest,
    };
  }

  /** Hard-delete all logs for a conversation; records + returns an audit receipt. */
  deleteByConversation(conversationId: string): ShadowDeletionReceipt {
    const key = this.resolveKey();
    const convHmac = keyedIdHmac("conv", conversationId, this.tenantId, key);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const removed = Number(
        this.db.prepare(`DELETE FROM shadow_logs WHERE conversation_id_hmac = ?`).run(convHmac)
          .changes,
      );
      const receipt = this.writeReceipt("conversation", removed, convHmac, this.now(), key);
      this.db.exec("COMMIT");
      return receipt;
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // ignore
      }
      throw err;
    }
  }

  /** Hard-delete every log for this tenant; records + returns an audit receipt. */
  deleteByTenant(): ShadowDeletionReceipt {
    const key = this.resolveKey();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const removed = Number(this.db.prepare(`DELETE FROM shadow_logs`).run().changes);
      const receipt = this.writeReceipt("tenant", removed, undefined, this.now(), key);
      this.db.exec("COMMIT");
      return receipt;
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // ignore
      }
      throw err;
    }
  }

  size(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM shadow_logs`).get() as {
      n: number | bigint;
    };
    return Number(row.n);
  }

  listReceipts(): ShadowDeletionReceipt[] {
    const rows = this.db
      .prepare(`SELECT * FROM shadow_receipts ORDER BY id ASC`)
      .all() as ReceiptRow[];
    return rows.map((r) => ({
      receiptId: r.receipt_id,
      scope: r.scope as "conversation" | "tenant",
      tenantKey: this.tenantKey,
      ...(r.conversation_id_hmac ? { conversationIdHmac: r.conversation_id_hmac } : undefined),
      removed: Number(r.removed),
      atMs: Number(r.at_ms),
      keyId: r.key_id,
      prevDigest: r.prev_digest,
      digest: r.digest,
    }));
  }

  /** Find stored logs for a conversation (looked up by keyed HMAC under the current key). */
  find(conversationId: string): StoredShadowLog[] {
    const key = this.resolveKey();
    const convHmac = keyedIdHmac("conv", conversationId, this.tenantId, key);
    const rows = this.db
      .prepare(`SELECT * FROM shadow_logs WHERE conversation_id_hmac = ? ORDER BY id ASC`)
      .all(convHmac) as ShadowLogRow[];
    return rows.map((r) => this.rowToStored(r, false));
  }

  close(): void {
    this.db.close();
  }
}
