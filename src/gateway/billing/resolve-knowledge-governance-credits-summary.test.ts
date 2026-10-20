// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GOVERNANCE_LLM_CREDIT_POLICY_ID } from "../knowledge/governance/usage/governance-llm-usage.js";
import {
  isKnowledgeGovernanceLedgerEntry,
  resolveKnowledgeGovernanceCreditsSummary,
} from "./resolve-knowledge-governance-credits-summary.js";
import { appendUsageLedgerEntry, __resetUsageLedgerForTest } from "./usage-ledger-store.js";

const ledgerPath = "/tmp/openbot-gov-credits-ledger-test.json";

describe("resolve-knowledge-governance-credits-summary", () => {
  beforeEach(async () => {
    await __resetUsageLedgerForTest(ledgerPath);
  });

  afterEach(async () => {
    await __resetUsageLedgerForTest(ledgerPath);
  });

  it("detects governance ledger rows by taskId prefix or policyId", () => {
    expect(
      isKnowledgeGovernanceLedgerEntry({
        taskId: "gov-llm:kb_a:call-1",
        policyId: "balanced",
      }),
    ).toBe(true);
    expect(
      isKnowledgeGovernanceLedgerEntry({
        taskId: "run-123",
        policyId: GOVERNANCE_LLM_CREDIT_POLICY_ID,
      }),
    ).toBe(true);
    expect(
      isKnowledgeGovernanceLedgerEntry({
        taskId: "run-123",
        policyId: "balanced",
      }),
    ).toBe(false);
  });

  it("aggregates governance credits for the active cycle", async () => {
    await appendUsageLedgerEntry(
      {
        enterpriseId: "ent-gov",
        taskId: "gov-llm:kb_a:call-1",
        modelId: "openai/gpt-test",
        tier: "standard",
        policyId: GOVERNANCE_LLM_CREDIT_POLICY_ID,
        creditsCharged: 2,
        providerCostCents: 10,
        tenantRevenueCents: 8,
        inputTokens: 100,
        outputTokens: 20,
        planId: "plan-1",
        planVersionId: "pv-1",
        subscriptionId: "sub-1",
      },
      ledgerPath,
    );
    await appendUsageLedgerEntry(
      {
        enterpriseId: "ent-gov",
        taskId: "gov-llm:kb_b:call-2",
        modelId: "openai/gpt-test",
        tier: "standard",
        policyId: GOVERNANCE_LLM_CREDIT_POLICY_ID,
        creditsCharged: 1,
        providerCostCents: 5,
        tenantRevenueCents: 4,
        inputTokens: 40,
        outputTokens: 10,
        planId: "plan-1",
        planVersionId: "pv-1",
        subscriptionId: "sub-1",
      },
      ledgerPath,
    );
    await appendUsageLedgerEntry(
      {
        enterpriseId: "ent-gov",
        taskId: "agent-run-1",
        modelId: "openai/gpt-test",
        tier: "standard",
        policyId: "balanced",
        creditsCharged: 99,
        providerCostCents: 0,
        tenantRevenueCents: 0,
        planId: "plan-1",
        planVersionId: "pv-1",
        subscriptionId: "sub-1",
      },
      ledgerPath,
    );

    const summary = await resolveKnowledgeGovernanceCreditsSummary(
      "ent-gov",
      new Date(),
      ledgerPath,
    );
    expect(summary.llmCallCount).toBe(2);
    expect(summary.creditsCharged).toBe(3);
    expect(summary.inputTokens).toBe(140);
    expect(summary.outputTokens).toBe(30);
    expect(summary.totalTokens).toBe(170);
    expect(summary.providerCostCents).toBe(15);
    expect(summary.tenantRevenueCents).toBe(12);
  });
});
