import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseCatalogBindings } from "./bindings.js";
import { attachPrivilegedCognitiveCatalogCas } from "./cognitive-cas-internal.js";
import {
  assertNoEnvelopeSchemaDowngrade,
  assertNoMergeFencingRegression,
  isCognitiveMetadataMutation,
} from "./envelope-cognitive.js";
import {
  assertCatalogMutableEnvelope,
  isCatalogTerminalLifecycle,
  validateGovernanceEnvelope,
} from "./envelope.js";
import { CATALOG_FIELD_LIMITS } from "./limits.js";
import type { CatalogRecord, DataGovernanceEnvelope } from "./types.js";

/**
 * Merge fencing predicate (Gate B B34/B39). Evaluated **inside** the CAS, so a merge
 * holder that was fenced by a takeover cannot land a write it prepared beforehand.
 * The same CAS must advance the resource to this token/epoch — a write that leaves the
 * resource behind the presented generation is rejected.
 */
export type CatalogMergeFencingPredicate = {
  fencingToken: number;
  conflictGraphEpoch: number;
  /** Owning merge. Takeover fences skip the attach-owner check. */
  mergeId: string;
  /** When true, a foreign in-flight attach does not block the token/epoch raise (T3). */
  allowForeignAttach?: boolean;
};

export type CatalogCompareAndPutParams = {
  resourceId: string;
  expectedGovernanceVersion: number;
  next: CatalogRecord;
  /** When set (including null), CAS also compares envelope.lastCognitiveMutationId. */
  expectedLastCognitiveMutationId?: string | null;
  /** When set, CAS additionally enforces the merge fencing generations. */
  expectedMergeFencing?: CatalogMergeFencingPredicate;
};

export type CatalogCompareAndPutConflict =
  | "not_found"
  | "version_conflict"
  | "resource_id_mismatch"
  | "fenced_stale_token"
  | "fenced_stale_graph_epoch"
  | "merge_in_flight"
  | "already_exists";

/**
 * Fail-closed fencing check against a stored envelope. Returns the conflict reason, or
 * null when the presented generations are current and `next` advances them.
 */
function mergeFencingConflict(
  current: DataGovernanceEnvelope,
  next: DataGovernanceEnvelope,
  predicate: CatalogMergeFencingPredicate,
): "fenced_stale_token" | "fenced_stale_graph_epoch" | "merge_in_flight" | null {
  const currentToken = current.lastAcceptedFencingToken ?? 0;
  if (predicate.fencingToken < currentToken) {
    return "fenced_stale_token";
  }
  const currentEpoch = current.lastAcceptedConflictGraphEpoch ?? 0;
  if (predicate.conflictGraphEpoch < currentEpoch) {
    return "fenced_stale_graph_epoch";
  }
  if ((next.lastAcceptedFencingToken ?? 0) !== predicate.fencingToken) {
    return "fenced_stale_token";
  }
  if ((next.lastAcceptedConflictGraphEpoch ?? 0) !== predicate.conflictGraphEpoch) {
    return "fenced_stale_graph_epoch";
  }
  const inflight = current.activeCognitiveMergeOp;
  if (!predicate.allowForeignAttach && inflight && inflight.mergeId !== predicate.mergeId) {
    return "merge_in_flight";
  }
  return null;
}

export type DataGovernanceCatalogStore = {
  get(resourceId: string): Promise<CatalogRecord | null>;
  put(record: CatalogRecord): Promise<void>;
  /**
   * Lock-held resource-version CAS: succeeds only when the stored envelope
   * governanceVersion equals `expectedGovernanceVersion`, then writes `next`
   * (must be expected+1) atomically with the catalog file revision bump.
   */
  compareAndPut(
    params: CatalogCompareAndPutParams,
  ): Promise<
    { ok: true; record: CatalogRecord } | { ok: false; conflict: CatalogCompareAndPutConflict }
  >;
  remove(resourceId: string): Promise<boolean>;
  list(resourceType?: DataGovernanceEnvelope["resourceType"]): Promise<CatalogRecord[]>;
};

type CatalogFileShape = {
  schemaVersion: 1;
  /** Monotonic revision for lost-update detection across writers. */
  revision: number;
  records: Record<string, CatalogRecord>;
};

type StoreGate = {
  chain: Promise<void>;
};

/** Process-wide write serialization keyed by absolute store path. */
const STORE_GATES = new Map<string, StoreGate>();
const STORE_SINGLETONS = new Map<string, DataGovernanceCatalogStore>();

const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 20;
const LOCK_MAX_ATTEMPTS = 250;

function emptyFile(): CatalogFileShape {
  return { schemaVersion: 1, revision: 0, records: {} };
}

function getGate(storePath: string): StoreGate {
  let gate = STORE_GATES.get(storePath);
  if (!gate) {
    gate = { chain: Promise.resolve() };
    STORE_GATES.set(storePath, gate);
  }
  return gate;
}

function sleepAsync(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withExclusiveLockAsync(lockPath: string, fn: () => void): Promise<void> {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, "wx", 0o600);
      try {
        fs.writeFileSync(fd, `${process.pid}\n${Date.now()}\n`, "utf8");
        fn();
        return;
      } finally {
        fs.closeSync(fd);
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // ignore
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw err;
      }
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        // raced unlock
      }
      await sleepAsync(LOCK_RETRY_MS);
    }
  }
  throw new Error("governance_catalog_lock_timeout");
}

function parseCatalogRecord(input: unknown): CatalogRecord {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("governance_catalog_invalid:record_not_object");
  }
  const raw = input as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (key !== "envelope" && key !== "bindings") {
      throw new Error(`governance_catalog_invalid:unknown_record_field:${key}`);
    }
  }
  // Catalog puts use the mutable gate (pending→active); content writes use assertWritableEnvelope.
  const envelope = assertCatalogMutableEnvelope(raw.envelope);
  const bindings = parseCatalogBindings({
    bindings: raw.bindings,
    resourceId: envelope.resourceId,
    canonicalBindingId: envelope.canonicalBindingId,
  });
  const record: CatalogRecord = { envelope, bindings };
  const bytes = Buffer.byteLength(JSON.stringify(record), "utf8");
  if (bytes > CATALOG_FIELD_LIMITS.maxRecordBytes) {
    throw new Error("governance_catalog_invalid:record_too_large");
  }
  return record;
}

function envelopeFromStored(record: CatalogRecord | undefined): DataGovernanceEnvelope | null {
  if (!record) {
    return null;
  }
  const parsed = validateGovernanceEnvelope(record.envelope);
  if (parsed.ok) {
    return parsed.envelope;
  }
  const schemaVersion = (record.envelope as { schemaVersion?: unknown }).schemaVersion;
  if (schemaVersion === 1 || schemaVersion === 2) {
    return record.envelope;
  }
  return null;
}

function assertCatalogWriteGates(
  existing: CatalogRecord | undefined,
  next: CatalogRecord,
  allowCognitiveMutation: boolean,
): void {
  const previous = envelopeFromStored(existing);
  const downgrade = assertNoEnvelopeSchemaDowngrade({
    existing: previous,
    next: next.envelope,
  });
  if (downgrade) {
    throw new Error(`governance_catalog_denied:${downgrade.code}`);
  }
  const regression = assertNoMergeFencingRegression({ existing: previous, next: next.envelope });
  if (regression) {
    throw new Error(`governance_catalog_denied:merge_fencing_regression:${regression.field}`);
  }
  if (!allowCognitiveMutation && isCognitiveMetadataMutation(previous, next.envelope)) {
    throw new Error("governance_catalog_denied:schema_write_locked");
  }
}

/** v1-only persist must not rewrite/strip v2 rows. Dual-reader copies siblings opaquely. */
export function assertCatalogPersistPreservesV2(params: {
  previousRecords: Record<string, unknown>;
  nextRecords: Record<string, unknown>;
}): void {
  for (const [id, previous] of Object.entries(params.previousRecords)) {
    if (!previous || typeof previous !== "object") {
      continue;
    }
    const prevEnv = (previous as { envelope?: { schemaVersion?: unknown } }).envelope;
    if (prevEnv?.schemaVersion !== 2) {
      continue;
    }
    const next = params.nextRecords[id];
    if (next === undefined) {
      continue;
    }
    const nextEnv = (next as { envelope?: { schemaVersion?: unknown } } | null)?.envelope;
    if (!nextEnv || nextEnv.schemaVersion !== 2) {
      throw new Error("governance_catalog_denied:catalog_schema_downgrade_blocked");
    }
  }
}

/**
 * Metadata-only file-backed catalog. Must never persist transcript/embedding bodies.
 * Cross-instance writers share a process gate + exclusive lock file + revision CAS.
 * Lock waits are async (setTimeout) so the Gateway event loop is not spun.
 */
export function createFileDataGovernanceCatalogStore(params: {
  storePath: string;
}): DataGovernanceCatalogStore {
  const storePath = path.resolve(params.storePath);
  const lockPath = `${storePath}.lock`;
  const gate = getGate(storePath);

  function enqueueWrite<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = gate.chain.then(
      () => fn(),
      () => fn(),
    );
    gate.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function readFile(): CatalogFileShape {
    if (!fs.existsSync(storePath)) {
      return emptyFile();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(storePath, "utf8"));
    } catch {
      throw new Error("governance_catalog_corrupt:unreadable_json");
    }
    if (!parsed || typeof parsed !== "object") {
      throw new Error("governance_catalog_corrupt:not_object");
    }
    const file = parsed as CatalogFileShape;
    if (file.schemaVersion !== 1 || !file.records || typeof file.records !== "object") {
      throw new Error("governance_catalog_corrupt:schema");
    }
    if (
      typeof file.revision !== "number" ||
      !Number.isInteger(file.revision) ||
      file.revision < 0
    ) {
      throw new Error("governance_catalog_corrupt:revision");
    }
    return file;
  }

  function writeFileDurable(file: CatalogFileShape): void {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    const payload = `${JSON.stringify(file, null, 2)}\n`;
    if (Buffer.byteLength(payload, "utf8") > CATALOG_FIELD_LIMITS.maxCatalogFileBytes) {
      throw new Error("governance_catalog_invalid:catalog_too_large");
    }
    const tmp = `${storePath}.${process.pid}.${randomUUID()}.tmp`;
    const fd = fs.openSync(tmp, "w", 0o600);
    try {
      fs.writeFileSync(fd, payload, "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, storePath);
    try {
      const dirFd = fs.openSync(path.dirname(storePath), "r");
      try {
        fs.fsyncSync(dirFd);
      } finally {
        fs.closeSync(dirFd);
      }
    } catch {
      // non-fatal on platforms that cannot fsync directories
    }
  }

  async function putUnderLock(sanitized: CatalogRecord): Promise<void> {
    await withExclusiveLockAsync(lockPath, () => {
      const base = readFile();
      const existing = base.records[sanitized.envelope.resourceId];
      if (existing && isCatalogTerminalLifecycle(existing.envelope.lifecycleState)) {
        throw new Error(`governance_catalog_not_mutable:${existing.envelope.lifecycleState}`);
      }
      assertCatalogWriteGates(existing, sanitized, false);
      const expected = base.revision;
      const next: CatalogFileShape = {
        schemaVersion: 1,
        revision: expected + 1,
        records: { ...base.records, [sanitized.envelope.resourceId]: sanitized },
      };
      assertCatalogPersistPreservesV2({
        previousRecords: base.records,
        nextRecords: next.records,
      });
      const latest = readFile();
      if (latest.revision !== expected) {
        throw new Error("governance_catalog_cas_conflict");
      }
      const latestExisting = latest.records[sanitized.envelope.resourceId];
      if (latestExisting && isCatalogTerminalLifecycle(latestExisting.envelope.lifecycleState)) {
        throw new Error(`governance_catalog_not_mutable:${latestExisting.envelope.lifecycleState}`);
      }
      writeFileDurable(next);
    });
  }

  async function compareAndPutUnderLock(
    params: CatalogCompareAndPutParams,
    allowCognitiveMutation: boolean,
  ): Promise<
    { ok: true; record: CatalogRecord } | { ok: false; conflict: CatalogCompareAndPutConflict }
  > {
    let outcome:
      | { ok: true; record: CatalogRecord }
      | { ok: false; conflict: CatalogCompareAndPutConflict }
      | null = null;
    await withExclusiveLockAsync(lockPath, () => {
      if (params.next.envelope.resourceId !== params.resourceId) {
        outcome = { ok: false, conflict: "resource_id_mismatch" };
        return;
      }
      const base = readFile();
      const current = base.records[params.resourceId];
      if (!current) {
        outcome = { ok: false, conflict: "not_found" };
        return;
      }
      if (isCatalogTerminalLifecycle(current.envelope.lifecycleState)) {
        throw new Error(`governance_catalog_not_mutable:${current.envelope.lifecycleState}`);
      }
      if (current.envelope.governanceVersion !== params.expectedGovernanceVersion) {
        outcome = { ok: false, conflict: "version_conflict" };
        return;
      }
      if (params.expectedLastCognitiveMutationId !== undefined) {
        const currentMarker = current.envelope.lastCognitiveMutationId ?? null;
        if (currentMarker !== params.expectedLastCognitiveMutationId) {
          outcome = { ok: false, conflict: "version_conflict" };
          return;
        }
      }
      if (params.next.envelope.governanceVersion !== params.expectedGovernanceVersion + 1) {
        outcome = { ok: false, conflict: "version_conflict" };
        return;
      }
      if (params.expectedMergeFencing) {
        const fenced = mergeFencingConflict(
          current.envelope,
          params.next.envelope,
          params.expectedMergeFencing,
        );
        if (fenced) {
          outcome = { ok: false, conflict: fenced };
          return;
        }
      }
      const sanitized = parseCatalogRecord(params.next);
      assertCatalogWriteGates(current, sanitized, allowCognitiveMutation);
      const expectedRevision = base.revision;
      const nextFile: CatalogFileShape = {
        schemaVersion: 1,
        revision: expectedRevision + 1,
        records: { ...base.records, [params.resourceId]: sanitized },
      };
      assertCatalogPersistPreservesV2({
        previousRecords: base.records,
        nextRecords: nextFile.records,
      });
      const latest = readFile();
      if (latest.revision !== expectedRevision) {
        outcome = { ok: false, conflict: "version_conflict" };
        return;
      }
      const latestRecord = latest.records[params.resourceId];
      if (
        !latestRecord ||
        latestRecord.envelope.governanceVersion !== params.expectedGovernanceVersion
      ) {
        outcome = { ok: false, conflict: "version_conflict" };
        return;
      }
      if (params.expectedLastCognitiveMutationId !== undefined) {
        const latestMarker = latestRecord.envelope.lastCognitiveMutationId ?? null;
        if (latestMarker !== params.expectedLastCognitiveMutationId) {
          outcome = { ok: false, conflict: "version_conflict" };
          return;
        }
      }
      if (params.expectedMergeFencing) {
        const fenced = mergeFencingConflict(
          latestRecord.envelope,
          sanitized.envelope,
          params.expectedMergeFencing,
        );
        if (fenced) {
          outcome = { ok: false, conflict: fenced };
          return;
        }
      }
      if (isCatalogTerminalLifecycle(latestRecord.envelope.lifecycleState)) {
        throw new Error(`governance_catalog_not_mutable:${latestRecord.envelope.lifecycleState}`);
      }
      writeFileDurable(nextFile);
      outcome = { ok: true, record: sanitized };
    });
    if (!outcome) {
      throw new Error("governance_catalog_compare_and_put_failed");
    }
    return outcome;
  }

  async function uniqueCreateUnderLock(
    record: CatalogRecord,
  ): Promise<
    { ok: true; record: CatalogRecord } | { ok: false; conflict: CatalogCompareAndPutConflict }
  > {
    let outcome:
      | { ok: true; record: CatalogRecord }
      | { ok: false; conflict: CatalogCompareAndPutConflict }
      | null = null;
    await withExclusiveLockAsync(lockPath, () => {
      const sanitized = parseCatalogRecord(record);
      const base = readFile();
      if (base.records[sanitized.envelope.resourceId]) {
        outcome = { ok: false, conflict: "already_exists" };
        return;
      }
      assertCatalogWriteGates(undefined, sanitized, true);
      const expectedRevision = base.revision;
      const nextFile: CatalogFileShape = {
        schemaVersion: 1,
        revision: expectedRevision + 1,
        records: { ...base.records, [sanitized.envelope.resourceId]: sanitized },
      };
      const latest = readFile();
      if (latest.revision !== expectedRevision || latest.records[sanitized.envelope.resourceId]) {
        outcome = { ok: false, conflict: "already_exists" };
        return;
      }
      writeFileDurable(nextFile);
      outcome = { ok: true, record: sanitized };
    });
    if (!outcome) {
      throw new Error("governance_catalog_unique_create_failed");
    }
    return outcome;
  }

  const store: DataGovernanceCatalogStore = {
    async get(resourceId) {
      const file = readFile();
      const raw = file.records[resourceId];
      if (!raw) {
        return null;
      }
      return parseCatalogRecord(raw);
    },

    async put(record) {
      const sanitized = parseCatalogRecord(record);
      return enqueueWrite(() => putUnderLock(sanitized));
    },

    async compareAndPut(params) {
      return enqueueWrite(() => compareAndPutUnderLock(params, false));
    },

    async remove(resourceId) {
      return enqueueWrite(async () => {
        let removed = false;
        await withExclusiveLockAsync(lockPath, () => {
          const base = readFile();
          if (!(resourceId in base.records)) {
            return;
          }
          const expected = base.revision;
          const records = { ...base.records };
          delete records[resourceId];
          const latest = readFile();
          if (latest.revision !== expected) {
            throw new Error("governance_catalog_cas_conflict");
          }
          writeFileDurable({
            schemaVersion: 1,
            revision: expected + 1,
            records,
          });
          removed = true;
        });
        return removed;
      });
    },

    async list(resourceType) {
      const file = readFile();
      const parsed: CatalogRecord[] = [];
      for (const raw of Object.values(file.records)) {
        try {
          parsed.push(parseCatalogRecord(raw));
        } catch {
          // Isolate per-record parse so one row cannot abort sibling v1/v2 rows.
        }
      }
      if (!resourceType) {
        return parsed;
      }
      return parsed.filter((r) => r.envelope.resourceType === resourceType);
    },
  };
  attachPrivilegedCognitiveCatalogCas(store, {
    compareAndPut: (params) => enqueueWrite(() => compareAndPutUnderLock(params, true)),
    uniqueCreate: (record) => enqueueWrite(() => uniqueCreateUnderLock(record)),
  });
  return store;
}

/** One store instance per absolute path (RPC + runtime share writers). */
export function getOrCreateFileDataGovernanceCatalogStore(params: {
  storePath: string;
}): DataGovernanceCatalogStore {
  const key = path.resolve(params.storePath);
  let store = STORE_SINGLETONS.get(key);
  if (!store) {
    store = createFileDataGovernanceCatalogStore({ storePath: key });
    STORE_SINGLETONS.set(key, store);
  }
  return store;
}

/** Test helper. */
export function resetCatalogStoreSingletonsForTests(): void {
  STORE_SINGLETONS.clear();
  STORE_GATES.clear();
}

/**
 * Sync validated Catalog read for placement. Uses the same parser as put/get.
 * Corrupt JSON or an envelope that fails validation returns null (fail closed).
 */
export function loadValidatedCatalogRecordSync(params: {
  storePath: string;
  resourceId: string;
}): { record: CatalogRecord; revision: number } | null {
  const storePath = path.resolve(params.storePath);
  if (!fs.existsSync(storePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf8")) as CatalogFileShape;
    if (
      parsed?.schemaVersion !== 1 ||
      !parsed.records ||
      typeof parsed.records !== "object" ||
      typeof parsed.revision !== "number" ||
      !Number.isInteger(parsed.revision) ||
      parsed.revision < 0
    ) {
      return null;
    }
    const raw = parsed.records[params.resourceId];
    if (!raw) {
      return null;
    }
    return { record: parseCatalogRecord(raw), revision: parsed.revision };
  } catch {
    return null;
  }
}

export function isCatalogRecordValid(record: unknown): boolean {
  try {
    parseCatalogRecord(record);
    return true;
  } catch {
    if (!record || typeof record !== "object") {
      return false;
    }
    const r = record as CatalogRecord;
    return validateGovernanceEnvelope(r.envelope).ok;
  }
}
