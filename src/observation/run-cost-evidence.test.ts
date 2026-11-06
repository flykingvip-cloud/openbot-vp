import { describe, expect, it } from "vitest";
import type { OutcomeRecordMetadata } from "./outcome-reader.js";
import { OUTCOME_METADATA_SCHEMA_VERSION, outcomeMetadataFingerprint } from "./outcome-source.js";
import {
  projectRunCostEvidence,
  type RunCostEvidence,
  type RunCostLink,
} from "./run-cost-evidence.js";
const scope = {
  kind: "personal",
  personalDomainId: "domain",
  subjectRef: "subject:a",
  authzScopeRef: "auth",
} as const;
const record: OutcomeRecordMetadata = {
  scope,
  taskId: "task",
  outcomeVersion: 5,
  decidedAt: "2026-11-06T00:00:00Z",
  taskJudgement: "incomplete",
  lifecycle: "active",
  acceptance: { status: "pending" },
  delivery: { status: "pending" },
  runs: [
    { runId: "run", attemptIds: ["attempt"], effectiveAttemptId: "attempt", status: "succeeded" },
  ],
  attempts: [
    { attemptId: "attempt", runId: "run", status: "succeeded", observedAt: "2026-11-06T00:00:00Z" },
  ],
};
const fact = (): RunCostEvidence => ({
  schemaVersion: 1,
  evidenceId: "call-1",
  sourceId: "runner",
  collector: "model_call_usage",
  provenance: "injected",
  agentId: "bot",
  scope,
  taskId: "task",
  budgetOutcomeVersion: 3,
  runId: "run",
  callSeq: 1,
  occurredAt: 100,
  tokens: { input: 10, output: 5, cacheRead: null, cacheWrite: null },
  estimatedUsd: { amount: 0.02, costEvidence: "known", pricingRef: "price-v1" },
  procurementCents: { amount: null, ledgerRef: null },
  credits: { amount: null, ledgerRef: null },
});
const link = (): RunCostLink => ({
  schemaVersion: 1,
  agentId: "bot",
  scope,
  taskId: "task",
  finalOutcomeVersion: 5,
  outcomeMetadataSchemaVersion: OUTCOME_METADATA_SCHEMA_VERSION,
  finalOutcomeFingerprint: outcomeMetadataFingerprint(record),
  runId: "run",
  attemptId: "attempt",
  attemptGranularity: "turn",
  callRefs: [{ evidenceId: "call-1", budgetOutcomeVersion: 3 }],
  completeCallSet: false,
  expectedCallCount: null,
});
const project = (evidence: readonly unknown[] = [fact()], binding: unknown = link()) =>
  projectRunCostEvidence({
    agentId: "bot",
    scope,
    record,
    evidence,
    link: binding,
    projectedAt: 200,
  });
describe("exact run cost evidence projection", () => {
  it("keeps procurement and credits independent and excludes conflicting call sequence evidence", () => {
    const priced = {
      ...fact(),
      procurementCents: { amount: 3, ledgerRef: "procurement-ledger" },
      credits: { amount: 7, ledgerRef: "credit-ledger" },
    };
    const result = project([priced]);
    expect(result.estimatedUsd.subtotal).toBe(0.02);
    expect(result.procurement.subtotal).toBe(3);
    expect(result.credits.subtotal).toBe(7);
    const conflict = {
      ...priced,
      evidenceId: "duplicate-call",
      estimatedUsd: { ...priced.estimatedUsd, amount: 5 },
    };
    const binding = {
      ...link(),
      callRefs: [...link().callRefs, { evidenceId: "duplicate-call", budgetOutcomeVersion: 3 }],
    };
    expect(project([priced, conflict], binding).estimatedUsd.subtotal).toBeNull();
    expect(project([priced, conflict], binding).reasons).toContain("call_identity_conflict");
  });
  it("separates budget and final versions, currencies and partial subtotals", () => {
    const result = project();
    expect(result.attribution).toBe("linked");
    expect(result.estimatedUsd.subtotal).toBe(0.02);
    expect(result.estimatedUsd.total).toBeNull();
    expect(result.procurement.subtotal).toBeNull();
    expect(result.credits.subtotal).toBeNull();
    expect(result.tokens.cacheRead.subtotal).toBeNull();
    expect(result.nonProduction).toBe(true);
    expect(result.productionValidated).toBe(false);
  });
  it("requires explicit complete call-set proof before displaying a total", () => {
    const result = project([fact()], { ...link(), completeCallSet: true, expectedCallCount: 1 });
    expect(result.estimatedUsd.total).toBe(0.02);
    expect(result.procurement.total).toBeNull();
    expect(
      project([fact()], { ...link(), completeCallSet: true, expectedCallCount: 2 }).estimatedUsd
        .total,
    ).toBeNull();
  });
  it("deduplicates identical facts and excludes conflicting identities", () => {
    expect(project([fact(), fact()]).estimatedUsd.subtotal).toBe(0.02);
    const conflict = { ...fact(), estimatedUsd: { ...fact().estimatedUsd, amount: 2 } };
    expect(project([fact(), conflict]).estimatedUsd.subtotal).toBeNull();
  });
  it("does not double-count retry facts with different evidence ids for the same call", () => {
    const second = { ...fact(), evidenceId: "retry" };
    const binding = {
      ...link(),
      callRefs: [...link().callRefs, { evidenceId: "retry", budgetOutcomeVersion: 3 }],
    };
    expect(project([fact(), second], binding).observedCallCount).toBe(1);
    expect(project([fact(), { ...second, callSeq: 2 }], binding).estimatedUsd.subtotal).toBe(0.04);
  });
  it("keeps unpriced usage unknown and preserves an explicitly priced zero", () => {
    expect(
      project([
        { ...fact(), estimatedUsd: { amount: null, costEvidence: "unknown", pricingRef: null } },
      ]).estimatedUsd.subtotal,
    ).toBeNull();
    expect(
      project([
        {
          ...fact(),
          estimatedUsd: { amount: 0, costEvidence: "known", pricingRef: "zero-price-v1" },
        },
      ]).estimatedUsd.subtotal,
    ).toBe(0);
    expect(
      project([
        { ...fact(), estimatedUsd: { amount: 0, costEvidence: "unknown", pricingRef: null } },
      ]).estimatedUsd.subtotal,
    ).toBeNull();
  });
  it("rejects missing, cross-agent, cross-scope and changed-version associations", () => {
    expect(project([fact()], null).attribution).toBe("unknown");
    for (const patch of [
      { agentId: "other" },
      { scope: { ...scope, subjectRef: "other" } },
      { finalOutcomeVersion: 6 },
      { finalOutcomeFingerprint: "changed" },
      { attemptId: "other" },
    ]) {
      expect(project([fact()], { ...link(), ...patch }).estimatedUsd.subtotal).toBeNull();
    }
    expect(project([{ ...fact(), budgetOutcomeVersion: 4 }]).estimatedUsd.subtotal).toBeNull();
  });
  it("does not accept session aggregates, malformed costs or future usage", () => {
    for (const invalid of [
      { ...fact(), sessionCostUsd: 10 },
      { ...fact(), estimatedUsd: { ...fact().estimatedUsd, amount: NaN } },
      { ...fact(), occurredAt: 300 },
    ]) {
      expect(project([invalid]).estimatedUsd.subtotal).toBeNull();
    }
  });
  it("keeps missing retry evidence partial even with a declared complete call set", () => {
    const result = project([fact()], {
      ...link(),
      completeCallSet: true,
      expectedCallCount: 2,
      callRefs: [...link().callRefs, { evidenceId: "failed-retry", budgetOutcomeVersion: 2 }],
    });
    expect(result.estimatedUsd.subtotal).toBe(0.02);
    expect(result.estimatedUsd.total).toBeNull();
    expect(result.reasons).toContain("missing_or_conflicting_call_evidence");
  });
});
