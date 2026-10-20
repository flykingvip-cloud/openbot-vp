import { describe, expect, it } from "vitest";
import {
  createMemoryCompletionLedger,
  decideEvolutionCompletionFromLedger,
  type CompletionLedgerRecord,
} from "./completion-ledger.js";
import type { DiagnosisRecheckResult } from "./diagnosis-recheck.js";
import type {
  EvolutionCompletionEvidence,
  EvolutionCompletionPromotionEvent,
} from "./evolution-completion.js";

const TENANT = "001";
const TARGET = { domain: "agent" as const, agentId: "a8-m1-isolated" };
const SURFACE = "agent.working-dna";
const CANDIDATE = "c5fda4dba439f8c00084c650da491f0c450c7976a9c16a0644d90e1e2aceb255";
const CANDIDATE_REF = "cand:diag:c5fda4dba439f8c00084c650da491f0c";
const PROPOSAL = "evo:diag:1";
const EXPERIMENT = "exp:1";
const APPLICATION = "app:1";
const VERIFICATION = "ver:1";
const VERIFIED_AT = "2026-09-22T09:00:00.000Z";
const RECHECK_AT = "2026-09-22T09:30:00.000Z";
const PROMOTED_AT = "2026-09-22T10:00:00.000Z";

function recheck(patch: Partial<DiagnosisRecheckResult> = {}): DiagnosisRecheckResult {
  return {
    outcome: "RESOLVED",
    reasonCode: "sot_confirmed",
    findingRefs: [CANDIDATE],
    target: TARGET,
    verificationRef: {
      schemaVersion: 1,
      proposalId: PROPOSAL,
      experimentId: EXPERIMENT,
      applicationId: APPLICATION,
      verificationId: VERIFICATION,
    },
    observedEvidenceRefs: ["obs:recheck"],
    ...patch,
  };
}

function promotionEvent(
  patch: Partial<EvolutionCompletionPromotionEvent> = {},
): EvolutionCompletionPromotionEvent {
  return {
    eventId: "evt-promotion-001",
    type: "promotion.completed",
    tenantScope: TENANT,
    proposalId: PROPOSAL,
    experimentId: EXPERIMENT,
    applicationId: APPLICATION,
    verificationId: VERIFICATION,
    target: TARGET,
    surfaceId: SURFACE,
    candidateRef: CANDIDATE_REF,
    principalRef: "operator-1",
    timestamp: PROMOTED_AT,
    ...patch,
  };
}

function evidence(patch: Partial<EvolutionCompletionEvidence> = {}): EvolutionCompletionEvidence {
  return {
    tenantId: TENANT,
    target: TARGET,
    surfaceId: SURFACE,
    candidateVersion: CANDIDATE,
    proposal: {
      proposalId: PROPOSAL,
      status: "VERIFIED",
      tenantScope: TENANT,
      surfaceId: SURFACE,
      candidateRef: CANDIDATE_REF,
      target: TARGET,
    },
    experiment: {
      experimentId: EXPERIMENT,
      proposalId: PROPOSAL,
      surfaceId: SURFACE,
      tenantScope: TENANT,
      candidateRef: CANDIDATE_REF,
    },
    application: {
      applicationId: APPLICATION,
      proposalId: PROPOSAL,
      experimentId: EXPERIMENT,
      status: "applied",
    },
    verification: {
      verificationId: VERIFICATION,
      applicationId: APPLICATION,
      outcome: "improved",
      verifiedAt: VERIFIED_AT,
    },
    recheck: recheck(),
    recheckRecordedAt: RECHECK_AT,
    evaluation: { action: "promote", reasonCode: "evaluation_passed" },
    promotionEvents: emptyPromotionPlaceholder(),
    authorityOk: true,
    guardrailDegraded: false,
    ...patch,
  };
}

function emptyPromotionPlaceholder() {
  return {
    source: Symbol("not-the-server"),
    events: [],
  } as unknown as EvolutionCompletionEvidence["promotionEvents"];
}

function decide(
  patch: Omit<Partial<EvolutionCompletionEvidence>, "promotionEvents"> & {
    promotionEvents?: EvolutionCompletionPromotionEvent[];
  } = {},
): ReturnType<typeof decideEvolutionCompletionFromLedger> {
  const events = patch.promotionEvents ?? [promotionEvent()];
  const { promotionEvents: _ignored, ...rest } = patch;
  const sample = evidence(rest);
  const records: CompletionLedgerRecord[] = [];
  if (sample.proposal) {
    records.push({ kind: "proposal", body: sample.proposal });
  }
  if (sample.experiment) {
    records.push({ kind: "experiment", body: sample.experiment });
  }
  if (sample.application) {
    records.push({ kind: "application", body: sample.application });
  }
  if (sample.proposal && sample.experiment && sample.verification) {
    records.push({
      kind: "verification",
      proposalId: sample.proposal.proposalId,
      experimentId: sample.experiment.experimentId,
      body: sample.verification,
    });
  }
  if (sample.recheck) {
    records.push({
      kind: "recheck",
      tenantId: sample.tenantId,
      recordedAt: sample.recheckRecordedAt ?? "",
      body: sample.recheck,
    });
  }
  for (const event of events) {
    records.push({ kind: "event", event });
  }
  return decideEvolutionCompletionFromLedger({
    reader: createMemoryCompletionLedger(records),
    query: {
      tenantId: sample.tenantId,
      proposalId: sample.proposal?.proposalId ?? PROPOSAL,
      experimentId: sample.experiment?.experimentId ?? EXPERIMENT,
      applicationId: sample.application?.applicationId ?? APPLICATION,
    },
    target: sample.target,
    surfaceId: sample.surfaceId,
    candidateVersion: sample.candidateVersion,
    authorityOk: sample.authorityOk,
    guardrailDegraded: sample.guardrailDegraded,
    evaluation: sample.evaluation,
  });
}

describe("decideEvolutionCompletion", () => {
  it("completes only the full closed loop", () => {
    const decision = decide();
    expect(decision).toMatchObject({
      applicationVerified: true,
      recheckOutcome: "RESOLVED",
      promotionEligible: true,
      promotionCompleted: true,
      recommendation: "promote",
      reasonCode: "completion_accepted",
      userVisibleStatus: "已完成进化",
    });
  });

  it("keeps a resolved closure eligible when the promotion event is absent", () => {
    const decision = decide({ promotionEvents: [] });
    expect(decision.promotionEligible).toBe(true);
    expect(decision.promotionCompleted).toBe(false);
    expect(decision.reasonCode).toBe("promote_gate");
    expect(decision.userVisibleStatus).toBe("可进入晋升门禁，进化未完成");
    expect(decision.userVisibleStatus).not.toContain("已完成进化");
  });

  it("still verifies and completes when proposal status is already PROMOTED", () => {
    const decision = decide({
      proposal: {
        proposalId: PROPOSAL,
        status: "PROMOTED",
        tenantScope: TENANT,
        surfaceId: SURFACE,
        candidateRef: CANDIDATE_REF,
        target: TARGET,
      },
    });
    expect(decision.applicationVerified).toBe(true);
    expect(decision.promotionEligible).toBe(true);
    expect(decision.promotionCompleted).toBe(true);
    expect(decision.reasonCode).toBe("completion_accepted");
    expect(decision.userVisibleStatus).toBe("已完成进化");
  });

  it.each(["pending", "failed", "rolled_back"])("fail-closes a %s application", (status) => {
    const decision = decide({
      application: {
        applicationId: APPLICATION,
        proposalId: PROPOSAL,
        experimentId: EXPERIMENT,
        status,
      },
    });
    expect(decision.reasonCode).toBe("application_not_applied");
    expect(decision.promotionEligible).toBe(false);
    expect(decision.promotionCompleted).toBe(false);
    expect(decision.recommendation).toBe("fail-closed");
    expect(decision.userVisibleStatus).not.toContain("已完成进化");
  });

  it("fail-closes a verification that is not bound to the application", () => {
    const decision = decide({
      verification: {
        verificationId: VERIFICATION,
        applicationId: "app:other",
        outcome: "improved",
        verifiedAt: VERIFIED_AT,
      },
    });
    expect(decision.reasonCode).toBe("verification_unbound");
    expect(decision.promotionCompleted).toBe(false);
    expect(decision.promotionEligible).toBe(false);
  });

  it("fail-closes a recheck that is not bound to the verification", () => {
    const decision = decide({
      recheck: recheck({
        verificationRef: {
          schemaVersion: 1,
          proposalId: PROPOSAL,
          experimentId: EXPERIMENT,
          applicationId: APPLICATION,
          verificationId: "ver:other",
        },
      }),
    });
    expect(decision.reasonCode).toBe("recheck_unbound");
    expect(decision.promotionCompleted).toBe(false);
    expect(decision.promotionEligible).toBe(false);
  });

  it("fail-closes a promotion event that is not later than verification and recheck", () => {
    const early = decide({ promotionEvents: [promotionEvent({ timestamp: VERIFIED_AT })] });
    expect(early.reasonCode).toBe("promotion_event_early");
    expect(early.promotionCompleted).toBe(false);
    expect(early.promotionEligible).toBe(false);
    const beforeRecheck = decide({
      promotionEvents: [promotionEvent({ timestamp: "2026-09-22T09:15:00.000Z" })],
    });
    expect(beforeRecheck.reasonCode).toBe("promotion_event_early");
    expect(beforeRecheck.userVisibleStatus).not.toContain("已完成进化");
  });

  it("fail-closes duplicate and conflicting promotion events", () => {
    const duplicate = decide({
      promotionEvents: [promotionEvent(), promotionEvent({ eventId: "evt-promotion-002" })],
    });
    expect(duplicate.reasonCode).toBe("promotion_event_conflict");
    expect(duplicate.promotionEligible).toBe(false);
    expect(duplicate.promotionCompleted).toBe(false);
    expect(duplicate.userVisibleStatus).toBe("无法确认，已停止");
    const conflict = decide({
      promotionEvents: [
        promotionEvent(),
        promotionEvent({ eventId: "evt-promotion-003", verificationId: "ver:other" }),
      ],
    });
    expect(conflict.reasonCode).toBe("promotion_event_conflict");
    expect(conflict.promotionCompleted).toBe(false);
  });

  it("ignores a promotion event for another proposal", () => {
    const decision = decide({
      promotionEvents: [promotionEvent({ eventId: "evt-other", proposalId: "evo:other" })],
    });
    expect(decision.promotionEligible).toBe(true);
    expect(decision.promotionCompleted).toBe(false);
    expect(decision.userVisibleStatus).toBe("可进入晋升门禁，进化未完成");
  });

  it("fail-closes tenant, target, surface, and candidate mismatches", () => {
    const base = evidence();
    const cases: Array<{
      patch: Omit<Partial<EvolutionCompletionEvidence>, "promotionEvents">;
      reasonCode: string;
    }> = [
      {
        patch: { proposal: { ...base.proposal!, tenantScope: "999" } },
        reasonCode: "missing_binding",
      },
      {
        patch: { proposal: { ...base.proposal!, target: { domain: "agent", agentId: "other" } } },
        reasonCode: "binding_mismatch",
      },
      {
        patch: { experiment: { ...base.experiment!, surfaceId: "agent.other" } },
        reasonCode: "binding_mismatch",
      },
      {
        patch: { proposal: { ...base.proposal!, candidateRef: "cand:diag:ffff" } },
        reasonCode: "binding_mismatch",
      },
    ];
    for (const sample of cases) {
      const decision = decide(sample.patch);
      expect(decision.reasonCode).toBe(sample.reasonCode);
      expect(decision.promotionEligible).toBe(false);
      expect(decision.promotionCompleted).toBe(false);
      expect(decision.userVisibleStatus).not.toContain("已完成进化");
    }
  });

  it("fail-closes when authority or the guardrail is not clean", () => {
    const authority = decide({ authorityOk: false, promotionEvents: [] });
    expect(authority.reasonCode).toBe("authority_required");
    expect(authority.promotionEligible).toBe(false);
    expect(authority.promotionCompleted).toBe(false);
    const guardrail = decide({ guardrailDegraded: true, promotionEvents: [] });
    expect(guardrail.reasonCode).toBe("guardrail_degraded");
    expect(guardrail.promotionCompleted).toBe(false);
    expect(guardrail.userVisibleStatus).not.toContain("已完成进化");
  });
});
