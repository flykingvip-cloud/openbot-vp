import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isE52CutoverReceipt } from "./a9-m1-observation.js";
import {
  projectC6M1Status,
  type C6LedgerEvent,
  type C6M1AuditInput,
  type C6PromotionProjection,
} from "./c6-m1-promotion.js";
import { createMemoryCompletionLedger, type CompletionLedgerRecord } from "./completion-ledger.js";
import { assertDiagnosisRecheckResult, type DiagnosisRecheckOutcome } from "./diagnosis-recheck.js";

const here = dirname(fileURLToPath(import.meta.url));

type Replay = {
  tenantId: string;
  target: { domain: "agent"; agentId: string };
  surfaceId: string;
  candidateVersion: string;
  candidateRef: string;
  proposalId: string;
  proposalStatus: string;
  experimentId: string;
  experimentResult: "improved";
  activeApplicationId: string;
  activeApplicationStatus: string;
  verificationId: string;
  verificationOutcome: string;
  commandId: string;
  observationWindow: { startedAt: string; endedAt: string; sampleCount: number };
  ledgerEvents: C6LedgerEvent[];
  activeRecheck: {
    outcome: DiagnosisRecheckOutcome;
    reasonCode: string;
    findingRefs: string[];
    observedEvidenceRefs: string[];
  };
  regressedRecheck: {
    outcome: DiagnosisRecheckOutcome;
    reasonCode: string;
    applicationId: string;
    verificationId: string;
    commandId: string;
    findingRefs: string[];
    observedEvidenceRefs: string[];
  };
};

function ledgerFor(input: {
  tenantId: string;
  proposalId: string;
  experimentId: string;
  applicationId: string;
  proposal: CompletionLedgerRecord extends infer _T
    ? Extract<CompletionLedgerRecord, { kind: "proposal" }>["body"]
    : never;
  experiment: Extract<CompletionLedgerRecord, { kind: "experiment" }>["body"];
  application: Extract<CompletionLedgerRecord, { kind: "application" }>["body"];
  verification: Extract<CompletionLedgerRecord, { kind: "verification" }>["body"] | null;
  recheck: Extract<CompletionLedgerRecord, { kind: "recheck" }>["body"] | null;
  recheckRecordedAt: string;
  events: readonly C6LedgerEvent[];
}) {
  const records: CompletionLedgerRecord[] = [
    { kind: "proposal", body: input.proposal },
    { kind: "experiment", body: input.experiment },
    { kind: "application", body: input.application },
  ];
  if (input.verification) {
    records.push({
      kind: "verification",
      proposalId: input.proposalId,
      experimentId: input.experimentId,
      body: input.verification,
    });
  }
  if (input.recheck) {
    records.push({
      kind: "recheck",
      tenantId: input.tenantId,
      recordedAt: input.recheckRecordedAt,
      body: input.recheck,
    });
  }
  for (const event of input.events) {
    records.push({ kind: "event", event });
  }
  return createMemoryCompletionLedger(records);
}

function replay(): Replay {
  return JSON.parse(readFileSync(join(here, "c6-a10-replay.json"), "utf8")) as Replay;
}

function input(
  replayFact: Replay,
  patch: {
    outcome?: DiagnosisRecheckOutcome | null;
    proposalStatus?: string;
    ledgerEvents?: C6LedgerEvent[];
    applicationStatus?: string;
    verificationApplicationId?: string;
    proposalTenant?: string;
    proposalCandidateRef?: string;
    proposalTarget?: Replay["target"];
    authorityOk?: boolean;
    guardrailDegraded?: boolean;
    sampleCount?: number;
    startedAt?: string | null;
    executedConsumer?: unknown;
    directMutatorsRetired?: unknown;
    e52SwitchAllowed?: unknown;
    cutoverReady?: unknown;
  } = {},
): C6M1AuditInput {
  const outcome = patch.outcome === undefined ? replayFact.activeRecheck.outcome : patch.outcome;
  const verificationId = replayFact.verificationId;
  const applicationId = replayFact.activeApplicationId;
  return {
    tenantId: replayFact.tenantId,
    target: replayFact.target,
    surfaceId: replayFact.surfaceId,
    candidateVersion: replayFact.candidateVersion,
    commandId: replayFact.commandId,
    observationWindow: {
      ...replayFact.observationWindow,
      ...(patch.sampleCount != null ? { sampleCount: patch.sampleCount } : {}),
      ...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
    },
    proposal: {
      proposalId: replayFact.proposalId,
      status: patch.proposalStatus ?? replayFact.proposalStatus,
      tenantScope: patch.proposalTenant ?? replayFact.tenantId,
      surfaceId: replayFact.surfaceId,
      candidateRef: patch.proposalCandidateRef ?? replayFact.candidateRef,
      target: patch.proposalTarget ?? replayFact.target,
    },
    experiment: {
      experimentId: replayFact.experimentId,
      proposalId: replayFact.proposalId,
      surfaceId: replayFact.surfaceId,
      tenantScope: replayFact.tenantId,
      candidateRef: replayFact.candidateRef,
      result: replayFact.experimentResult,
    },
    application: {
      applicationId,
      proposalId: replayFact.proposalId,
      experimentId: replayFact.experimentId,
      status: patch.applicationStatus ?? replayFact.activeApplicationStatus,
    },
    verification: {
      verificationId,
      applicationId: patch.verificationApplicationId ?? applicationId,
      outcome: replayFact.verificationOutcome,
      verifiedAt: replayFact.observationWindow.startedAt,
    },
    recheck:
      outcome == null
        ? null
        : assertDiagnosisRecheckResult({
            outcome,
            reasonCode: `recheck_${outcome.toLowerCase()}`,
            findingRefs: replayFact.activeRecheck.findingRefs,
            observedEvidenceRefs: replayFact.activeRecheck.observedEvidenceRefs,
            target: replayFact.target,
            verificationRef: {
              schemaVersion: 1,
              proposalId: replayFact.proposalId,
              experimentId: replayFact.experimentId,
              applicationId,
              verificationId,
            },
          }),
    recheckRecordedAt: replayFact.observationWindow.startedAt,
    ledgerEvents: patch.ledgerEvents ?? replayFact.ledgerEvents,
    authorityOk: patch.authorityOk,
    guardrailDegraded: patch.guardrailDegraded,
    sampleSize: 20,
    confidence: 0.95,
    rollbackDrillPassed: true,
    executedConsumer: patch.executedConsumer,
    directMutatorsRetired: patch.directMutatorsRetired,
    e52SwitchAllowed: patch.e52SwitchAllowed,
    cutoverReady: patch.cutoverReady,
    ledger: ledgerFor({
      tenantId: replayFact.tenantId,
      proposalId: replayFact.proposalId,
      experimentId: replayFact.experimentId,
      applicationId,
      proposal: {
        proposalId: replayFact.proposalId,
        status: patch.proposalStatus ?? replayFact.proposalStatus,
        tenantScope: patch.proposalTenant ?? replayFact.tenantId,
        surfaceId: replayFact.surfaceId,
        candidateRef: patch.proposalCandidateRef ?? replayFact.candidateRef,
        target: patch.proposalTarget ?? replayFact.target,
      },
      experiment: {
        experimentId: replayFact.experimentId,
        proposalId: replayFact.proposalId,
        surfaceId: replayFact.surfaceId,
        tenantScope: replayFact.tenantId,
        candidateRef: replayFact.candidateRef,
      },
      application: {
        applicationId,
        proposalId: replayFact.proposalId,
        experimentId: replayFact.experimentId,
        status: patch.applicationStatus ?? replayFact.activeApplicationStatus,
      },
      verification: {
        verificationId,
        applicationId: patch.verificationApplicationId ?? applicationId,
        outcome: replayFact.verificationOutcome,
        verifiedAt: replayFact.observationWindow.startedAt,
      },
      recheckRecordedAt: replayFact.observationWindow.startedAt,
      recheck:
        outcome == null
          ? null
          : {
              outcome,
              reasonCode: `recheck_${outcome.toLowerCase()}`,
              findingRefs: replayFact.activeRecheck.findingRefs,
              observedEvidenceRefs: replayFact.activeRecheck.observedEvidenceRefs,
              target: replayFact.target,
              verificationRef: {
                schemaVersion: 1 as const,
                proposalId: replayFact.proposalId,
                experimentId: replayFact.experimentId,
                applicationId,
                verificationId,
              },
            },
      events: patch.ledgerEvents ?? replayFact.ledgerEvents,
    }),
    a9Event: {
      kind: "a9-m1",
      proposalId: replayFact.proposalId,
      experimentId: replayFact.experimentId,
      applicationId,
      recordedAt: replayFact.observationWindow.startedAt,
      executedConsumer: true,
      directMutatorsRetired: true,
      e52SwitchAllowed: true,
      cutoverReady: true,
    },
  };
}

function promotionEvent(fact: Replay, patch: Partial<C6LedgerEvent> = {}): C6LedgerEvent {
  return {
    eventId: "evt-promotion-001",
    type: "promotion.completed",
    tenantScope: fact.tenantId,
    proposalId: fact.proposalId,
    experimentId: fact.experimentId,
    applicationId: fact.activeApplicationId,
    verificationId: fact.verificationId,
    target: fact.target,
    surfaceId: fact.surfaceId,
    candidateRef: fact.candidateRef,
    principalRef: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
    timestamp: "2026-09-22T10:00:00.000Z",
    ...patch,
  };
}

function withPromotion(
  fact: Replay,
  patch: Parameters<typeof input>[1] = {},
  eventPatch: Partial<C6LedgerEvent> = {},
): C6M1AuditInput {
  return input(fact, {
    authorityOk: true,
    guardrailDegraded: false,
    ledgerEvents: [...fact.ledgerEvents, promotionEvent(fact, eventPatch)],
    ...patch,
  });
}

function expectClosed(projection: C6PromotionProjection): void {
  expect(projection.promotionEligible).toBe(false);
  expect(projection.promotionCompleted).toBe(false);
  expect(projection.executedConsumer).toBe(false);
  expect(projection.directMutatorsRetired).toBe(false);
  expect(projection.e52SwitchAllowed).toBe(false);
  expect(projection.isE52CutoverReceipt).toBe(false);
  expect(projection.singleTrack).toBe(false);
  expect(projection.userVisibleStatus).not.toContain("已完成进化");
}

describe("C6 M1 promotion projection", () => {
  it("replays the A10 001 active closure as Hold and not completion", () => {
    const fact = replay();
    const projection = projectC6M1Status(input(fact));
    expect(projection.alignmentOk).toBe(true);
    expect(projection.applicationVerified).toBe(true);
    expect(projection.recheckOutcome).toBe("STILL_OPEN");
    expect(projection.evaluationDecision).toEqual({
      action: "hold",
      reasonCode: "finding_still_open",
    });
    expect(projection.promotionEligible).toBe(false);
    expect(projection.promotionCompleted).toBe(false);
    expect(fact.ledgerEvents.some((event) => event.type === "promotion.completed")).toBe(false);
    expect(projection.userVisibleStatus).toBe("已验证，进化未完成");
    expect(projection.shadowObservationOnly).toBe(true);
    expect(isE52CutoverReceipt({ kind: "a9-m1" })).toBe(false);
    expectClosed(projection);
  });

  it("lets VERIFIED + RESOLVED enter the promote gate without completing promotion", () => {
    const projection = projectC6M1Status(
      input(replay(), { outcome: "RESOLVED", authorityOk: true, guardrailDegraded: false }),
    );
    expect(projection.applicationVerified).toBe(true);
    expect(projection.recheckOutcome).toBe("RESOLVED");
    expect(projection.evaluationDecision).toEqual({
      action: "promote",
      reasonCode: "evaluation_passed",
    });
    expect(projection.promotionEligible).toBe(true);
    expect(projection.promotionCompleted).toBe(false);
    expect(projection.userVisibleStatus).toBe("可进入晋升门禁，进化未完成");
    expect(projection.e52SwitchAllowed).toBe(false);
  });

  it("holds VERIFIED + STILL_OPEN", () => {
    const projection = projectC6M1Status(input(replay(), { outcome: "STILL_OPEN" }));
    expect(projection.evaluationDecision.action).toBe("hold");
    expect(projection.promotionEligible).toBe(false);
    expect(projection.userVisibleStatus).toBe("已验证，进化未完成");
  });

  it("rolls back VERIFIED + REGRESSED", () => {
    const projection = projectC6M1Status(input(replay(), { outcome: "REGRESSED" }));
    expect(projection.recheckOutcome).toBe("REGRESSED");
    expect(projection.evaluationDecision).toEqual({
      action: "rollback",
      reasonCode: "finding_regressed",
    });
    expect(projection.promotionEligible).toBe(false);
    expect(projection.userVisibleStatus).toBe("建议回滚");
  });

  it("observes VERIFIED + INCONCLUSIVE", () => {
    const projection = projectC6M1Status(input(replay(), { outcome: "INCONCLUSIVE" }));
    expect(projection.evaluationDecision).toEqual({
      action: "observe",
      reasonCode: "recheck_inconclusive",
    });
    expect(projection.promotionEligible).toBe(false);
    expect(projection.userVisibleStatus).toBe("继续观察");
  });

  it("fail-closes when recheck is missing", () => {
    const projection = projectC6M1Status(input(replay(), { outcome: null }));
    expect(projection.recheckOutcome).toBeNull();
    expect(projection.evaluationDecision).toEqual({
      action: "block",
      reasonCode: "recheck_required",
    });
    expect(projection.promotionEligible).toBe(false);
    expect(projection.userVisibleStatus).toBe("无法确认，已停止");
    expectClosed(projection);
  });

  it("shows 已完成进化 only when the structured promotion event matches every binding", () => {
    const fact = replay();
    const open = projectC6M1Status(
      input(fact, { outcome: "RESOLVED", authorityOk: true, guardrailDegraded: false }),
    );
    expect(open.promotionEligible).toBe(true);
    expect(open.promotionCompleted).toBe(false);
    expect(open.userVisibleStatus).not.toContain("已完成进化");
    const completed = projectC6M1Status(withPromotion(fact, { outcome: "RESOLVED" }));
    expect(completed.promotionEligible).toBe(true);
    expect(completed.promotionCompleted).toBe(true);
    expect(completed.evaluationDecision.action).toBe("promote");
    expect(completed.userVisibleStatus).toBe("已完成进化");
    expect(completed.executedConsumer).toBe(false);
    expect(completed.directMutatorsRetired).toBe(false);
    expect(completed.e52SwitchAllowed).toBe(false);
    expect(completed.singleTrack).toBe(false);
  });

  it("does not complete when a promotion event disagrees with the closure", () => {
    const fact = replay();
    const regressed = projectC6M1Status(withPromotion(fact, { outcome: "REGRESSED" }));
    expect(regressed.evaluationDecision.action).toBe("rollback");
    expect(regressed.promotionCompleted).toBe(false);
    expect(regressed.promotionEligible).toBe(false);
    expect(regressed.userVisibleStatus).toBe("建议回滚");

    const stillOpen = projectC6M1Status(withPromotion(fact, { outcome: "STILL_OPEN" }));
    expect(stillOpen.evaluationDecision.action).toBe("hold");
    expect(stillOpen.promotionCompleted).toBe(false);
    expect(stillOpen.userVisibleStatus).toBe("已验证，进化未完成");

    const mismatch = projectC6M1Status(
      withPromotion(fact, { outcome: "RESOLVED", proposalTenant: "999" }),
    );
    expect(mismatch.evaluationDecision).toEqual({
      action: "block",
      reasonCode: "binding_mismatch",
    });
    expect(mismatch.promotionCompleted).toBe(false);
    expect(mismatch.promotionEligible).toBe(false);

    const otherProposal = projectC6M1Status(
      input(fact, {
        outcome: "RESOLVED",
        authorityOk: true,
        guardrailDegraded: false,
        ledgerEvents: [
          ...fact.ledgerEvents,
          promotionEvent(fact, { eventId: "evt-other", proposalId: "evo:other" }),
        ],
      }),
    );
    expect(otherProposal.promotionEligible).toBe(true);
    expect(otherProposal.promotionCompleted).toBe(false);
    expect(otherProposal.userVisibleStatus).toBe("可进入晋升门禁，进化未完成");

    const rolledBack = projectC6M1Status(
      withPromotion(fact, { outcome: "RESOLVED", applicationStatus: "rolled_back" }),
    );
    expect(rolledBack.promotionCompleted).toBe(false);
    expect(rolledBack.promotionEligible).toBe(false);
    expect(rolledBack.userVisibleStatus).not.toContain("已完成进化");

    const wrongVerification = projectC6M1Status(
      withPromotion(fact, { outcome: "RESOLVED", verificationApplicationId: "app:other" }),
    );
    expect(wrongVerification.promotionCompleted).toBe(false);
    expect(wrongVerification.promotionEligible).toBe(false);

    const wrongTarget = projectC6M1Status(
      withPromotion(fact, {
        outcome: "RESOLVED",
        proposalTarget: { domain: "agent", agentId: "someone-else" },
      }),
    );
    expect(wrongTarget.mismatches).toContain("target");
    expect(wrongTarget.promotionCompleted).toBe(false);
    expect(wrongTarget.evaluationDecision.action).toBe("block");

    const wrongCandidate = projectC6M1Status(
      withPromotion(fact, { outcome: "RESOLVED", proposalCandidateRef: "cand:diag:ffff" }),
    );
    expect(wrongCandidate.mismatches).toContain("candidate");
    expect(wrongCandidate.promotionCompleted).toBe(false);

    const wrongTenant = projectC6M1Status(
      withPromotion(fact, { outcome: "RESOLVED" }, { tenantScope: "999" }),
    );
    expect(wrongTenant.promotionCompleted).toBe(false);
    expect(wrongTenant.promotionEligible).toBe(true);
    expect(wrongTenant.userVisibleStatus).toBe("可进入晋升门禁，进化未完成");
    expect(wrongTenant.userVisibleStatus).not.toContain("已完成进化");

    const duplicate = projectC6M1Status(
      input(fact, {
        outcome: "RESOLVED",
        authorityOk: true,
        guardrailDegraded: false,
        ledgerEvents: [
          ...fact.ledgerEvents,
          promotionEvent(fact),
          promotionEvent(fact, { eventId: "evt-promotion-002" }),
        ],
      }),
    );
    expect(duplicate.evaluationDecision).toEqual({
      action: "block",
      reasonCode: "promotion_event_conflict",
    });
    expect(duplicate.promotionCompleted).toBe(false);
    expect(duplicate.promotionEligible).toBe(false);
    expect(duplicate.userVisibleStatus).toBe("无法确认，已停止");

    const missingRecheck = projectC6M1Status(withPromotion(fact, { outcome: null }));
    expect(missingRecheck.evaluationDecision).toEqual({
      action: "block",
      reasonCode: "recheck_required",
    });
    expect(missingRecheck.promotionCompleted).toBe(false);
    expect(missingRecheck.userVisibleStatus).not.toContain("已完成进化");
  });

  it("keeps forged cutover fields and an empty window from authorizing E5.2", () => {
    const forged = projectC6M1Status(
      input(replay(), {
        outcome: "RESOLVED",
        executedConsumer: true,
        directMutatorsRetired: true,
        e52SwitchAllowed: true,
        cutoverReady: true,
        sampleCount: 0,
      }),
    );
    expect(forged.alignmentOk).toBe(false);
    expect(forged.mismatches).toContain("observationWindow");
    expect(forged.evaluationDecision.reasonCode).toBe("observation_window_empty");
    expect(forged.promotionEligible).toBe(false);
    expect(forged.executedConsumer).toBe(false);
    expect(forged.directMutatorsRetired).toBe(false);
    expect(forged.e52SwitchAllowed).toBe(false);
    expect(forged.isE52CutoverReceipt).toBe(false);
    expect(forged.userVisibleStatus).not.toContain("已完成进化");
  });
});
