import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StageDCompletionRecord } from "./item7-stage-d-memory-sync.js";
import {
  createPersistentStageDStore,
  type StageDPersistentStore,
} from "./item7-stage-d-persistent-store.js";

let stateDir: string;
let store: StageDPersistentStore;

const FENCE = "memory-sync:ws:tenant-a:user:user-1:asset:asset-1";
const RESOURCE = "ws:tenant-a:user:user-1:asset:asset-1";
const OP = "op-persist-1";
const TOKEN = "fence-token-1";

function completion(overrides: Partial<StageDCompletionRecord> = {}): StageDCompletionRecord {
  return {
    operationId: OP,
    tenantId: "tenant-a",
    sourceResourceId: RESOURCE,
    destinationMode: "local-only",
    manifestSha256: "a".repeat(64),
    classification: "confidential",
    ...overrides,
  };
}

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "stage-d-store-"));
  store = createPersistentStageDStore({ stateDir });
});
afterEach(() => {
  fs.rmSync(stateDir, { recursive: true, force: true });
});

describe("persistent store — atomic exclusive acquire (in-process)", () => {
  it("first acquire wins; a different operation on the same fence is concurrent", () => {
    expect(store.tryAcquire(FENCE, OP, TOKEN)).toEqual({ acquired: true });
    expect(store.tryAcquire(FENCE, "op-other", "tok-other")).toEqual({
      acquired: false,
      reason: "concurrent",
    });
  });

  it("same operation + same token re-acquires (crash resume); a stale token is rejected", () => {
    expect(store.tryAcquire(FENCE, OP, TOKEN)).toEqual({ acquired: true });
    expect(store.tryAcquire(FENCE, OP, TOKEN)).toEqual({ acquired: true });
    expect(store.tryAcquire(FENCE, OP, "advanced-token")).toEqual({
      acquired: false,
      reason: "stale_token",
    });
  });

  it("release frees the fence for a new operation", () => {
    expect(store.tryAcquire(FENCE, OP, TOKEN)).toEqual({ acquired: true });
    store.release(FENCE);
    expect(store.tryAcquire(FENCE, "op-2", "tok-2")).toEqual({ acquired: true });
  });

  it("held record carries full identity + acquired state", () => {
    store.tryAcquire(FENCE, OP, TOKEN);
    const held = store.heldRecord(FENCE);
    expect(held?.operationId).toBe(OP);
    expect(held?.fencingToken).toBe(TOKEN);
    expect(held?.state).toBe("acquired");
    expect(typeof held?.createdAt).toBe("string");
    expect(typeof held?.updatedAt).toBe("string");
  });
});

describe("persistent store — completion replay", () => {
  it("completedRecord returns the 6-field identity subset after markCompleted", () => {
    store.tryAcquire(FENCE, OP, TOKEN);
    store.markCompleted(completion());
    expect(store.completedRecord(OP)).toEqual(completion());
  });

  it("a fresh store instance (simulated restart) still replays the completion", () => {
    store.tryAcquire(FENCE, OP, TOKEN);
    store.markCompleted(completion());
    const reopened = createPersistentStageDStore({ stateDir });
    expect(reopened.completedRecord(OP)).toEqual(completion());
  });

  it("completedRecord is null for an unknown operation", () => {
    expect(store.completedRecord("never-ran")).toBeNull();
  });
});

describe("persistent store — recovery_required blocks until explicit resolve", () => {
  it("records a durable recovery block that halts subsequent acquires", () => {
    store.tryAcquire(FENCE, OP, TOKEN);
    store.recordRecoveryRequired({
      operationId: OP,
      tenantId: "tenant-a",
      resourceIds: [RESOURCE],
      fenceKey: FENCE,
      reason: "partial_copy_failure",
      adapterResult: "partial-failure",
    });
    expect(store.isRecoveryBlocked(FENCE)).toBe(true);
    // release does NOT clear a recovery_required fence.
    store.release(FENCE);
    expect(store.isRecoveryBlocked(FENCE)).toBe(true);
    expect(store.tryAcquire(FENCE, "op-new", "tok-new")).toEqual({
      acquired: false,
      reason: "concurrent",
    });
  });

  it("recovery block survives a simulated restart", () => {
    store.recordRecoveryRequired({
      operationId: OP,
      tenantId: "tenant-a",
      resourceIds: [RESOURCE],
      fenceKey: FENCE,
      reason: "hash_mismatch",
      adapterResult: "hash-mismatch",
      expectedSha256: "a".repeat(64),
      actualSha256: "b".repeat(64),
    });
    const reopened = createPersistentStageDStore({ stateDir });
    expect(reopened.isRecoveryBlocked(FENCE)).toBe(true);
    expect(reopened.tryAcquire(FENCE, "op-new", "tok-new").acquired).toBe(false);
  });

  it("the rich recovery receipt is auditable and halting", () => {
    store.recordRecoveryRequired({
      operationId: OP,
      tenantId: "tenant-a",
      resourceIds: [RESOURCE],
      fenceKey: FENCE,
      reason: "partial_copy_failure",
      adapterResult: "partial-failure",
      residualStagingRef: "staging/op-persist-1",
    });
    const rich = store.getRecovery(OP);
    expect(rich?.haltCompensation).toBe(true);
    expect(rich?.resourceIds).toEqual([RESOURCE]);
    expect(rich?.residualStagingRef).toBe("staging/op-persist-1");
    expect(rich?.resolvedAt).toBeNull();
    expect(store.listRecoveries().length).toBe(1);
  });

  it("only an explicit operator resolve lifts the block; a new operation may then run", () => {
    store.tryAcquire(FENCE, OP, TOKEN);
    store.recordRecoveryRequired({
      operationId: OP,
      tenantId: "tenant-a",
      resourceIds: [RESOURCE],
      fenceKey: FENCE,
      reason: "partial_copy_failure",
    });
    const resolved = store.resolveRecovery({
      operationId: OP,
      fenceKey: FENCE,
      operator: "op-alice",
      resolution: "inspected staging, discarded partial, safe to retry",
    });
    expect(resolved.resolved).toBe(true);
    expect(resolved.physicalCleanupPerformed).toBe(true);
    expect(store.isRecoveryBlocked(FENCE)).toBe(false);
    expect(store.getRecovery(OP)?.resolvedAt).not.toBeNull();
    expect(store.tryAcquire(FENCE, "op-after-resolve", "tok-after").acquired).toBe(true);
  });

  it("legal hold forbids physical cleanup on resolve (block lifted, artifacts preserved)", () => {
    store.tryAcquire(FENCE, OP, TOKEN);
    store.recordRecoveryRequired({
      operationId: OP,
      tenantId: "tenant-a",
      resourceIds: [RESOURCE],
      fenceKey: FENCE,
      reason: "partial_copy_failure",
      legalHold: true,
    });
    const resolved = store.resolveRecovery({
      operationId: OP,
      fenceKey: FENCE,
      operator: "op-legal",
      resolution: "legal hold — preserved for review",
      legalHold: true,
    });
    expect(resolved.physicalCleanupPerformed).toBe(false);
    // Held artifact is preserved (not physically deleted) under legal hold.
    expect(store.heldRecord(FENCE)).not.toBeNull();
  });

  it("the bound recoverySink writes a durable receipt and blocks the resource", () => {
    const receipt = store.recoverySink({
      operationId: OP,
      stage: "memory_stage_d_sync",
      reason: "partial_copy_failure",
      resourceIds: [RESOURCE],
    });
    expect(receipt.haltCompensation).toBe(true);
    expect(store.isRecoveryBlocked(FENCE)).toBe(true);
  });
});

describe("persistent store — fail-closed token safety", () => {
  it("rejects an unsafe operationId (path traversal) fail-closed", () => {
    expect(() => store.tryAcquire(FENCE, "../escape", TOKEN)).toThrow();
    expect(() => store.completedRecord("../escape")).toThrow();
  });

  it("recovery receipt stores no absolute host path in the residual reference", () => {
    store.recordRecoveryRequired({
      operationId: OP,
      tenantId: "tenant-a",
      resourceIds: [RESOURCE],
      fenceKey: FENCE,
      reason: "partial_copy_failure",
      residualStagingRef: "staging/op-persist-1",
    });
    const rich = store.getRecovery(OP);
    expect(rich?.residualStagingRef?.startsWith("/")).toBe(false);
  });

  it("halts (throws) when the recovery receipt cannot be durably written — never a silent swallow", () => {
    // Force the durable receipt write to fail by planting a FILE where the
    // `recovery/` directory must be created (writeJsonDurable mkdir -> EEXIST).
    const root = path.join(stateDir, "data-governance", "stage-d-sync");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "recovery"), "not-a-directory");
    store.tryAcquire(FENCE, OP, TOKEN);
    expect(() =>
      store.recordRecoveryRequired({
        operationId: OP,
        tenantId: "tenant-a",
        resourceIds: [RESOURCE],
        fenceKey: FENCE,
        reason: "partial_copy_failure",
      }),
    ).toThrow();
    // Fail-closed: the durable write failed, so we must NOT have gone on to mark
    // the resource blocked (never claim recovery was recorded when it was not).
    expect(store.isRecoveryBlocked(FENCE)).toBe(false);
  });
});
