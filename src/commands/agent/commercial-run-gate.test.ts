// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

const tryAcquireEnterpriseAgentRun = vi.fn();
const releaseEnterpriseAgentRun = vi.fn();

vi.mock("../../gateway/billing/agent-run-governance.js", () => ({
  tryAcquireEnterpriseAgentRun,
  releaseEnterpriseAgentRun,
}));

const { acquireAgentCommandCommercialRun, releaseAgentCommandCommercialRun } =
  await import("../../agent-runtime/model/index.js");

describe("agent commercial-run-gate", () => {
  it("denies when enterprise slot unavailable", async () => {
    tryAcquireEnterpriseAgentRun.mockResolvedValue({
      acquired: false,
      skipped: false,
      reason: "SEAT_CONCURRENCY_LIMIT_EXCEEDED",
      message: "席位并发已满",
    });
    const result = await acquireAgentCommandCommercialRun({
      runId: "cli-run-1",
      sessionAgentId: "main",
    });
    expect(result).toEqual({ status: "denied", message: "席位并发已满" });
  });

  it("releases held slot", async () => {
    await releaseAgentCommandCommercialRun("cli-run-2");
    expect(releaseEnterpriseAgentRun).toHaveBeenCalledWith("cli-run-2");
  });

  it("acquired passes modelGate and authorizationDecisionId through unchanged", async () => {
    const modelGate = { tenantId: "tenant-a", allowlist: ["openai/gpt-5"] };
    tryAcquireEnterpriseAgentRun.mockResolvedValue({
      acquired: true,
      skipped: false,
      enterpriseId: "tenant-a",
      authorizationDecisionId: "auth-123",
      modelGate,
    });
    const result = await acquireAgentCommandCommercialRun({
      runId: "cli-run-3",
      sessionAgentId: "main",
    });
    expect(result).toEqual({
      status: "acquired",
      enterpriseId: "tenant-a",
      modelGate,
      authorizationDecisionId: "auth-123",
    });
    expect(result.status === "acquired" && result.modelGate).toBe(modelGate);
  });

  it("acquired without model gate keeps only the resolved enterprise", async () => {
    tryAcquireEnterpriseAgentRun.mockResolvedValue({
      acquired: true,
      skipped: false,
      enterpriseId: "tenant-a",
    });
    const result = await acquireAgentCommandCommercialRun({
      runId: "cli-run-4",
      sessionAgentId: "main",
    });
    expect(result).toEqual({ status: "acquired", enterpriseId: "tenant-a" });
  });

  it("acquired passes locked subscription facts through for credit usage", async () => {
    tryAcquireEnterpriseAgentRun.mockResolvedValue({
      acquired: true,
      skipped: false,
      enterpriseId: "tenant-a",
      authorizationDecisionId: "auth-9",
      subscriptionId: "sub-1",
      subscriptionSnapshotId: "snap-1",
      planId: "plan-1",
      planVersionId: "pv-1",
    });
    const result = await acquireAgentCommandCommercialRun({
      runId: "cli-run-6",
      sessionAgentId: "main",
    });
    expect(result).toMatchObject({
      status: "acquired",
      authorizationDecisionId: "auth-9",
      subscriptionId: "sub-1",
      subscriptionSnapshotId: "snap-1",
      planId: "plan-1",
      planVersionId: "pv-1",
    });
  });

  it("skipped stays skipped", async () => {
    tryAcquireEnterpriseAgentRun.mockResolvedValue({ acquired: false, skipped: true });
    const result = await acquireAgentCommandCommercialRun({
      runId: "cli-run-5",
      sessionAgentId: "main",
    });
    expect(result).toEqual({ status: "skipped" });
  });

  it("subagent entry E6 still acquires quota and concurrency", async () => {
    tryAcquireEnterpriseAgentRun.mockResolvedValue({
      acquired: true,
      skipped: false,
      enterpriseId: "tenant-a",
      authorizationDecisionId: "auth-e6",
    });
    const result = await acquireAgentCommandCommercialRun({
      runId: "subagent-run-1",
      sessionAgentId: "worker",
      enterpriseId: "tenant-a",
      gatewayClientUser: "user-a",
      entry: "E6",
    });
    expect(tryAcquireEnterpriseAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "subagent-run-1",
        agentId: "worker",
        enterpriseId: "tenant-a",
      }),
    );
    expect(result.status).toBe("acquired");
  });
});
