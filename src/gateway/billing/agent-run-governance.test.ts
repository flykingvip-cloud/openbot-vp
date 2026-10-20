// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authorizeCommercialRun = vi.fn();

vi.mock("./authorize-commercial-run.js", () => ({
  authorizeCommercialRun,
  releaseCommercialRunSlot: vi.fn(),
}));

const resolveAgentRunEntitlementScope = vi.fn();

vi.mock("../model-entitlement/resolve-agent-run-scope.js", () => ({
  resolveAgentRunEntitlementScope,
}));

const { tryAcquireEnterpriseAgentRun, releaseEnterpriseAgentRun, resolveEnterpriseIdForAgentRun } =
  await import("./agent-run-governance.js");

describe("agent-run-governance", () => {
  beforeEach(() => {
    authorizeCommercialRun.mockReset();
    resolveAgentRunEntitlementScope.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("fail-open when authorizeCommercialRun skips (Property 3)", async () => {
    authorizeCommercialRun.mockResolvedValue({ allowed: false, skipped: true });
    const result = await tryAcquireEnterpriseAgentRun({ runId: "r-open", agentId: "agent-x" });
    expect(result).toEqual({ acquired: false, skipped: true });
  });

  it("acquires slot when authorizeCommercialRun allows", async () => {
    authorizeCommercialRun.mockResolvedValue({
      allowed: true,
      skipped: false,
      authorizationDecisionId: "auth-1",
      subscriptionSnapshotId: "srs-1",
      enterpriseId: "ent-1",
      subscriptionId: "sub-1",
      policyDecision: { allowed: true },
      creditDecision: { allowed: true, creditsRemaining: 100, billingMode: "credits" },
      concurrencyDecision: { allowed: true, activeCount: 0, limit: 2, mode: "block" },
      slotAcquired: true,
    });
    const result = await tryAcquireEnterpriseAgentRun({
      runId: "r-ok",
      enterpriseId: "ent-1",
      agentId: "agent-a",
    });
    expect(result).toEqual({
      acquired: true,
      enterpriseId: "ent-1",
      skipped: false,
      authorizationDecisionId: "auth-1",
      subscriptionSnapshotId: "srs-1",
      subscriptionId: "sub-1",
    });
  });

  it("rejects when authorizeCommercialRun denies concurrency", async () => {
    authorizeCommercialRun.mockResolvedValue({
      allowed: false,
      skipped: false,
      authorizationDecisionId: "auth-2",
      enterpriseId: "ent-1",
      reason: "CONCURRENCY_LIMIT_EXCEEDED",
      message: "并发 AI 任务已达上限",
      policyDecision: { allowed: true },
    });
    const blocked = await tryAcquireEnterpriseAgentRun({ runId: "r-block", enterpriseId: "ent-1" });
    expect(blocked.acquired).toBe(false);
    if (!blocked.acquired && !blocked.skipped) {
      expect(blocked.reason).toBe("CONCURRENCY_LIMIT_EXCEEDED");
    }
  });

  it("resolveEnterpriseIdForAgentRun uses explicit enterpriseId", async () => {
    const id = await resolveEnterpriseIdForAgentRun({
      enterpriseId: "ent-direct",
      agentId: "agent-1",
    });
    expect(id).toBe("ent-direct");
    expect(resolveAgentRunEntitlementScope).not.toHaveBeenCalled();
  });

  it("releaseEnterpriseAgentRun delegates to releaseCommercialRunSlot", async () => {
    const { releaseCommercialRunSlot } = await import("./authorize-commercial-run.js");
    await releaseEnterpriseAgentRun("r-rel");
    expect(releaseCommercialRunSlot).toHaveBeenCalledWith("r-rel");
  });
});
