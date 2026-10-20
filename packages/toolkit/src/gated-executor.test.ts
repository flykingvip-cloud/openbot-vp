import { describe, expect, it, vi } from "vitest";
import { createMockApprovalChannel } from "./approval.js";
import type { ToolAdapter, ToolRequest } from "./contracts.js";
import { executeGated } from "./gated-executor.js";
import { loadExamplePolicy } from "./policy.js";
import { assertValidExecutionReceipt } from "./validate.js";

function makeAdapter(
  overrides: Partial<ToolAdapter> & Pick<ToolAdapter, "id" | "risk" | "sideEffects">,
): ToolAdapter {
  return {
    operations: ["exec", "read", "write", "search"],
    execute: async () => ({
      status: "succeeded",
      output: { ok: true },
      evidence: [{ kind: "log", label: "done" }],
      sideEffects: overrides.sideEffects ? ["mutated"] : [],
    }),
    ...overrides,
  };
}

function request(toolId: string, operation: string, input: unknown = {}): ToolRequest {
  return {
    toolId,
    operation,
    input,
    context: { taskId: "task-1", actorId: "actor-1", idempotencyKey: "idem-1" },
  };
}

describe("executeGated Policy → Approval → Receipt", () => {
  const policy = loadExamplePolicy();

  it("allow: executes and writes succeeded receipt", async () => {
    const receipts: unknown[] = [];
    const adapter = makeAdapter({ id: "web", risk: "low", sideEffects: false });
    const gated = await executeGated({
      adapter,
      request: request("web", "search", { q: "openbot" }),
      policy,
      onReceipt: (r) => receipts.push(r),
    });

    expect(gated.evaluation.decision).toBe("allow");
    expect(gated.result.status).toBe("succeeded");
    expect(gated.receipt.status).toBe("succeeded");
    assertValidExecutionReceipt(gated.receipt);
    expect(receipts).toHaveLength(1);
  });

  it("allow-with-receipt: workspace write records side effects", async () => {
    const adapter = makeAdapter({ id: "workspace", risk: "medium", sideEffects: true });
    const gated = await executeGated({
      adapter,
      request: request("workspace", "write", { path: "a.txt" }),
      policy,
      facts: { withinWorkspace: true },
    });

    expect(gated.evaluation.decision).toBe("allow-with-receipt");
    expect(gated.result.status).toBe("succeeded");
    expect(gated.receipt.sideEffects).toContain("mutated");
    assertValidExecutionReceipt(gated.receipt);
  });

  it("require-approval: approved path executes with approvalId on receipt", async () => {
    const approval = createMockApprovalChannel({ outcome: "approved" });
    const adapter = makeAdapter({ id: "shell", risk: "high", sideEffects: true });
    const gated = await executeGated({
      adapter,
      request: request("shell", "exec", { cmd: "echo hi" }),
      policy,
      approval,
    });

    expect(gated.evaluation.decision).toBe("require-approval");
    expect(gated.result.status).toBe("succeeded");
    expect(gated.receipt.approvalId).toBeTruthy();
    assertValidExecutionReceipt(gated.receipt);
  });

  it("require-approval: denied by approval channel writes denied receipt", async () => {
    const approval = createMockApprovalChannel({
      outcome: "denied",
      reason: "user rejected",
    });
    const execute = vi.fn();
    const adapter = makeAdapter({
      id: "shell",
      risk: "high",
      sideEffects: true,
      execute,
    });
    const gated = await executeGated({
      adapter,
      request: request("shell", "exec", { cmd: "rm -rf /" }),
      policy,
      approval,
    });

    expect(gated.evaluation.decision).toBe("require-approval");
    expect(gated.result.status).toBe("denied");
    expect(gated.receipt.status).toBe("denied");
    expect(execute).not.toHaveBeenCalled();
    assertValidExecutionReceipt(gated.receipt);
  });

  it("require-approval: missing approval channel denies without executing", async () => {
    const execute = vi.fn();
    const adapter = makeAdapter({
      id: "shell",
      risk: "high",
      sideEffects: true,
      execute,
    });
    const gated = await executeGated({
      adapter,
      request: request("shell", "exec", { cmd: "echo" }),
      policy,
    });

    expect(gated.result.status).toBe("denied");
    expect(gated.result.error?.code).toBe("APPROVAL_REQUIRED");
    expect(gated.receipt.status).toBe("denied");
    expect(execute).not.toHaveBeenCalled();
    assertValidExecutionReceipt(gated.receipt);
  });

  it("deny: policy default writes denied receipt and skips adapter", async () => {
    const execute = vi.fn();
    const adapter = makeAdapter({
      id: "visualization",
      risk: "medium",
      sideEffects: true,
      execute,
    });
    const gated = await executeGated({
      adapter,
      request: request("visualization", "render"),
      policy,
    });

    expect(gated.evaluation.decision).toBe("deny");
    expect(gated.result.status).toBe("denied");
    expect(gated.receipt.status).toBe("denied");
    expect(execute).not.toHaveBeenCalled();
    assertValidExecutionReceipt(gated.receipt);
  });

  it("records failed receipt when adapter throws", async () => {
    const adapter = makeAdapter({
      id: "web",
      risk: "low",
      sideEffects: false,
      execute: async () => {
        throw new Error("network down");
      },
    });
    const gated = await executeGated({
      adapter,
      request: request("web", "search"),
      policy,
    });

    expect(gated.result.status).toBe("failed");
    expect(gated.receipt.status).toBe("failed");
    expect(gated.receipt.error).toMatchObject({ message: "network down" });
    assertValidExecutionReceipt(gated.receipt);
  });
});
