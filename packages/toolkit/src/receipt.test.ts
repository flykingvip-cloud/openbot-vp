import { describe, expect, it } from "vitest";
import { appendEvidence, completeReceipt, failReceipt, startReceipt } from "./receipt.js";
import { assertValidExecutionReceipt } from "./validate.js";

describe("ExecutionReceipt helpers", () => {
  it("starts, completes, and validates a sample receipt", () => {
    const running = startReceipt({
      toolId: "workspace",
      operation: "read",
      idempotencyKey: "sample-1",
      inputDigest: "sha256:input",
    });

    expect(running.status).toBe("running");
    expect(running.receiptId.length).toBeGreaterThan(0);
    assertValidExecutionReceipt(running);

    const withEvidence = appendEvidence(running, {
      kind: "log",
      label: "read-start",
      metadata: { path: "README.md" },
    });

    const done = completeReceipt(withEvidence, {
      outputDigest: "sha256:output",
      evidence: [{ kind: "artifact", label: "file-content", uri: "file://README.md" }],
      sideEffects: [],
    });

    expect(done.status).toBe("succeeded");
    expect(done.completedAt).toBeTruthy();
    expect(done.evidence).toHaveLength(2);
    assertValidExecutionReceipt(done);
  });

  it("fails a running receipt with an error payload", () => {
    const running = startReceipt({
      toolId: "shell",
      operation: "exec",
    });
    const failed = failReceipt(running, {
      error: { code: "TIMEOUT", message: "command exceeded timeout" },
      evidence: [{ kind: "log", label: "timeout" }],
    });

    expect(failed.status).toBe("failed");
    expect(failed.error).toMatchObject({ code: "TIMEOUT", message: "command exceeded timeout" });
    assertValidExecutionReceipt(failed);
  });

  it("rejects complete/fail when not running", () => {
    const done = completeReceipt(startReceipt({ toolId: "web", operation: "search" }), {});
    expect(() => completeReceipt(done, {})).toThrow(/Cannot complete/);
    expect(() => failReceipt(done, { error: { message: "x" } })).toThrow(/Cannot fail/);
  });
});
