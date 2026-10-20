import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SurfaceAutonomyPolicy } from "./autonomy.js";
import type { EvolutionSurface } from "./contracts.js";
import { getEvolutionSurface } from "./surfaces.js";
import {
  EVOLUTION_TIMELINE_LIST_ACCESS,
  EVOLUTION_TIMELINE_LIST_OPERATIONS,
  digitalHumanLearnedTimeline,
  projectEvolutionTimeline,
  type EvolutionTimelineListInput,
} from "./timeline-list.js";
import { countEvolutionTimelineBuckets, type EvolutionTimelineLedgerFact } from "./timeline.js";
import type {
  DiagnosisProposalV1,
  EvolutionApplication,
  EvolutionLedgerEvent,
  EvolutionProposal,
  EvolutionTarget,
  EvolutionVerification,
} from "./types.js";

const agentTarget: EvolutionTarget = { domain: "agent", agentId: "bot-1" };
const systemTarget: EvolutionTarget = { domain: "system", componentId: "runtime-binding" };

function fact(
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
    proposalId: "prop-pending",
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
    auditReceipt: "aud:prop-pending",
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

function autoSurface(): EvolutionSurface {
  const base = getEvolutionSurface("agent.working-dna");
  if (!base) {
    throw new Error("agent.working-dna surface missing");
  }
  return { ...base, autoApply: true, riskLevel: "low" };
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

function ledgerAuthorized(): EvolutionLedgerEvent {
  return {
    schemaVersion: 1,
    eventId: "evt-auto-auth",
    type: "proposal.authorized",
    timestamp: "2026-09-25T01:00:00.000Z",
    proposalId: "prop-auto",
    target: agentTarget,
    surfaceId: "agent.working-dna",
    tenantScope: "tenant-a",
    principalRef: "user-1",
    grantId: "grant-auto",
    evidenceRefs: ["ev-auto-ledger"],
    previousEventHash: null,
    eventHash: "hash-auto-auth",
  };
}

function mixedSequence(): EvolutionTimelineListInput {
  const systemSurface = getEvolutionSurface("system.runtime-binding-governance");
  if (!systemSurface) {
    throw new Error("system.runtime-binding-governance surface missing");
  }
  return {
    events: [
      ledgerAuthorized(),
      fact({
        eventId: "evt-auto-apply",
        type: "application.applied",
        timestamp: "2026-09-25T01:10:00.000Z",
        proposalId: "prop-auto",
        applicationId: "app-auto",
      }),
      fact({
        eventId: "evt-auto-ver",
        type: "verification.completed",
        timestamp: "2026-09-25T01:20:00.000Z",
        proposalId: "prop-auto",
        applicationId: "app-auto",
        verificationId: "ver-auto",
      }),
      fact({
        eventId: "evt-auto-approve-unscoped",
        type: "application.approved",
        timestamp: "2026-09-25T01:05:00.000Z",
        proposalId: "prop-auto",
        target: undefined,
        evidenceRefs: ["ev-unscoped"],
      }),
      fact({
        eventId: "evt-user-ok",
        type: "application.approved",
        timestamp: "2026-09-25T02:00:00.000Z",
        proposalId: "prop-user",
      }),
      fact({
        eventId: "evt-user-apply",
        type: "application.applied",
        timestamp: "2026-09-25T02:10:00.000Z",
        proposalId: "prop-user",
        applicationId: "app-user",
      }),
      fact({
        eventId: "evt-user-ver",
        type: "verification.completed",
        timestamp: "2026-09-25T02:20:00.000Z",
        proposalId: "prop-user",
        applicationId: "app-user",
        verificationId: "ver-user",
      }),
      fact({
        eventId: "evt-pending-wait",
        type: "application.approval_pending",
        timestamp: "2026-09-25T03:00:00.000Z",
        proposalId: "prop-pending",
        evidenceRefs: [],
      }),
      fact({
        eventId: "evt-obs-apply",
        type: "application.applied",
        timestamp: "2026-09-25T04:00:00.000Z",
        proposalId: "prop-obs",
        applicationId: "app-obs",
      }),
      fact({
        eventId: "evt-neutral-apply",
        type: "application.applied",
        timestamp: "2026-09-25T04:30:00.000Z",
        proposalId: "prop-neutral",
        applicationId: "app-neutral",
      }),
      fact({
        eventId: "evt-neutral-ver",
        type: "verification.completed",
        timestamp: "2026-09-25T04:40:00.000Z",
        proposalId: "prop-neutral",
        applicationId: "app-neutral",
        verificationId: "ver-neutral",
      }),
      fact({
        eventId: "evt-rb-apply",
        type: "application.applied",
        timestamp: "2026-09-25T05:00:00.000Z",
        proposalId: "prop-rb",
        applicationId: "app-rb",
      }),
      fact({
        eventId: "evt-rb-ver",
        type: "verification.completed",
        timestamp: "2026-09-25T05:10:00.000Z",
        proposalId: "prop-rb",
        applicationId: "app-rb",
        verificationId: "ver-rb",
      }),
      fact({
        eventId: "evt-rb-done",
        type: "rollback.completed",
        timestamp: "2026-09-25T05:20:00.000Z",
        proposalId: "prop-rb",
        applicationId: "app-rb",
      }),
      fact({
        eventId: "evt-system-ok",
        type: "application.approved",
        timestamp: "2026-09-25T06:00:00.000Z",
        proposalId: "prop-system",
        surfaceId: "system.runtime-binding-governance",
        target: systemTarget,
      }),
      fact({
        eventId: "evt-system-apply",
        type: "application.applied",
        timestamp: "2026-09-25T06:10:00.000Z",
        proposalId: "prop-system",
        surfaceId: "system.runtime-binding-governance",
        target: systemTarget,
        applicationId: "app-system",
      }),
      fact({
        eventId: "evt-system-ver",
        type: "verification.completed",
        timestamp: "2026-09-25T06:20:00.000Z",
        proposalId: "prop-system",
        surfaceId: "system.runtime-binding-governance",
        target: systemTarget,
        applicationId: "app-system",
        verificationId: "ver-system",
      }),
      fact({
        eventId: "evt-ghost",
        type: "proposal.created",
        timestamp: "2026-09-25T07:00:00.000Z",
        proposalId: "prop-ghost",
        target: undefined,
        evidenceRefs: ["ev-ghost"],
      }),
      fact({
        eventId: "   ",
        type: "proposal.created",
        timestamp: "2026-09-25T08:00:00.000Z",
        proposalId: "prop-blank",
        target: agentTarget,
      }),
    ],
    proposals: [
      proposal({
        proposalId: "prop-auto",
        status: "VERIFIED",
        confidentialityScope: "personal",
      }),
      proposal({
        proposalId: "prop-user",
        status: "VERIFIED",
        confidentialityScope: "enterprise",
      }),
      proposal({
        proposalId: "prop-pending",
        status: "PENDING_AUTHORITY",
        sourceEvidenceRefs: ["ev-v2-should-not-win"],
        confidentialityScope: "personal",
      }),
      proposal({ proposalId: "prop-obs", status: "ACTIVE" }),
      proposal({ proposalId: "prop-neutral", status: "ACTIVE" }),
      proposal({ proposalId: "prop-rb", status: "ROLLED_BACK" }),
      proposal({
        proposalId: "prop-system",
        target: systemTarget,
        surfaceId: "system.runtime-binding-governance",
        confidentialityScope: "platform",
        status: "VERIFIED",
      }),
      proposal({ proposalId: "prop-ghost", status: "SUGGESTED" }),
    ],
    proposalsV1: [proposalV1()],
    applications: [
      application({
        applicationId: "app-auto",
        proposalId: "prop-auto",
        targetVersionBefore: "a0",
        targetVersionAfter: "a1",
      }),
      application({
        applicationId: "app-user",
        proposalId: "prop-user",
        targetVersionBefore: "u0",
        targetVersionAfter: "u1",
      }),
      application({
        applicationId: "app-obs",
        proposalId: "prop-obs",
        targetVersionBefore: "o0",
        targetVersionAfter: "o1",
      }),
      application({
        applicationId: "app-neutral",
        proposalId: "prop-neutral",
        targetVersionBefore: "n0",
        targetVersionAfter: "n1",
      }),
      application({
        applicationId: "app-rb",
        proposalId: "prop-rb",
        targetVersionBefore: "r0",
        targetVersionAfter: "r1",
        status: "rolled_back",
      }),
      application({
        applicationId: "app-system",
        proposalId: "prop-system",
        targetVersionBefore: "gov-1",
        targetVersionAfter: "gov-2",
      }),
      application({
        applicationId: "app-foreign",
        proposalId: "prop-other",
        targetVersionBefore: "foreign-0",
        targetVersionAfter: "foreign-1",
      }),
    ],
    verifications: [
      verification({
        verificationId: "ver-auto",
        applicationId: "app-auto",
        outcome: "improved",
      }),
      verification({
        verificationId: "ver-user",
        applicationId: "app-user",
        outcome: "improved",
      }),
      verification({
        verificationId: "ver-obs",
        applicationId: "app-obs",
        outcome: "improved",
      }),
      verification({
        verificationId: "ver-neutral",
        applicationId: "app-neutral",
        outcome: "neutral",
      }),
      verification({
        verificationId: "ver-rb",
        applicationId: "app-rb",
        outcome: "improved",
      }),
      verification({
        verificationId: "ver-system",
        applicationId: "app-system",
        outcome: "improved",
      }),
    ],
    surfaces: [autoSurface(), systemSurface],
    autonomyBySurfaceId: {
      "agent.working-dna": { policy: autoPolicy() },
    },
  };
}

describe("evolution timeline list projection", () => {
  it("classifies a mixed ledger sequence into exclusive buckets", () => {
    const projected = projectEvolutionTimeline(mixedSequence());
    const byProposal = new Map(
      projected.items.map((item) => [item.factIds.proposalId, item] as const),
    );

    expect(projected.items).toHaveLength(7);
    expect(byProposal.get("prop-auto")?.bucket).toBe("automatic");
    expect(byProposal.get("prop-auto")?.executionMode).toBe("automatic");
    expect(byProposal.get("prop-auto")?.result).toBe("verified_effective");
    expect(byProposal.get("prop-auto")?.factIds.ledgerEventId).toBe("evt-auto-auth");
    expect(byProposal.get("prop-auto")?.beforeAfter).toEqual({
      versionBefore: "a0",
      versionAfter: "a1",
      summary: "a0 → a1",
    });
    expect(byProposal.get("prop-auto")?.factIds.verificationId).toBe("ver-auto");
    expect(byProposal.get("prop-auto")?.evidence.evidenceRefs).not.toContain("ev-unscoped");

    expect(byProposal.get("prop-user")?.bucket).toBe("user_approved");
    expect(byProposal.get("prop-user")?.executionMode).toBe("admin_approved");
    expect(byProposal.get("prop-user")?.factIds.ledgerEventId).toBe("evt-user-ok");
    expect(byProposal.get("prop-user")?.beforeAfter.summary).toBe("u0 → u1");
    expect(byProposal.get("prop-user")?.factIds.verificationId).toBe("ver-user");

    const pending = byProposal.get("prop-pending");
    expect(pending?.bucket).toBe("pending");
    expect(pending?.proposalSchema).toBe(1);
    expect(pending?.legacy).toBe(true);
    expect(pending?.reason.status).toBe("unspecified");
    expect(pending?.reason.findingIds).toEqual(["finding-9"]);
    expect(JSON.stringify(pending?.reason)).not.toContain("tune working DNA");
    expect(pending?.reason.sourceEvidenceRefs).not.toContain("ev-v2-should-not-win");

    expect(byProposal.get("prop-obs")?.bucket).toBe("observing");
    expect(byProposal.get("prop-obs")?.result).toBe("observing");
    expect(byProposal.get("prop-obs")?.result).not.toBe("verified_effective");
    expect(byProposal.get("prop-obs")?.factIds.verificationId).toBe("ver-obs");

    expect(byProposal.get("prop-neutral")?.bucket).toBe("observing");
    expect(byProposal.get("prop-neutral")?.result).toBe("observing");
    expect(byProposal.get("prop-neutral")?.result).not.toBe("verified_effective");

    expect(byProposal.get("prop-rb")?.bucket).toBe("rolled_back");
    expect(byProposal.get("prop-rb")?.result).toBe("rolled_back");
    expect(byProposal.get("prop-rb")?.factIds.ledgerEventId).toBe("evt-rb-done");
    expect(byProposal.get("prop-rb")?.result).not.toBe("verified_effective");

    expect(countEvolutionTimelineBuckets(projected.items)).toEqual({
      automatic: 1,
      user_approved: 2,
      pending: 1,
      observing: 2,
      rolled_back: 1,
    });
    expect(projected.items.map((item) => item.factIds.proposalId)).toEqual([
      "prop-auto",
      "prop-user",
      "prop-pending",
      "prop-obs",
      "prop-neutral",
      "prop-rb",
      "prop-system",
    ]);
  });

  it("keeps a fact id on every item and drops entries without a target", () => {
    const input = mixedSequence();
    const projected = projectEvolutionTimeline(input);
    const targetedIds = new Set(
      input.events
        .filter((event) => event.target && event.eventId.trim())
        .map((event) => event.eventId),
    );

    expect(projected.items.length).toBeGreaterThan(0);
    for (const item of projected.items) {
      expect(item.factIds.ledgerEventId.trim().length).toBeGreaterThan(0);
      expect(targetedIds.has(item.factIds.ledgerEventId)).toBe(true);
      expect(item.changeObject.target).toBeTruthy();
    }
    expect(projected.items.map((item) => item.factIds.proposalId)).not.toContain("prop-ghost");
    expect(projected.items.map((item) => item.factIds.ledgerEventId)).not.toContain("evt-ghost");
    expect(projected.items.map((item) => item.factIds.ledgerEventId)).not.toContain(
      "evt-auto-approve-unscoped",
    );
    expect(projected.exclusions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "prop-auto",
          reason: "missing_target",
          ledgerEventIds: ["evt-auto-approve-unscoped"],
        }),
        expect.objectContaining({
          key: "prop-ghost",
          reason: "missing_target",
          ledgerEventIds: ["evt-ghost"],
        }),
        expect.objectContaining({
          key: "prop-blank::agent:bot-1",
          reason: "missing_fact_id",
          ledgerEventIds: ["   "],
        }),
      ]),
    );
  });

  it("keeps system-domain items out of the digital-human learned collection", () => {
    const input = mixedSequence();
    const projected = projectEvolutionTimeline(input);
    const learned = digitalHumanLearnedTimeline(input);
    const system = projected.items.find((item) => item.factIds.proposalId === "prop-system");

    expect(system?.audience).toBe("platform");
    expect(system?.changeObject.domain).toBe("system");
    expect(system?.changeObject.domainDisplayName).toBe("平台");
    expect(system?.bucket).toBe("user_approved");
    expect(system?.beforeAfter.summary).toBe("gov-1 → gov-2");
    expect(learned).toHaveLength(projected.items.length - 1);
    expect(learned.map((item) => item.factIds.proposalId)).not.toContain("prop-system");
    expect(learned.every((item) => item.audience === "digital_human")).toBe(true);
    expect(learned.some((item) => item.changeObject.domain === "system")).toBe(false);
  });

  it("does not mark automatic when autonomy is omitted or the kill switch is on", () => {
    const base = mixedSequence();
    const autoOnly: EvolutionTimelineListInput = {
      ...base,
      events: base.events.filter((event) => event.proposalId === "prop-auto" && event.target),
      proposals: base.proposals?.filter((item) => item.proposalId === "prop-auto"),
      proposalsV1: [],
      applications: base.applications?.filter((item) => item.proposalId === "prop-auto"),
      verifications: base.verifications?.filter((item) => item.verificationId === "ver-auto"),
    };
    const omitted = projectEvolutionTimeline({
      ...autoOnly,
      surfaces: [],
      autonomyBySurfaceId: {},
    });
    const killed = projectEvolutionTimeline({
      ...autoOnly,
      autonomyBySurfaceId: {
        "agent.working-dna": { policy: autoPolicy(), killSwitch: true },
      },
    });

    expect(omitted.items).toHaveLength(1);
    expect(omitted.items[0]?.executionMode).toBe("unknown");
    expect(omitted.items[0]?.bucket).not.toBe("automatic");
    expect(killed.items[0]?.executionMode).toBe("unknown");
    expect(killed.items[0]?.bucket).not.toBe("automatic");
  });

  it("is read-only: the list API does not mutate snapshots or expose a write path", () => {
    const input = mixedSequence();
    const before = structuredClone(input);
    freezeDeep(input);
    const first = projectEvolutionTimeline(input);
    const second = projectEvolutionTimeline(input);
    expect(input).toEqual(before);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(EVOLUTION_TIMELINE_LIST_ACCESS).toBe("read-only");

    const source = readFileSync(
      fileURLToPath(new URL("./timeline-list.ts", import.meta.url)),
      "utf8",
    );
    const imports = [...source.matchAll(/from ["']([^"']+)["']/g)].map((match) => match[1]);
    expect(imports).toEqual(["./contracts.js", "./timeline.js", "./types.js"]);
    expect(source).not.toMatch(
      /\b(writeFile|appendFile|mkdirSync|unlinkSync|createWriteStream|readFileSync|node:fs|node:child_process|ORCHESTRATION_LIVE_INVOKE)\b/,
    );
    expect(source).not.toMatch(/from ["'][^"']*diagnosis/);
    for (const name of EVOLUTION_TIMELINE_LIST_OPERATIONS) {
      expect(name).not.toMatch(/write|save|commit|mutate|apply|delete|insert|update/i);
      expect(source).toContain(`export function ${name}`);
    }
  });
});

function freezeDeep(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    freezeDeep(child);
  }
}
