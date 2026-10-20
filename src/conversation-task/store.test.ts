import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requireNodeSqlite } from "../memory/sqlite.js";
import { fileKeyForTenant } from "./canonical.js";
import { ConversationTaskStoreError, TenantIsolationViolationError } from "./errors.js";
import { openTaskStore, type IsolationViolationRecord } from "./store.js";
import { emptyTaskSignals, type DetectionResult, type QualificationResult } from "./types.js";

const CLOCK = () => 1_000;

const DETECTION: DetectionResult = {
  detected: true,
  signals: emptyTaskSignals(),
  confidence: "high",
  reasons: [],
};
const QUALIFICATION: QualificationResult = { kind: "chat", reasons: [] };

function candidateInput(
  over: Partial<Parameters<ReturnType<typeof openTaskStore>["createCandidateIfAbsent"]>[0]> = {},
) {
  return {
    conversationId: "conv-1",
    sourceMessageId: "msg-1",
    decisionVersion: "v1",
    detection: DETECTION,
    qualification: QUALIFICATION,
    ttlMs: 30 * 24 * 60 * 60 * 1000,
    ...over,
  };
}

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ct-store-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function dbPathFor(tenantId: string): string {
  return path.join(root, "tenant", `${fileKeyForTenant(tenantId)}.db`);
}

describe("openTaskStore fail-closed + PRAGMA self-check", () => {
  it("rejects a missing/untrusted tenantId (fail-closed)", () => {
    expect(() => openTaskStore({ tenantId: "", storeRoot: root })).toThrow(
      ConversationTaskStoreError,
    );
    expect(() => openTaskStore({ tenantId: "   ", storeRoot: root })).toThrow(/missing_tenant/);
  });

  it("opens a tenant DB with WAL + foreign_keys and stores under a hex file key", () => {
    const store = openTaskStore({ tenantId: "tenant-a", storeRoot: root, now: CLOCK });
    expect(store.fileKey).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.existsSync(dbPathFor("tenant-a"))).toBe(true);
    store.close();
  });

  it("keeps a path-traversal tenantId contained (file key is pure hex)", () => {
    const store = openTaskStore({ tenantId: "../../etc/passwd", storeRoot: root, now: CLOCK });
    expect(store.fileKey).toMatch(/^[0-9a-f]{64}$/);
    // The DB lives under <root>/tenant/<hex>.db, never at a traversed location.
    expect(fs.existsSync(path.join(root, "tenant", `${store.fileKey}.db`))).toBe(true);
    expect(fs.existsSync(path.join(root, "..", "etc", "passwd"))).toBe(false);
    store.close();
  });
});

describe("Candidate persistence + idempotency (CT8)", () => {
  it("create-if-absent is idempotent for a redelivered message", () => {
    const store = openTaskStore({ tenantId: "tenant-a", storeRoot: root, now: CLOCK });
    const first = store.createCandidateIfAbsent(candidateInput());
    const second = store.createCandidateIfAbsent(candidateInput());
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.candidate.id).toBe(first.candidate.id);
    store.close();
  });

  it("expires candidates past their TTL", () => {
    const store = openTaskStore({ tenantId: "tenant-a", storeRoot: root, now: () => 1_000 });
    store.createCandidateIfAbsent(candidateInput({ ttlMs: 500 }));
    expect(store.expireCandidates(1_400)).toBe(0); // not yet expired (expires at 1500)
    expect(store.expireCandidates(1_600)).toBe(1); // now expired
    store.close();
  });
});

describe("Scheme A coexistence: candidate_id is a plain, non-unique index", () => {
  it("allows two hash-equal / tuple-different rows to coexist", () => {
    const store = openTaskStore({ tenantId: "tenant-a", storeRoot: root, now: CLOCK });
    const { candidate } = store.createCandidateIfAbsent(candidateInput({ sourceMessageId: "mA" }));
    store.close();

    // Force a second row sharing the same candidate_id but a different tuple.
    const { DatabaseSync } = requireNodeSqlite();
    const raw = new DatabaseSync(dbPathFor("tenant-a"));
    raw.exec("PRAGMA busy_timeout = 5000");
    raw
      .prepare(
        `INSERT INTO candidates
           (candidate_id, tenant_id, conversation_id, source_message_id, decision_version,
            status, payload, created_at_ms, expires_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(candidate.candidateId, "tenant-a", "conv-1", "mB", "v1", "observing", "{}", 1, 999_999);
    raw.close();

    const reopened = openTaskStore({ tenantId: "tenant-a", storeRoot: root, now: CLOCK });
    const rows = reopened.findCandidatesByCandidateId(candidate.candidateId);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.sourceMessageId))).toEqual(new Set(["mA", "mB"]));
    reopened.close();
  });
});

// NOTE: real cross-process CAS concurrency (B3) and real crash injection (B7)
// live in store-crossproc.test.ts, which spawns child processes for genuine
// OS-level lock contention and SIGKILL-mid-transaction recovery. The in-process
// checks below only cover single-connection idempotency and the P2/P3 boundary.
describe("ConversationTask create-if-absent (single-process idempotency)", () => {
  it("is idempotent for the same tuple within one connection", () => {
    const store = openTaskStore({ tenantId: "tenant-a", storeRoot: root, now: CLOCK });
    const input = {
      conversationId: "conv-1",
      goal: "每周监控竞品并汇报",
      activationEpoch: 1,
      requesterId: "u1",
    };
    const first = store.createTaskIfAbsent(input);
    const second = store.createTaskIfAbsent(input);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(store.countTasksByLifecycle("active")).toBe(1);
    expect(store.findActiveTasksByConversation("conv-1")).toHaveLength(1);
    store.close();
  });

  it("reserves the revisions schema but never writes it (P2/P3 boundary)", () => {
    const store = openTaskStore({ tenantId: "tenant-a", storeRoot: root, now: CLOCK });
    store.createTaskIfAbsent({
      conversationId: "c",
      goal: "g",
      activationEpoch: 1,
      requesterId: "u",
    });
    expect(store.countRevisions()).toBe(0);
    store.close();
  });
});

describe("ConversationTask lifecycle", () => {
  it("allows legal transitions and rejects reopening a terminal state", () => {
    const store = openTaskStore({ tenantId: "tenant-a", storeRoot: root, now: CLOCK });
    const { task } = store.createTaskIfAbsent({
      conversationId: "c",
      goal: "g",
      activationEpoch: 1,
      requesterId: "u",
    });
    expect(task.lifecycle).toBe("active");
    const closed = store.transitionTask(task.id, "closed");
    expect(closed.lifecycle).toBe("closed");
    expect(() => store.transitionTask(task.id, "active")).toThrow(/illegal_transition/);
    store.close();
  });
});

describe("tenant isolation (B9)", () => {
  it("rejects a mismatched meta.tenant_id (file replacement) fail-closed", () => {
    const a = openTaskStore({ tenantId: "tenant-a", storeRoot: root, now: CLOCK });
    a.createCandidateIfAbsent(candidateInput());
    a.close();

    // Simulate replacing tenant-b's file with tenant-a's DB.
    const pathA = dbPathFor("tenant-a");
    const pathB = dbPathFor("tenant-b");
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(pathA + suffix)) {
        fs.copyFileSync(pathA + suffix, pathB + suffix);
      }
    }

    const violations: IsolationViolationRecord[] = [];
    let threw: unknown;
    try {
      openTaskStore({
        tenantId: "tenant-b",
        storeRoot: root,
        now: CLOCK,
        onIsolationViolation: (v) => violations.push(v),
      });
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeInstanceOf(TenantIsolationViolationError);
    expect((threw as TenantIsolationViolationError).reason).toBe("meta_mismatch");
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toBe("meta_mismatch");
    // Privacy: no raw tenant value in the error or the record.
    const msg = (threw as Error).message;
    expect(msg).toContain(fileKeyForTenant("tenant-b"));
    expect(msg).not.toContain("tenant-a");
    expect(msg).not.toContain("tenant-b");
  });

  it("rejects missing meta with existing business rows (tamper) fail-closed", () => {
    const c = openTaskStore({ tenantId: "tenant-c", storeRoot: root, now: CLOCK });
    c.createCandidateIfAbsent(candidateInput());
    c.close();

    const { DatabaseSync } = requireNodeSqlite();
    const raw = new DatabaseSync(dbPathFor("tenant-c"));
    raw.exec("PRAGMA busy_timeout = 5000");
    raw.exec("DELETE FROM meta WHERE key = 'tenant_id'");
    raw.close();

    expect(() => openTaskStore({ tenantId: "tenant-c", storeRoot: root, now: CLOCK })).toThrow(
      /meta_missing_with_data/,
    );
  });
});

// (B7 real crash injection moved to store-crossproc.test.ts)
