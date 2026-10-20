import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertSingleWritableCanonicalBinding,
  advanceCutoverOperation,
  createWorkspaceCutoverOperation,
  FileWorkspaceCutoverStore,
  gateCutoverWrite,
  isCompatibilityReadExpired,
  isCutoverSourceWriteBlocked,
  recordCompatibilityReadAudit,
  resumeWorkspaceCutoverOperation,
  transitionWorkspaceCutoverOperation,
} from "./index.js";

describe("workspace cutover state machine", () => {
  it("advances through the forward path to resolver_write_cutover", () => {
    let op = createWorkspaceCutoverOperation({
      operationId: "op-1",
      resourceId: "ws:tenant-a:group:g1",
      sourceBindingId: "ws:tenant-a:group:g1:canonical:legacy",
      targetBindingId: "ws:tenant-a:group:g1:canonical",
      expectedContentVersion: "v2",
      nowMs: 1,
    });
    const steps = [
      "prepared",
      "write_frozen",
      "copied_or_adopted",
      "verified",
      "dual_read_verified",
      "resolver_write_cutover",
    ] as const;
    for (const step of steps) {
      op = transitionWorkspaceCutoverOperation({ operation: op, nextState: step, nowMs: 2 });
      expect(op.state).toBe(step);
    }
    expect(isCutoverSourceWriteBlocked(op)).toBe(true);
  });

  it("allows rollback before resolver_write_cutover", () => {
    let op = createWorkspaceCutoverOperation({
      operationId: "op-rollback",
      resourceId: "ws:r1",
      sourceBindingId: "src",
      targetBindingId: "dst",
      expectedContentVersion: "v1",
    });
    op = transitionWorkspaceCutoverOperation({ operation: op, nextState: "prepared" });
    op = transitionWorkspaceCutoverOperation({ operation: op, nextState: "write_frozen" });
    op = transitionWorkspaceCutoverOperation({ operation: op, nextState: "prepared" });
    expect(op.state).toBe("prepared");
  });

  it("rejects illegal transitions after terminal state", () => {
    let op = createWorkspaceCutoverOperation({
      operationId: "op-terminal",
      resourceId: "ws:r2",
      sourceBindingId: "src",
      targetBindingId: "dst",
      expectedContentVersion: "v1",
    });
    op = transitionWorkspaceCutoverOperation({ operation: op, nextState: "failed" });
    expect(() =>
      transitionWorkspaceCutoverOperation({ operation: op, nextState: "prepared" }),
    ).toThrow(/terminal/);
  });

  it("resumes idempotently from a non-terminal state", () => {
    const op = createWorkspaceCutoverOperation({
      operationId: "op-resume",
      resourceId: "ws:r3",
      sourceBindingId: "src",
      targetBindingId: "dst",
      expectedContentVersion: "v1",
      nowMs: 10,
    });
    const resumed = resumeWorkspaceCutoverOperation(op, 20);
    expect(resumed.state).toBe("inventoried");
    expect(resumed.updatedAtMs).toBe(20);
  });
});

describe("workspace cutover guards", () => {
  it("rejects two active writable canonical bindings", () => {
    const result = assertSingleWritableCanonicalBinding(
      [
        {
          bindingId: "b1",
          resourceId: "ws:r",
          role: "canonical",
          locator: "/a",
          state: "active",
          contentVersion: "v1",
        },
        {
          bindingId: "b2",
          resourceId: "ws:r",
          role: "canonical",
          locator: "/b",
          state: "active",
          contentVersion: "v2",
        },
      ],
      "ws:r",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("dual_writable_canonical");
    }
  });

  it("blocks source writes after resolver_write_cutover", () => {
    let op = createWorkspaceCutoverOperation({
      operationId: "op-guard",
      resourceId: "ws:r4",
      sourceBindingId: "src-bind",
      targetBindingId: "dst-bind",
      expectedContentVersion: "v2",
    });
    for (const step of [
      "prepared",
      "write_frozen",
      "copied_or_adopted",
      "verified",
      "dual_read_verified",
      "resolver_write_cutover",
    ] as const) {
      op = transitionWorkspaceCutoverOperation({ operation: op, nextState: step });
    }
    expect(gateCutoverWrite({ operation: op, bindingId: "src-bind" }).ok).toBe(false);
    expect(gateCutoverWrite({ operation: op, bindingId: "dst-bind" }).ok).toBe(true);
  });

  it("persists operations and survives restart via file store", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-cutover-store-"));
    const storePath = path.join(root, "cutover", "operations.json");
    const store = new FileWorkspaceCutoverStore(storePath);
    const op = createWorkspaceCutoverOperation({
      operationId: "op-disk",
      resourceId: "ws:r5",
      sourceBindingId: "src",
      targetBindingId: "dst",
      expectedContentVersion: "v1",
    });
    store.save(op);
    const reloaded = new FileWorkspaceCutoverStore(storePath);
    expect(reloaded.get("op-disk")).toMatchObject({ resourceId: "ws:r5", state: "inventoried" });
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("workspace cutover crash and restart", () => {
  const forwardPath = [
    "prepared",
    "write_frozen",
    "copied_or_adopted",
    "verified",
    "dual_read_verified",
    "resolver_write_cutover",
    "compatibility_read_only",
    "retired",
  ] as const;

  it("resumes idempotently after crash at every forward transition", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-cutover-crash-"));
    const storePath = path.join(root, "operations.json");
    const storeA = new FileWorkspaceCutoverStore(storePath);
    const base = createWorkspaceCutoverOperation({
      operationId: "op-crash",
      resourceId: "ws:crash",
      sourceBindingId: "src",
      targetBindingId: "dst",
      expectedContentVersion: "v3",
    });
    storeA.save(base);

    for (const step of forwardPath) {
      const storeBefore = new FileWorkspaceCutoverStore(storePath);
      advanceCutoverOperation({ store: storeBefore, operationId: "op-crash", nextState: step });
      const storeAfterCrash = new FileWorkspaceCutoverStore(storePath);
      const resumed = advanceCutoverOperation({
        store: storeAfterCrash,
        operationId: "op-crash",
        nextState: step,
      });
      expect(resumed.state).toBe(step);
    }

    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("workspace cutover compatibility reads", () => {
  it("records audit counts and rejects expired reads", () => {
    let op = createWorkspaceCutoverOperation({
      operationId: "op-compat",
      resourceId: "ws:r6",
      sourceBindingId: "src",
      targetBindingId: "dst",
      expectedContentVersion: "v1",
    });
    for (const step of [
      "prepared",
      "write_frozen",
      "copied_or_adopted",
      "verified",
      "dual_read_verified",
      "resolver_write_cutover",
      "compatibility_read_only",
    ] as const) {
      op = transitionWorkspaceCutoverOperation({ operation: op, nextState: step });
    }
    op = {
      ...op,
      compatibilityReadDeadlineMs: 1_000,
    };
    op = recordCompatibilityReadAudit({ operation: op, nowMs: 500 });
    expect(op.compatibilityReadAuditCount).toBe(1);
    expect(isCompatibilityReadExpired(op, 1_500)).toBe(true);
    expect(() => recordCompatibilityReadAudit({ operation: op, nowMs: 1_500 })).toThrow(/expired/);
  });
});
