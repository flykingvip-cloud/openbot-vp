import { GOVERNANCE_LLM_CREDIT_POLICY_ID } from "../knowledge/governance/usage/governance-llm-usage.js";
import { resolveCycleWindow } from "./runtime.js";
import { listUsageLedgerEntries } from "./usage-ledger-store.js";

export type KnowledgeGovernanceCreditsSummary = {
  cycleStart: string;
  cycleEnd: string;
  llmCallCount: number;
  creditsCharged: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  providerCostCents: number;
  tenantRevenueCents: number;
};

const GOVERNANCE_TASK_ID_PREFIX = "gov-llm:";

export function isKnowledgeGovernanceLedgerEntry(entry: {
  taskId: string;
  policyId: string;
}): boolean {
  const taskId = entry.taskId.trim();
  return (
    taskId.startsWith(GOVERNANCE_TASK_ID_PREFIX) ||
    entry.policyId.trim() === GOVERNANCE_LLM_CREDIT_POLICY_ID
  );
}

/** Aggregate knowledge-governance LLM credits from Usage Ledger for the current billing cycle. */
export async function resolveKnowledgeGovernanceCreditsSummary(
  enterpriseId: string,
  now: Date = new Date(),
  ledgerStorePath?: string,
): Promise<KnowledgeGovernanceCreditsSummary> {
  const { cycleStart, cycleEnd } = resolveCycleWindow(now);
  const entries = await listUsageLedgerEntries(
    enterpriseId,
    {
      startTime: cycleStart,
      endTime: cycleEnd,
    },
    ledgerStorePath,
  );
  const governanceEntries = entries.filter(isKnowledgeGovernanceLedgerEntry);

  let creditsCharged = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let providerCostCents = 0;
  let tenantRevenueCents = 0;
  for (const entry of governanceEntries) {
    creditsCharged += entry.creditsCharged;
    inputTokens += entry.inputTokens ?? 0;
    outputTokens += entry.outputTokens ?? 0;
    providerCostCents += entry.providerCostCents;
    tenantRevenueCents += entry.tenantRevenueCents;
  }

  return {
    cycleStart,
    cycleEnd,
    llmCallCount: governanceEntries.length,
    creditsCharged,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    providerCostCents,
    tenantRevenueCents,
  };
}
