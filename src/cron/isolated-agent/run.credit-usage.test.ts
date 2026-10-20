import { beforeEach, describe, expect, it } from "vitest";
import type { RunGovernanceSnapshot } from "../../gateway/governance/decision.js";
import { lookupRunModelSet } from "../../gateway/governance/spawn-snapshot-handoff.js";
import {
  makeIsolatedAgentTurnParams,
  setupRunCronIsolatedAgentTurnSuite,
} from "./run.suite-helpers.js";
import {
  hasNonzeroUsageMock,
  isCliProviderMock,
  loadRunCronIsolatedAgentTurn,
  recordCreditUsageMock,
  resolveEnterpriseRuntimeInvocationMock,
  runEmbeddedPiAgentMock,
  runWithModelFallbackMock,
  tryAcquireEnterpriseAgentRunMock,
} from "./run.test-harness.js";

const runCronIsolatedAgentTurn = await loadRunCronIsolatedAgentTurn();

const ENTERPRISE_SLOT = {
  acquired: true,
  skipped: false,
  modelGate: { creditReporting: { enterpriseId: "ent-1", policyId: "balanced" } },
} as const;

describe("runCronIsolatedAgentTurn — credit usage recording", () => {
  setupRunCronIsolatedAgentTurnSuite();

  beforeEach(() => {
    // 默认：有真实用量（进入记账分支）。
    hasNonzeroUsageMock.mockReturnValue(true);
  });

  it("records Credits/providerCost for enterprise managed-provider runs", async () => {
    tryAcquireEnterpriseAgentRunMock.mockResolvedValue(ENTERPRISE_SLOT);

    const res = await runCronIsolatedAgentTurn(makeIsolatedAgentTurnParams() as never);

    expect(res.status).toBe("ok");
    expect(recordCreditUsageMock).toHaveBeenCalledTimes(1);
    expect(recordCreditUsageMock.mock.calls[0]?.[0]).toMatchObject({
      enterpriseId: "ent-1",
      policyId: "balanced",
      modelId: "openai/gpt-4",
      tokenUsage: { inputTokens: 10, outputTokens: 20 },
    });
  });

  it("skips recording when the run has no enterprise credit reporting", async () => {
    tryAcquireEnterpriseAgentRunMock.mockResolvedValue({ acquired: true, skipped: false });

    await runCronIsolatedAgentTurn(makeIsolatedAgentTurnParams() as never);

    expect(recordCreditUsageMock).not.toHaveBeenCalled();
  });

  it("skips recording for BYO CLI providers (attributed via recordCliBackendUsage)", async () => {
    tryAcquireEnterpriseAgentRunMock.mockResolvedValue(ENTERPRISE_SLOT);
    isCliProviderMock.mockReturnValue(true);

    await runCronIsolatedAgentTurn(makeIsolatedAgentTurnParams() as never);

    expect(recordCreditUsageMock).not.toHaveBeenCalled();
  });

  it("skips recording when the run produced no token usage", async () => {
    tryAcquireEnterpriseAgentRunMock.mockResolvedValue(ENTERPRISE_SLOT);
    hasNonzeroUsageMock.mockReturnValue(false);

    await runCronIsolatedAgentTurn(makeIsolatedAgentTurnParams() as never);

    expect(recordCreditUsageMock).not.toHaveBeenCalled();
  });

  it("remaps ent/ BYOK models and records ledger with enterprise runtime modelId", async () => {
    const byokModel = "abcd1234/gpt-4o";
    tryAcquireEnterpriseAgentRunMock.mockResolvedValue({
      acquired: true,
      skipped: false,
      modelGate: {
        tenantId: "ent-1",
        creditReporting: { enterpriseId: "ent-1", policyId: "balanced" },
      },
    });
    resolveEnterpriseRuntimeInvocationMock.mockResolvedValue({
      runtimeModelId: `ent/${byokModel}`,
      provider: "openai",
      model: "gpt-4o",
      apiKey: "sk-tenant-byok",
      baseUrl: "https://byok.example/v1",
      protocol: "openai",
      billingOwner: "enterprise",
      source: "enterprise",
      tenantId: "ent-1",
    });
    runWithModelFallbackMock.mockImplementation(async ({ run }) => {
      const result = await run("ent", byokModel);
      return {
        provider: "ent",
        model: byokModel,
        result,
        attempts: [{ provider: "ent", model: byokModel }],
      };
    });
    runEmbeddedPiAgentMock.mockResolvedValue({
      payloads: [{ text: "byok ok" }],
      meta: {
        durationMs: 12,
        agentMeta: { usage: { input: 10, output: 20 } },
      },
    });

    const res = await runCronIsolatedAgentTurn(makeIsolatedAgentTurnParams() as never);

    expect(res.status).toBe("ok");
    expect(resolveEnterpriseRuntimeInvocationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "ent-1",
        provider: "ent",
        model: byokModel,
      }),
    );
    expect(runEmbeddedPiAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai",
        model: "gpt-4o",
        enterpriseRuntimeModelId: `ent/${byokModel}`,
        providerAuthOverride: expect.objectContaining({
          apiKey: "sk-tenant-byok",
          source: "enterprise-byok",
          baseUrl: "https://byok.example/v1",
        }),
      }),
    );
    expect(recordCreditUsageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        enterpriseId: "ent-1",
        modelId: `ent/${byokModel}`,
      }),
    );
  });

  describe("parent billing context on the run snapshot (P4-1)", () => {
    // Read the in-process parent snapshot while the run is inside the model call.
    function captureRunSnapshot(): () => RunGovernanceSnapshot | undefined | null {
      let seen: RunGovernanceSnapshot | undefined | null = null;
      const fallback = runWithModelFallbackMock.getMockImplementation();
      runWithModelFallbackMock.mockImplementationOnce(async (params: { runId?: string }) => {
        seen = lookupRunModelSet(params.runId);
        return fallback?.(params);
      });
      return () => seen;
    }

    it("an acquired gate puts enterprise / policy and the gate's subscription ids on it", async () => {
      tryAcquireEnterpriseAgentRunMock.mockResolvedValue({
        acquired: true,
        skipped: false,
        authorizationDecisionId: "auth-cron-1",
        subscriptionId: "sub-1",
        planVersionId: "pv-1",
        modelGate: {
          allowlist: ["openai/gpt-4"],
          creditReporting: { enterpriseId: "ent-1", policyId: "balanced" },
        },
      });
      const seen = captureRunSnapshot();
      await runCronIsolatedAgentTurn(makeIsolatedAgentTurnParams() as never);
      expect(seen()).toMatchObject({
        commercialAuthorizationId: "auth-cron-1",
        creditReporting: {
          enterpriseId: "ent-1",
          policyId: "balanced",
          subscriptionId: "sub-1",
          planVersionId: "pv-1",
        },
      });
      expect(seen()?.creditReporting).not.toHaveProperty("planId");
    });

    it("an acquired gate without creditReporting stores no billing context", async () => {
      tryAcquireEnterpriseAgentRunMock.mockResolvedValue({
        acquired: true,
        skipped: false,
        authorizationDecisionId: "auth-cron-2",
        subscriptionId: "sub-1",
        modelGate: { allowlist: ["openai/gpt-4"] },
      });
      const seen = captureRunSnapshot();
      await runCronIsolatedAgentTurn(makeIsolatedAgentTurnParams() as never);
      expect(seen()).toMatchObject({ commercialAuthorizationId: "auth-cron-2" });
      expect(seen()).not.toHaveProperty("creditReporting");
    });

    it("a skipped gate stores no snapshot", async () => {
      tryAcquireEnterpriseAgentRunMock.mockResolvedValue({ skipped: true });
      const seen = captureRunSnapshot();
      await runCronIsolatedAgentTurn(makeIsolatedAgentTurnParams() as never);
      expect(seen()).toBeUndefined();
    });
  });
});
