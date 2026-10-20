import { describe, expect, it } from "vitest";
import type { SurfaceAutonomyPolicy } from "./autonomy.js";
import type { EvolutionSurface } from "./contracts.js";
import { getEvolutionSurface } from "./surfaces.js";
import {
  EVOLUTION_TIMELINE_ITEM_FIELDS,
  assembleEvolutionTimelineQueryResult,
  denyEvolutionTimelineQuery,
  digitalHumanLearnedItems,
  emptyEvolutionTimelineQueryResult,
  evolutionTimelineResultLabel,
  projectEvolutionTimelineItem,
  type EvolutionTimelineItem,
  type EvolutionTimelineLedgerFact,
  type EvolutionTimelineProjectionInput,
} from "./timeline.js";
import type {
  DiagnosisProposalV1,
  EvolutionApplication,
  EvolutionProposal,
  EvolutionTarget,
  EvolutionVerification,
} from "./types.js";

const agentTarget: EvolutionTarget = { domain: "agent", agentId: "bot-1" };
const systemTarget: EvolutionTarget = { domain: "system", componentId: "runtime-binding" };

function event(
  over: Partial<EvolutionTimelineLedgerFact> &
    Pick<EvolutionTimelineLedgerFact, "eventId" | "type">,
): EvolutionTimelineLedgerFact {
  return {
    timestamp: "2026-09-25T00:00:00.000Z",
    proposalId: "prop-1",
    surfaceId: "agent.working-dna",
    tenantScope: "tenant-a",
    evidenceRefs: ["ev-ledger"],
    target: agentTarget,
    ...over,
  };
}

function proposal(over: Partial<EvolutionProposal> = {}): EvolutionProposal {
  return {
    schemaVersion: 2,
    proposalId: "prop-1",
    sourceEvidenceRefs: ["ev-proposal"],
    sourceMechanismRef: "mechanism:case-1",
    target: agentTarget,
    candidateRef: "cand-1",
    surfaceId: "agent.working-dna",
    expectedEffects: [],
    riskLevel: "low",
    confidentialityScope: "personal",
    tenantScope: "tenant-a",
    grantId: "grant-1",
    status: "VERIFIED",
    createdAt: "2026-09-25T00:00:00.000Z",
    expiresAt: "2026-10-25T00:00:00.000Z",
    ...over,
  };
}

function proposalV1(over: Partial<DiagnosisProposalV1> = {}): DiagnosisProposalV1 {
  return {
    schemaVersion: 1,
    proposalId: "prop-v1",
    sourceCaseId: "case-9",
    sourceFindingIds: ["finding-9"],
    sourceEvidenceRefs: [],
    sourceReportRef: "report-9",
    tenantScope: "tenant-a",
    targetDomain: "agent_working_dna",
    proposedChange: { summary: "tune working DNA" },
    expectedEffect: "raise task success",
    riskLevel: "low",
    confidentialityScope: "personal",
    status: "PENDING_APPROVAL",
    approvalRequired: true,
    approverScope: "personal",
    grantId: "grant-v1",
    createdAt: "2026-09-25T00:00:00.000Z",
    expiresAt: "2026-10-25T00:00:00.000Z",
    auditReceipt: "aud:prop-v1",
    ...over,
  };
}

function application(over: Partial<EvolutionApplication> = {}): EvolutionApplication {
  return {
    schemaVersion: 1,
    applicationId: "app-1",
    proposalId: "prop-1",
    experimentId: "exp-1",
    adapterId: "working-dna",
    idempotencyKey: "idem-1",
    targetVersionBefore: "v1",
    targetVersionAfter: "v2",
    rollbackRef: "rb-1",
    scope: "canary",
    status: "applied",
    appliedToRuntime: true,
    ...over,
  };
}

function verification(over: Partial<EvolutionVerification> = {}): EvolutionVerification {
  return {
    schemaVersion: 1,
    verificationId: "ver-1",
    applicationId: "app-1",
    baselineWindowRef: "base",
    evaluationWindowRef: "eval",
    primaryEffect: 0.1,
    guardrailResults: [],
    sampleSize: 20,
    confidence: 0.95,
    outcome: "improved",
    evidenceRefs: ["ev-ver"],
    verifiedAt: "2026-09-25T03:00:00.000Z",
    ...over,
  };
}

function surfaceWith(over: Partial<EvolutionSurface> = {}): EvolutionSurface {
  const base = getEvolutionSurface("agent.working-dna");
  if (!base) {
    throw new Error("agent.working-dna surface missing");
  }
  return { ...base, ...over };
}

function autoPolicy(): SurfaceAutonomyPolicy {
  return {
    surfaceId: "agent.working-dna",
    mode: "auto",
    maxApplications: 1,
    usedApplications: 0,
    maxImpactScope: "active",
  };
}

function included(input: EvolutionTimelineProjectionInput): EvolutionTimelineItem {
  const projected = projectEvolutionTimelineItem(input);
  expect(projected.included).toBe(true);
  if (!projected.included) {
    throw new Error(projected.reason);
  }
  return projected.item;
}

describe("evolution timeline §3 mapping", () => {
  it("maps a pre-authorized apply with a passing autonomy check to automatic", () => {
    const item = included({
      events: [
        event({
          eventId: "evt-auth",
          type: "proposal.authorized",
          timestamp: "2026-09-25T01:00:00.000Z",
        }),
        event({
          eventId: "evt-apply",
          type: "application.applied",
          timestamp: "2026-09-25T02:00:00.000Z",
          applicationId: "app-1",
        }),
        event({
          eventId: "evt-ver",
          type: "verification.completed",
          timestamp: "2026-09-25T03:00:00.000Z",
          applicationId: "app-1",
          verificationId: "ver-1",
        }),
      ],
      proposal: proposal(),
      application: application(),
      verification: verification(),
      surface: surfaceWith({ autoApply: true, riskLevel: "low" }),
      autonomy: { policy: autoPolicy() },
    });

    expect(item.bucket).toBe("automatic");
    expect(item.executionMode).toBe("automatic");
    expect(item.result).toBe("verified_effective");
    expect(evolutionTimelineResultLabel(item.result)).toBe("已验证有效");
    expect(item.proposalSchema).toBe(2);
    expect(item.legacy).toBe(false);
    expect(item.completeness).toBe("complete");
    expect(item.beforeAfter).toEqual({
      versionBefore: "v1",
      versionAfter: "v2",
      summary: "v1 → v2",
    });
    expect(item.reason.status).toBe("specified");
    expect(item.reason.sourceEvidenceRefs).toEqual(["ev-proposal"]);
    expect(item.reversible).toBe(true);
    expect(item.audience).toBe("digital_human");
    expect(item.factIds).toEqual({
      ledgerEventId: "evt-auth",
      proposalId: "prop-1",
      applicationId: "app-1",
      verificationId: "ver-1",
    });
    expect(item.impactScope.label).toBe("本人");
    for (const field of EVOLUTION_TIMELINE_ITEM_FIELDS) {
      expect(item).toHaveProperty(field);
    }
  });

  it("does not let a superseded rollback-drill receipt hide verified_effective", () => {
    const item = included({
      events: [
        event({
          eventId: "evt-apply-a",
          type: "application.applied",
          timestamp: "2026-09-25T02:00:00.000Z",
          applicationId: "app-a",
        }),
        event({
          eventId: "evt-rb-receipt",
          type: "application.rolled_back",
          timestamp: "2026-09-25T02:30:00.000Z",
          applicationId: "app-a",
        }),
        event({
          eventId: "evt-apply-b",
          type: "application.applied",
          timestamp: "2026-09-25T03:00:00.000Z",
          applicationId: "app-b",
        }),
        event({
          eventId: "evt-ver-b",
          type: "verification.completed",
          timestamp: "2026-09-25T04:00:00.000Z",
          applicationId: "app-b",
          verificationId: "ver-b",
        }),
        event({
          eventId: "evt-promo",
          type: "promotion.completed",
          timestamp: "2026-09-25T05:00:00.000Z",
          applicationId: "app-b",
          verificationId: "ver-b",
        }),
      ],
      proposal: proposal({ status: "PROMOTED", applicationId: "app-b", verificationId: "ver-b" }),
      application: application({
        applicationId: "app-b",
        status: "applied",
        purpose: "promoted",
      }),
      verification: verification({
        verificationId: "ver-b",
        applicationId: "app-b",
        outcome: "improved",
      }),
    });
    expect(item.result).toBe("verified_effective");
    expect(item.result).not.toBe("rolled_back");
  });

  it("maps approval-then-apply to user_approved and never to automatic", () => {
    const events = [
      event({
        eventId: "evt-auth",
        type: "proposal.authorized",
        timestamp: "2026-09-25T00:30:00.000Z",
      }),
      event({
        eventId: "evt-ok",
        type: "application.approved",
        timestamp: "2026-09-25T01:00:00.000Z",
      }),
      event({
        eventId: "evt-apply",
        type: "application.applied",
        timestamp: "2026-09-25T02:00:00.000Z",
        applicationId: "app-1",
      }),
      event({
        eventId: "evt-ver",
        type: "verification.completed",
        timestamp: "2026-09-25T03:00:00.000Z",
        verificationId: "ver-1",
      }),
    ];
    const shared = {
      events,
      application: application(),
      verification: verification(),
      surface: surfaceWith({ autoApply: true, riskLevel: "low" }),
      autonomy: { policy: autoPolicy() },
    };
    const userItem = included({
      ...shared,
      proposal: proposal({ confidentialityScope: "personal" }),
    });
    const adminItem = included({
      ...shared,
      proposal: proposal({ confidentialityScope: "enterprise" }),
    });

    expect(userItem.bucket).toBe("user_approved");
    expect(userItem.executionMode).toBe("user_confirmed");
    expect(userItem.result).toBe("verified_effective");
    expect(userItem.factIds.ledgerEventId).toBe("evt-ok");
    expect(adminItem.bucket).toBe("user_approved");
    expect(adminItem.executionMode).toBe("admin_approved");
    expect(adminItem.impactScope.label).toBe("企业");
  });

  it("maps v1 PENDING_APPROVAL to pending, partial, and legacy", () => {
    const item = included({
      events: [
        event({
          eventId: "evt-wait",
          type: "application.approval_pending",
          timestamp: "2026-09-25T01:00:00.000Z",
          proposalId: "prop-v1",
          evidenceRefs: [],
        }),
        event({
          eventId: "evt-held",
          type: "experiment.held",
          timestamp: "2026-09-25T01:30:00.000Z",
          proposalId: "prop-v1",
          evidenceRefs: [],
        }),
      ],
      proposalV1: proposalV1(),
    });

    expect(item.bucket).toBe("pending");
    expect(item.result).toBe("pending");
    expect(evolutionTimelineResultLabel(item.result)).toBe("待决定");
    expect(item.proposalSchema).toBe(1);
    expect(item.legacy).toBe(true);
    expect(item.executionMode).toBe("unknown");
    expect(item.reason.status).toBe("unspecified");
    expect(item.reason.findingIds).toEqual(["finding-9"]);
    expect(item.reason.caseId).toBe("case-9");
    expect(item.reason.sourceMechanismRef).toBeTruthy();
    expect(JSON.stringify(item.reason)).not.toContain("tune working DNA");
    expect(item.beforeAfter.summary).toBe("unavailable");
    expect(item.completeness).toBe("partial");
    expect(item.evidence.reportId).toBe("report-9");
    expect(item.evidence.verificationId).toBeNull();
    expect(item.factIds.ledgerEventId).toBe("evt-wait");
    expect(item.factIds.proposalId).toBe("prop-v1");
  });

  it("keeps an applied change in observing until verification completes", () => {
    const item = included({
      events: [
        event({
          eventId: "evt-apply",
          type: "application.applied",
          timestamp: "2026-09-25T02:00:00.000Z",
          applicationId: "app-1",
        }),
      ],
      proposal: proposal({ status: "ACTIVE" }),
      application: application(),
      verification: verification({ outcome: "improved" }),
      surface: surfaceWith(),
    });

    expect(item.bucket).toBe("observing");
    expect(item.result).toBe("observing");
    expect(evolutionTimelineResultLabel(item.result)).toBe("观察中");
    expect(item.executionMode).toBe("unknown");
    expect(item.evidence.verificationId).toBe("ver-1");
    expect(item.result).not.toBe("verified_effective");
  });

  it("lets rollback.completed beat an improved verification", () => {
    const item = included({
      events: [
        event({
          eventId: "evt-apply",
          type: "application.applied",
          timestamp: "2026-09-25T02:00:00.000Z",
          applicationId: "app-1",
        }),
        event({
          eventId: "evt-ver",
          type: "verification.completed",
          timestamp: "2026-09-25T03:00:00.000Z",
          verificationId: "ver-1",
        }),
        event({
          eventId: "evt-rb",
          type: "rollback.completed",
          timestamp: "2026-09-25T04:00:00.000Z",
          applicationId: "app-1",
        }),
      ],
      proposal: proposal({ status: "ROLLED_BACK" }),
      application: application({ status: "rolled_back" }),
      verification: verification({ outcome: "improved" }),
      surface: surfaceWith(),
    });

    expect(item.bucket).toBe("rolled_back");
    expect(item.result).toBe("rolled_back");
    expect(evolutionTimelineResultLabel(item.result)).toBe("已回滚");
    expect(item.factIds.ledgerEventId).toBe("evt-rb");
    expect(item.result).not.toBe("verified_effective");
  });

  it("separates system-domain items from the digital-human learned set", () => {
    const agentItem = included({
      events: [
        event({
          eventId: "evt-agent",
          type: "proposal.created",
          timestamp: "2026-09-25T01:00:00.000Z",
        }),
      ],
      proposal: proposal({
        status: "SUGGESTED",
        confidentialityScope: "platform",
      }),
    });
    const systemSurface = getEvolutionSurface("system.runtime-binding-governance");
    const systemItem = included({
      events: [
        event({
          eventId: "evt-system",
          type: "application.approved",
          timestamp: "2026-09-25T01:00:00.000Z",
          proposalId: "prop-system",
          surfaceId: "system.runtime-binding-governance",
          target: systemTarget,
        }),
        event({
          eventId: "evt-system-apply",
          type: "application.applied",
          timestamp: "2026-09-25T02:00:00.000Z",
          proposalId: "prop-system",
          surfaceId: "system.runtime-binding-governance",
          target: systemTarget,
          applicationId: "app-system",
        }),
        event({
          eventId: "evt-system-ver",
          type: "verification.completed",
          timestamp: "2026-09-25T03:00:00.000Z",
          proposalId: "prop-system",
          surfaceId: "system.runtime-binding-governance",
          target: systemTarget,
          verificationId: "ver-system",
        }),
      ],
      proposal: proposal({
        proposalId: "prop-system",
        target: systemTarget,
        surfaceId: "system.runtime-binding-governance",
        confidentialityScope: "enterprise",
        status: "VERIFIED",
      }),
      application: application({
        applicationId: "app-system",
        proposalId: "prop-system",
        targetVersionBefore: "gov-1",
        targetVersionAfter: "gov-2",
      }),
      verification: verification({ verificationId: "ver-system", applicationId: "app-system" }),
      surface: systemSurface,
    });

    expect(agentItem.audience).toBe("digital_human");
    expect(agentItem.changeObject.domainDisplayName).toBe("数字人");
    expect(agentItem.impactScope.label).toBe("平台");
    expect(systemItem.audience).toBe("platform");
    expect(systemItem.changeObject.domain).toBe("system");
    expect(systemItem.changeObject.domainDisplayName).toBe("平台");
    expect(systemItem.impactScope.label).toBe("企业");
    expect(systemItem.executionMode).toBe("admin_approved");
    expect(systemItem.bucket).toBe("user_approved");

    const assembled = assembleEvolutionTimelineQueryResult([agentItem, systemItem]);
    expect(assembled.platformItems.map((item) => item.factIds.ledgerEventId)).toEqual([
      "evt-system",
    ]);
    expect(assembled.platformItems.map((item) => item.changeObject.domain)).toEqual(["system"]);
    expect(
      digitalHumanLearnedItems(assembled.items).map((item) => item.changeObject.domain),
    ).toEqual(["agent"]);
    expect(
      digitalHumanLearnedItems(assembled.items).some((item) => item.audience === "platform"),
    ).toBe(false);
    expect(assembled.bucketCounts.user_approved).toBe(1);
  });
});

describe("evolution timeline fail-closed defaults", () => {
  it("drops a change that has no target", () => {
    const projected = projectEvolutionTimelineItem({
      events: [
        event({
          eventId: "evt-none",
          type: "proposal.created",
          target: undefined,
        }),
      ],
      proposal: proposal(),
    });
    expect(projected).toEqual({ included: false, reason: "missing_target" });
  });

  it("does not mark automatic when autonomy denies an authorized proposal", () => {
    const item = included({
      events: [
        event({ eventId: "evt-auth", type: "proposal.authorized" }),
        event({
          eventId: "evt-ver",
          type: "verification.completed",
          timestamp: "2026-09-25T03:00:00.000Z",
          verificationId: "ver-1",
        }),
      ],
      proposal: proposal(),
      application: application(),
      verification: verification(),
      surface: surfaceWith({ autoApply: true, riskLevel: "low" }),
      autonomy: { policy: autoPolicy(), killSwitch: true },
    });
    expect(item.executionMode).toBe("unknown");
    expect(item.bucket).toBeNull();
    expect(item.result).toBe("verified_effective");
  });

  it("maps platform_release only when the release event id is in the ledger slice", () => {
    const systemSurface = getEvolutionSurface("system.runtime-binding-governance");
    const released = included({
      events: [
        event({
          eventId: "evt-release",
          type: "promotion.completed",
          target: systemTarget,
          surfaceId: "system.runtime-binding-governance",
          proposalId: "prop-system",
        }),
      ],
      proposal: proposal({
        proposalId: "prop-system",
        target: systemTarget,
        surfaceId: "system.runtime-binding-governance",
        confidentialityScope: "platform",
        status: "PROMOTED",
      }),
      surface: systemSurface,
      platformReleaseEventId: "evt-release",
    });
    const missing = included({
      events: [
        event({
          eventId: "evt-other",
          type: "promotion.completed",
          target: systemTarget,
          surfaceId: "system.runtime-binding-governance",
          proposalId: "prop-system",
        }),
      ],
      proposal: proposal({
        proposalId: "prop-system",
        target: systemTarget,
        surfaceId: "system.runtime-binding-governance",
        confidentialityScope: "platform",
        status: "PROMOTED",
      }),
      surface: systemSurface,
      platformReleaseEventId: "evt-release",
    });
    expect(released.executionMode).toBe("platform_release");
    expect(released.bucket).not.toBe("automatic");
    expect(released.audience).toBe("platform");
    expect(missing.executionMode).toBe("unknown");
  });

  it("sets reversible only when the surface allows rollback and a ref or strategy exists", () => {
    const blocked = included({
      events: [event({ eventId: "evt-1", type: "proposal.created" })],
      proposal: proposal({ status: "SUGGESTED" }),
      application: application({ rollbackRef: "rb-1" }),
      surface: surfaceWith({
        allowedOperations: ["inspect", "apply"],
        rollbackStrategy: "restore-previous-values",
      }),
    });
    const noPolicy = included({
      events: [event({ eventId: "evt-2", type: "proposal.created" })],
      proposal: proposal({ status: "SUGGESTED" }),
      application: application({ rollbackRef: "  ", rollbackDrillId: undefined }),
      surface: surfaceWith({ rollbackStrategy: "  " }),
    });
    expect(blocked.reversible).toBe(false);
    expect(noPolicy.reversible).toBe(false);
  });

  it("returns an empty query result and a denial without inventing items", () => {
    expect(emptyEvolutionTimelineQueryResult()).toEqual({
      items: [],
      bucketCounts: {
        automatic: 0,
        user_approved: 0,
        pending: 0,
        observing: 0,
        rolled_back: 0,
      },
      platformItems: [],
      unresolvedIntents: [],
      completeness: "empty",
    });
    expect(denyEvolutionTimelineQuery()).toEqual({ denied: true, reason: "permission_denied" });
    expect(assembleEvolutionTimelineQueryResult([])).toEqual(emptyEvolutionTimelineQueryResult());
  });
});
