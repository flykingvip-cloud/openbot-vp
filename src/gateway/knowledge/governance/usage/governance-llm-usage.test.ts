// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractGovernanceLlmTokenUsage,
  GOVERNANCE_LLM_CREDIT_POLICY_ID,
  GOVERNANCE_LLM_METER_KEYS,
  reportGovernanceLlmUsage,
} from "./governance-llm-usage.js";
import { parseKnowledgeIndexDbScope } from "./knowledge-index-scope.js";

const recordUsageMock = vi.fn();
const publishMock = vi.fn();
const recordCreditUsageMock = vi.fn();

vi.mock("../../../billing/usage-records-store.js", () => ({
  recordUsage: (...args: unknown[]) => recordUsageMock(...args),
}));

vi.mock("../../../billing/event-bus.js", () => ({
  billingEventBus: {
    publish: (...args: unknown[]) => publishMock(...args),
  },
}));

vi.mock("../../../billing/record-credit-usage.js", () => ({
  recordCreditUsage: (...args: unknown[]) => recordCreditUsageMock(...args),
}));

describe("knowledge-index-scope", () => {
  it("parses tenant and personal index paths", () => {
    expect(parseKnowledgeIndexDbScope("/data/knowledge/index/tenant/acme-corp.db")).toEqual({
      enterpriseId: "acme-corp",
      userId: null,
    });
    expect(parseKnowledgeIndexDbScope("/data/knowledge/index/personal/user-42.db")).toEqual({
      enterpriseId: null,
      userId: "user-42",
    });
  });
});

describe("extractGovernanceLlmTokenUsage", () => {
  it("sums input and output tokens", () => {
    expect(
      extractGovernanceLlmTokenUsage({
        input: 120,
        output: 30,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 150,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      }),
    ).toEqual({ inputTokens: 120, outputTokens: 30, totalTokens: 150 });
  });
});

describe("reportGovernanceLlmUsage", () => {
  beforeEach(() => {
    recordUsageMock.mockReset();
    publishMock.mockReset();
    recordCreditUsageMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("skips enterprise billing for personal-scope indexes", async () => {
    const result = await reportGovernanceLlmUsage({
      kbId: "kb_personal",
      enterpriseId: null,
      userId: "user-1",
      modelId: "gpt-test",
      provider: "openai",
      callId: "call-1",
      inputTokens: 10,
      outputTokens: 5,
    });
    expect(result.reported).toBe(false);
    expect(result.skippedReason).toBe("personal_scope");
    expect(recordUsageMock).not.toHaveBeenCalled();
    expect(recordCreditUsageMock).not.toHaveBeenCalled();
  });

  it("records credits, meters, and publishes UsageReportedEvent for enterprise scope", async () => {
    recordCreditUsageMock.mockResolvedValue({
      recorded: true,
      deduped: false,
      creditsCharged: 3,
      tier: "standard",
      providerCostCents: 12,
      tenantRevenueCents: 8,
      skippedConsumption: false,
    });
    recordUsageMock
      .mockResolvedValueOnce({
        recorded: true,
        deduped: false,
        record: {
          eventId: "gov-llm:call:kb_acme:call-2",
          occurredAt: "2026-06-25T00:00:00.000Z",
        },
      })
      .mockResolvedValueOnce({
        recorded: true,
        deduped: false,
        record: {
          eventId: "gov-llm:tokens:kb_acme:call-2",
          occurredAt: "2026-06-25T00:00:00.000Z",
        },
      });

    const result = await reportGovernanceLlmUsage({
      kbId: "kb_acme",
      enterpriseId: "acme",
      userId: null,
      modelId: "gpt-test",
      provider: "openai",
      callId: "call-2",
      jobId: "job-9",
      inputTokens: 100,
      outputTokens: 20,
    });

    expect(result.reported).toBe(true);
    expect(result.creditsCharged).toBe(3);
    expect(result.creditRecorded).toBe(true);
    expect(recordCreditUsageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        enterpriseId: "acme",
        taskId: "gov-llm:kb_acme:call-2",
        modelId: "openai/gpt-test",
        policyId: GOVERNANCE_LLM_CREDIT_POLICY_ID,
        agentId: "knowledge-governance",
        runId: "job-9",
        tokenUsage: { inputTokens: 100, outputTokens: 20 },
      }),
    );
    expect(recordUsageMock).toHaveBeenCalledTimes(2);
    expect(recordUsageMock.mock.calls[0]?.[0]).toMatchObject({
      enterpriseId: "acme",
      key: GOVERNANCE_LLM_METER_KEYS.calls,
      quantity: 1,
    });
    expect(recordUsageMock.mock.calls[1]?.[0]).toMatchObject({
      key: GOVERNANCE_LLM_METER_KEYS.tokens,
      quantity: 120,
    });
    expect(publishMock).toHaveBeenCalledTimes(2);
    expect(publishMock.mock.calls[0]?.[0]).toMatchObject({
      type: "usage.reported",
      enterpriseId: "acme",
      key: GOVERNANCE_LLM_METER_KEYS.calls,
    });
  });
});
