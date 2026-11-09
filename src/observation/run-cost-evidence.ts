/** Server-owned cost projection only: never charges, reprices, or apportions session usage. */
import { z } from "zod";
import type { TrustedScope } from "../task-outcome/types.js";
import type { OutcomeRecordMetadata } from "./outcome-reader.js";
import { OUTCOME_METADATA_SCHEMA_VERSION, outcomeMetadataFingerprint } from "./outcome-source.js";
const ref = z.string().trim().min(1).max(512);
const version = z.number().int().positive();
const money = z.number().finite().nonnegative().nullable();
const token = z.number().int().nonnegative().nullable();
const scopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("personal"),
    personalDomainId: ref,
    subjectRef: ref,
    authzScopeRef: ref,
  }),
  z.strictObject({
    kind: z.literal("enterprise"),
    enterpriseDomainId: ref,
    tenantId: ref,
    subjectRef: ref,
    authzScopeRef: ref,
  }),
]);
export const runCostEvidenceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  evidenceId: ref,
  sourceId: ref,
  collector: z.enum(["model_call_usage", "billing_receipt", "budget_command_association"]),
  provenance: z.enum(["live", "seed", "injected", "unknown"]),
  agentId: ref,
  scope: scopeSchema,
  taskId: ref,
  budgetOutcomeVersion: version,
  runId: ref,
  callSeq: version,
  occurredAt: z.number().finite().nullable(),
  observedAt: z.number().finite().optional(),
  tokens: z.strictObject({ input: token, output: token, cacheRead: token, cacheWrite: token }),
  estimatedUsd: z.strictObject({
    amount: money,
    costEvidence: z.enum(["known", "unknown", "not_applicable"]),
    pricingRef: ref.nullable(),
  }),
  procurementCents: z.strictObject({ amount: money, ledgerRef: ref.nullable() }),
  credits: z.strictObject({ amount: money, ledgerRef: ref.nullable() }),
});
export type RunCostEvidence = z.infer<typeof runCostEvidenceSchema>;
export const runCostLinkSchema = z.strictObject({
  schemaVersion: z.literal(1),
  agentId: ref,
  scope: scopeSchema,
  taskId: ref,
  finalOutcomeVersion: version,
  outcomeMetadataSchemaVersion: version,
  finalOutcomeFingerprint: ref,
  runId: ref,
  attemptId: ref,
  attemptGranularity: z.literal("turn"),
  callRefs: z
    .array(z.strictObject({ evidenceId: ref, budgetOutcomeVersion: version }))
    .min(1)
    .max(1000),
  completeCallSet: z.boolean(),
  expectedCallCount: z.number().int().positive().nullable(),
});
export type RunCostLink = z.infer<typeof runCostLinkSchema>;
function scopeKey(s: TrustedScope): string {
  return JSON.stringify(
    s.kind === "enterprise"
      ? [s.kind, s.enterpriseDomainId, s.tenantId, s.subjectRef, s.authzScopeRef]
      : [s.kind, s.personalDomainId, s.subjectRef, s.authzScopeRef],
  );
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return JSON.stringify(value.map(canonical));
  }
  if (value !== null && typeof value === "object") {
    return JSON.stringify(
      Object.entries(value)
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return JSON.stringify(value);
}
/** Trusted adapters supply independent call facts and an explicit final-version link. */
export function projectRunCostEvidence(input: {
  agentId: string;
  scope: TrustedScope;
  record: OutcomeRecordMetadata;
  projectedAt: number;
  evidence: readonly unknown[];
  link: unknown;
}) {
  const reasons = new Set<string>();
  const calls: RunCostEvidence[] = [];
  let complete = false;
  let structurallyLinked = false;
  let budgetAssociationCount = 0;
  const finish = () => {
    const amount = (values: readonly (number | null)[]) => {
      const known = values.filter((v): v is number => v !== null);
      const subtotal = known.length ? known.reduce((a, b) => a + b, 0) : null;
      const finite = subtotal !== null && Number.isFinite(subtotal);
      return {
        state: finite
          ? complete && known.length === calls.length
            ? ("complete" as const)
            : ("partial" as const)
          : ("unknown" as const),
        subtotal: finite ? subtotal : null,
        total: finite && complete && known.length === calls.length ? subtotal : null,
        measuredCalls: known.length,
      };
    };
    const provenance = [...new Set(calls.map((c) => c.provenance))].toSorted();
    return {
      schemaVersion: 1 as const,
      attribution: structurallyLinked ? ("linked" as const) : ("unknown" as const),
      completeness: complete
        ? ("complete_declared_call_set" as const)
        : calls.length || budgetAssociationCount
          ? ("partial" as const)
          : ("unknown" as const),
      projectedAt: input.projectedAt,
      observedCallCount: calls.length,
      budgetAssociationCount,
      provenance,
      nonProduction: provenance.some((p) => p === "seed" || p === "injected"),
      productionValidated: false as const,
      estimatedUsd: {
        unit: "USD_estimate" as const,
        ...amount(
          calls.map((c) =>
            c.estimatedUsd.costEvidence === "known" && c.estimatedUsd.pricingRef
              ? c.estimatedUsd.amount
              : null,
          ),
        ),
      },
      procurement: {
        unit: "provider_cost_cents" as const,
        ...amount(
          calls.map((c) => (c.procurementCents.ledgerRef ? c.procurementCents.amount : null)),
        ),
      },
      credits: {
        unit: "credits" as const,
        ...amount(calls.map((c) => (c.credits.ledgerRef ? c.credits.amount : null))),
      },
      tokens: {
        input: amount(calls.map((c) => c.tokens.input)),
        output: amount(calls.map((c) => c.tokens.output)),
        cacheRead: amount(calls.map((c) => c.tokens.cacheRead)),
        cacheWrite: amount(calls.map((c) => c.tokens.cacheWrite)),
      },
      reasons: [...reasons].toSorted(),
      interpretation: "Attributed observations only; partial subtotals are not total run cost.",
    };
  };
  if (!Number.isFinite(input.projectedAt) || input.evidence.length > 1000) {
    reasons.add("invalid_or_unbounded_input");
    return finish();
  }
  const parsed = runCostLinkSchema.safeParse(input.link);
  if (!parsed.success) {
    reasons.add("final_version_link_unavailable");
    return finish();
  }
  const link = parsed.data;
  const r = input.record;
  if (
    link.agentId !== input.agentId ||
    link.taskId !== r.taskId ||
    link.finalOutcomeVersion !== r.outcomeVersion ||
    scopeKey(link.scope) !== scopeKey(input.scope) ||
    scopeKey(r.scope) !== scopeKey(input.scope) ||
    link.outcomeMetadataSchemaVersion !== OUTCOME_METADATA_SCHEMA_VERSION ||
    link.finalOutcomeFingerprint !== outcomeMetadataFingerprint(r)
  ) {
    reasons.add("final_version_or_scope_mismatch");
    return finish();
  }
  const run = r.runs.find((x) => x.runId === link.runId);
  const attempt = r.attempts.find((x) => x.attemptId === link.attemptId && x.runId === link.runId);
  if (
    !attempt ||
    !run?.attemptIds.includes(link.attemptId) ||
    run.effectiveAttemptId !== link.attemptId
  ) {
    reasons.add("run_attempt_mismatch");
    return finish();
  }
  if (new Set(link.callRefs.map((x) => x.evidenceId)).size !== link.callRefs.length) {
    reasons.add("duplicate_link_reference");
    return finish();
  }
  structurallyLinked = true;
  const byId = new Map<string, RunCostEvidence>();
  const conflicts = new Set<string>();
  for (const raw of input.evidence) {
    const fact = runCostEvidenceSchema.safeParse(raw);
    if (!fact.success) {
      reasons.add("invalid_call_evidence");
      continue;
    }
    const prior = byId.get(fact.data.evidenceId);
    if (prior && canonical(prior) !== canonical(fact.data)) {
      conflicts.add(fact.data.evidenceId);
    } else {
      byId.set(fact.data.evidenceId, fact.data);
    }
  }
  const byCall = new Map<number, RunCostEvidence>();
  const callConflicts = new Set<number>();
  for (const reference of link.callRefs) {
    const fact = byId.get(reference.evidenceId);
    if (!fact || conflicts.has(reference.evidenceId)) {
      reasons.add("missing_or_conflicting_call_evidence");
      continue;
    }
    if (
      fact.agentId !== input.agentId ||
      scopeKey(fact.scope) !== scopeKey(input.scope) ||
      fact.taskId !== r.taskId ||
      fact.runId !== link.runId ||
      fact.budgetOutcomeVersion !== reference.budgetOutcomeVersion ||
      fact.budgetOutcomeVersion > link.finalOutcomeVersion ||
      (fact.occurredAt !== null && fact.occurredAt > input.projectedAt) ||
      (fact.observedAt !== undefined && fact.observedAt > input.projectedAt)
    ) {
      reasons.add("call_attribution_mismatch");
      continue;
    }
    if (fact.collector === "budget_command_association") {
      budgetAssociationCount++;
      reasons.add("budget_association_not_usage");
      continue;
    }
    if (fact.occurredAt === null) {
      reasons.add("usage_occurrence_unknown");
      continue;
    }
    const prior = byCall.get(fact.callSeq);
    if (prior) {
      const same = (c: RunCostEvidence) => canonical({ ...c, evidenceId: null });
      if (same(prior) !== same(fact)) {
        callConflicts.add(fact.callSeq);
        reasons.add("call_identity_conflict");
      }
    } else {
      byCall.set(fact.callSeq, fact);
    }
  }
  for (const [seq, fact] of [...byCall].toSorted(([a], [b]) => a - b)) {
    if (!callConflicts.has(seq)) {
      calls.push(fact);
    }
  }
  if (
    calls.some((c) => c.provenance === "unknown") ||
    new Set(calls.map((c) => c.provenance)).size > 1
  ) {
    reasons.add("provenance_incomplete_or_mixed");
  }
  if (
    !link.completeCallSet ||
    link.expectedCallCount === null ||
    link.expectedCallCount !== calls.length
  ) {
    reasons.add("complete_call_set_unproven");
  }
  if (
    calls.some(
      (c) =>
        c.estimatedUsd.amount !== null &&
        (c.estimatedUsd.costEvidence !== "known" || !c.estimatedUsd.pricingRef),
    )
  ) {
    reasons.add("estimate_pricing_unproven");
  }
  complete = calls.length > 0 && reasons.size === 0;
  return finish();
}
